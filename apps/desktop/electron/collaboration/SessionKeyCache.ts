import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { CollabSessionDescriptor } from "../../../../shared/CollaborationTransport"
import { withRecoveryStorageBudget } from "./RecoveryStorageBudget"

const cacheOperations = new Map<string, Promise<unknown>>()
const MAX_KEY_VERSIONS = 64
const MAX_SEALED_KEY_BYTES = 64 * 1024

interface DeviceSealer {
  isEncryptionAvailable(): boolean
  encryptString(value: string): Buffer
  decryptString(value: Buffer): string
  getSelectedStorageBackend?(): string
}
interface CachedSessionKey {
  generation: 3
  projectId: string
  sessionId: string
  deviceId: string
  roomId: string
  encryption: CollabSessionDescriptor["encryption"]
  protocolVersion: string
  collabWsUrl: string
}

/** OS-sealed, device-bound key envelopes. Bearer tokens never enter this cache. */
export class SessionKeyCache {
  private readonly root: string
  private readonly sealer: DeviceSealer
  private readonly recoveryRoot: string
  constructor(root: string, sealer: DeviceSealer, recoveryRoot = root) { this.root = root; this.sealer = sealer; this.recoveryRoot = recoveryRoot }
  private available(): boolean { return this.sealer.isEncryptionAvailable() && this.sealer.getSelectedStorageBackend?.() !== "basic_text" }
  private filename(sessionId: string, version?: number): string { return path.join(this.root, createHash("sha256").update(sessionId).digest("hex") + (version ? `-v${version}` : "") + ".sealed") }

  async save(session: CollabSessionDescriptor, current = true): Promise<void> {
    if (!session.sessionId) throw new Error("Session key identity is missing")
    return this.serial(session.sessionId, () => this.saveKey(session, current))
  }

  private async serial<T>(sessionId: string, operation: () => Promise<T>): Promise<T> {
    const key = this.filename(sessionId)
    const next = (cacheOperations.get(key) ?? Promise.resolve()).catch(() => {}).then(operation)
    cacheOperations.set(key, next)
    try { return await next } finally { if (cacheOperations.get(key) === next) cacheOperations.delete(key) }
  }

  private async read(filename: string): Promise<Buffer | null> {
    const stat = await fs.lstat(filename).catch(error => { if (error.code === "ENOENT") return null; throw error })
    if (!stat) return null
    if (!stat.isFile() || stat.isSymbolicLink() || stat.size > MAX_SEALED_KEY_BYTES) throw new Error("Unsafe or oversized sealed key; recovery data was retained")
    return fs.readFile(filename)
  }

  private async saveKey(session: CollabSessionDescriptor, current: boolean): Promise<void> {
    if (!this.available()) throw new Error("OS-backed secure storage is required for offline collaboration recovery")
    const version = session.encryption.activeKeyVersion
    if (!session.sessionId || session.roomId !== `session:${session.sessionId}` || session.encryption.roomId !== session.roomId ||
      !session.encryption.encryptionRequired || session.encryption.status !== "ready" || !Number.isSafeInteger(version) || version! < 1) throw new Error("Only a verified ready session key can be cached")
    const versions = await this.versions(session.sessionId)
    if (!versions.includes(version!) && versions.length >= MAX_KEY_VERSIONS) throw new Error("Session key retention is full; existing recovery keys were retained")
    const value: CachedSessionKey = { generation: 3, projectId: session.projectId, sessionId: session.sessionId, deviceId: session.deviceId,
      roomId: session.roomId, encryption: session.encryption, collabWsUrl: session.collabWsUrl, protocolVersion: session.protocolVersion }
    const sealed = this.sealer.encryptString(JSON.stringify(value))
    if (sealed.length > MAX_SEALED_KEY_BYTES) throw new Error("Sealed session key exceeds its storage limit")
    const previous = await this.read(this.filename(session.sessionId))
    let previousVersion: number | undefined
    if (previous) {
      const old = JSON.parse(this.sealer.decryptString(previous)) as CachedSessionKey
      if (old.projectId !== session.projectId || old.deviceId !== session.deviceId || old.sessionId !== session.sessionId || !Number.isSafeInteger(old.encryption.activeKeyVersion)) throw new Error("Cached key identity differs; existing recovery was retained")
      previousVersion = old.encryption.activeKeyVersion ?? undefined
      if (current && previousVersion! > version!) throw new Error("Active session key moved forward; retry with current authority")
    }
    // Reserve peak space for all atomic replacements, including interrupted files.
    await withRecoveryStorageBudget(this.recoveryRoot, sealed.length * (current ? 2 : 1) + (previous?.length ?? 0), async () => {
      await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
      if (previous && previousVersion) await this.write(this.filename(session.sessionId!, previousVersion), previous)
      await this.write(this.filename(session.sessionId!, version!), sealed)
      if (current) await this.write(this.filename(session.sessionId!), sealed)
    })
  }

