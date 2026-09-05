import fs from "node:fs/promises"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { CollabSessionDescriptor } from "../../../../shared/CollaborationTransport"

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
  constructor(root: string, sealer: DeviceSealer) { this.root = root; this.sealer = sealer }
  private available(): boolean { return this.sealer.isEncryptionAvailable() && this.sealer.getSelectedStorageBackend?.() !== "basic_text" }
  private filename(sessionId: string, version?: number): string { return path.join(this.root, createHash("sha256").update(sessionId).digest("hex") + (version ? `-v${version}` : "") + ".sealed") }

  async save(session: CollabSessionDescriptor, current = true): Promise<void> {
    if (!this.available()) throw new Error("OS-backed secure storage is required for offline collaboration recovery")
    if (!session.sessionId || session.encryption.status !== "ready") throw new Error("Only a verified ready session key can be cached")
    const value: CachedSessionKey = { generation: 3, projectId: session.projectId, sessionId: session.sessionId, deviceId: session.deviceId,
      roomId: session.roomId, encryption: session.encryption, collabWsUrl: session.collabWsUrl, protocolVersion: session.protocolVersion }
    const sealed = this.sealer.encryptString(JSON.stringify(value))
    await fs.mkdir(this.root, { recursive: true, mode: 0o700 })
    const previous = await fs.readFile(this.filename(session.sessionId)).catch(error => { if (error.code === "ENOENT") return null; throw error })
    if (previous) {
      const old = JSON.parse(this.sealer.decryptString(previous)) as CachedSessionKey
      if (old.encryption.activeKeyVersion) await this.write(this.filename(session.sessionId, old.encryption.activeKeyVersion), previous)
    }
    await this.write(this.filename(session.sessionId, session.encryption.activeKeyVersion!), sealed)
    if (current) await this.write(this.filename(session.sessionId), sealed)
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
    return names.filter(name => name.startsWith(prefix) && /^\d+\.sealed$/.test(name.slice(prefix.length))).map(name => Number(name.slice(prefix.length, -7))).sort((a, b) => a - b)
  }

  async recover(projectId: string, sessionId: string, deviceId: string, version?: number): Promise<CachedSessionKey | null> {
    if (!this.available()) throw new Error("OS-backed secure storage is unavailable; encrypted recovery was retained")
    const sealed = await fs.readFile(this.filename(sessionId, version)).catch(error => { if (error.code === "ENOENT") return null; throw error })
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