  private async write(filename: string, sealed: Buffer): Promise<void> {
    const temp = path.join(this.root, `${randomUUID()}.pending`)
    const handle = await fs.open(temp, "wx", 0o600)
    try { await handle.writeFile(sealed); await handle.sync() } finally { await handle.close() }
    await fs.rename(temp, filename)
    const directory = await fs.open(this.root, "r")
    try { await directory.sync() } finally { await directory.close() }
  }

  async versions(sessionId: string): Promise<number[]> {
    const prefix = createHash("sha256").update(sessionId).digest("hex") + "-v"
    const names = await fs.readdir(this.root).catch(error => { if (error.code === "ENOENT") return []; throw error })
    const versions = names.filter(name => name.startsWith(prefix) && /^[1-9]\d*\.sealed$/.test(name.slice(prefix.length))).map(name => Number(name.slice(prefix.length, -7))).sort((a, b) => a - b)
    if (versions.some(version => !Number.isSafeInteger(version)) || versions.length > MAX_KEY_VERSIONS) throw new Error("Session key inventory exceeds its limit; all recovery keys were retained")
    return versions
  }

  /** Called only after the Host's quiescent inventory proves no ciphertext or
   * cross-epoch recovery metadata depends on these older versions. */
  retireUnusedVersions(sessionId: string, currentVersion: number, versions: number[]): Promise<{ files: number; bytes: number }> {
    return this.serial(sessionId, async () => {
      const current = await this.read(this.filename(sessionId))
      if (!current || !this.available()) throw new Error("Active recovery key is unavailable; all keys were retained")
      const descriptor = JSON.parse(this.sealer.decryptString(current)) as CachedSessionKey
      if (descriptor.generation !== 3 || descriptor.sessionId !== sessionId || descriptor.encryption.activeKeyVersion !== currentVersion ||
        versions.length > MAX_KEY_VERSIONS || new Set(versions).size !== versions.length || versions.some(version => !Number.isSafeInteger(version) || version < 1 || version >= currentVersion)) throw new Error("Recovery key changed; retry cleanup")
      const files = []
      for (const version of versions) {
        const filename = this.filename(sessionId, version), bytes = await this.read(filename)
        if (bytes) files.push({ filename, bytes: bytes.length })
      }
      for (const file of files) await fs.rm(file.filename)
      if (files.length) {
        const directory = await fs.open(this.root, "r")
        try { await directory.sync() } finally { await directory.close() }
      }
      return { files: files.length, bytes: files.reduce((sum, file) => sum + file.bytes, 0) }
    })
  }

  async recover(projectId: string, sessionId: string, deviceId: string, version?: number): Promise<CachedSessionKey | null> {
    if (!this.available()) throw new Error("OS-backed secure storage is unavailable; encrypted recovery was retained")
    const sealed = await this.read(this.filename(sessionId, version))
    if (!sealed) return null
    try {
      const value = JSON.parse(this.sealer.decryptString(sealed)) as CachedSessionKey
      if (value.generation !== 3 || value.projectId !== projectId || value.sessionId !== sessionId || value.deviceId !== deviceId ||
        value.roomId !== `session:${sessionId}` || value.encryption.roomId !== value.roomId || value.encryption.status !== "ready" || !value.encryption.encryptionRequired ||
        (version !== undefined && value.encryption.activeKeyVersion !== version) || typeof value.protocolVersion !== "string" || typeof value.collabWsUrl !== "string") throw new Error("Cached key identity mismatch")
      return value
    } catch { throw new Error("This device cannot unlock the cached session key; encrypted recovery was retained") }
  }
}
