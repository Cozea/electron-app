import fs from "node:fs/promises"
import { inventoryRecoveryStorage, withRecoveryStorageBudget } from "./RecoveryStorageBudget"
import type { CollaborationRecoveryCleanupResult } from "../../../../shared/collaborationRecovery"
import path from "node:path"
import { createHash, randomUUID } from "node:crypto"
import type { CollaborationOutbox, CollaborationOutboxRecord } from "../../../../shared/collaborationOutbox"

export interface DurableSessionCheckpoint {
  generation: 3
  roomId: string
  sequence: number
  keyVersion: number
  snapshotBinary: string
}
export interface DurableAcknowledgedUpdate {
  sequence: number
  updateBinary: string
}
const idPattern = /^[A-Za-z0-9_-]{1,160}$/
// Runtime, key migration and explicit cleanup may open independent handles to
// the same key-version store. Serialize their identity checks and mutations.
const directoryOperations = new Map<string, Promise<unknown>>()

/** Device-local recovery. Every code payload on disk is an encrypted envelope. */
export class DurableSessionStore implements CollaborationOutbox {
  readonly directory: string
  private readonly roomId: string
  private tail: Promise<unknown> = Promise.resolve()
  private readonly root: string
  private readonly keyVersion: number
  constructor(root: string, roomId: string, keyVersion = 1) {
    if (!Number.isSafeInteger(keyVersion) || keyVersion < 1) throw new Error("Invalid recovery key version")
    this.root = root; this.keyVersion = keyVersion
    this.roomId = roomId
    this.directory = path.join(root, "g3", createHash("sha256").update(roomId).digest("hex"))
    if (keyVersion > 1) this.directory = path.join(this.directory, "keys", String(keyVersion))
  }

  private serial<T>(operation: () => Promise<T>): Promise<T> {
    const key = path.resolve(this.directory)
    const next = (directoryOperations.get(key) ?? Promise.resolve()).catch(() => {}).then(operation)
    this.tail = next
    directoryOperations.set(key, next)
    const release = () => { if (directoryOperations.get(key) === next) directoryOperations.delete(key) }
    void next.then(release, release)
    return next
  }

  private async ensure(): Promise<void> { await fs.mkdir(this.directory, { recursive: true, mode: 0o700 }) }

  reserveProjectionWrite(bytes: number, write: () => Promise<void>): Promise<void> {
    return withRecoveryStorageBudget(this.root, bytes, write)
  }

  private async write(name: string, value: unknown): Promise<void> {
    const serialized = JSON.stringify(value)
    const bytes = Buffer.byteLength(serialized)
    if (bytes > 32 * 1024 * 1024) throw new Error("Encrypted recovery record exceeds its limit")
    const roomRoot = path.join(this.root, "g3", createHash("sha256").update(this.roomId).digest("hex"))
    await withRecoveryStorageBudget(this.root, bytes, async () => {
      await this.ensure()
      const temp = path.join(this.directory, `.${randomUUID()}.pending`)
      const handle = await fs.open(temp, "wx", 0o600)
      try { await handle.writeFile(serialized, "utf8"); await handle.sync() } finally { await handle.close() }
      await fs.rename(temp, path.join(this.directory, name))
      const directory = await fs.open(this.directory, "r")
      try { await directory.sync() } finally { await directory.close() }
    }, { roomRoot })
  }

  private async read<T>(name: string): Promise<T | null> {
    try {
      const filename = path.join(this.directory, name)
      const stat = await fs.lstat(filename)
      if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 32 * 1024 * 1024) throw new Error("Unsafe or oversized recovery record")
      const value = await fs.readFile(filename, "utf8")
      return JSON.parse(value) as T
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null
      throw new Error(`Collaboration recovery record ${name} is unreadable; it has been retained for recovery`)
    }
  }

  readInitializationBasis(id: string): Promise<string | null> {
    if (!idPattern.test(id)) throw new Error("Invalid initialization basis identity")
    return this.serial(() => this.read<string>(`initialization-basis-${id}.json`))
  }
  saveInitializationBasis(leaseId: string, encoded: string): Promise<void> {
    if (!idPattern.test(leaseId)) throw new Error("Invalid initialization basis identity")
    return this.serial(async () => {
      const name = `initialization-basis-${leaseId}.json`
      const previous = await this.read<string>(name)
      if (previous && previous !== encoded) throw new Error("Initialization basis already exists; retain its original history")
      if (!previous) await this.write(name, encoded)
    })
  }

  readRecoveryJournal(): Promise<string | null> { return this.serial(() => this.read<string>("offline-recovery.json")) }
  saveRecoveryJournal(encrypted: string): Promise<void> { return this.serial(() => this.write("offline-recovery.json", encrypted)) }

  async enqueue(record: CollaborationOutboxRecord): Promise<void> {
    if (!idPattern.test(record.id) || record.roomId !== this.roomId || !record.updateBinary || !Number.isSafeInteger(record.keyVersion) || record.keyVersion !== this.keyVersion) throw new Error("Invalid encrypted outbox record")
    await this.serial(async () => {
      const previous = await this.read<CollaborationOutboxRecord>(`outbox-${record.id}.json`)
      if (previous && previous.updateBinary !== record.updateBinary) throw new Error("Outbox identity was reused for different encrypted bytes")
      if (!previous) await this.write(`outbox-${record.id}.json`, record)
    })
  }

  async list(roomId: string, keyVersion: number): Promise<CollaborationOutboxRecord[]> {
    return this.listRecords("outbox", roomId, keyVersion)
  }

  async saveEditorIngress(record: CollaborationOutboxRecord): Promise<void> {
    if (!idPattern.test(record.id) || record.roomId !== this.roomId || record.keyVersion !== this.keyVersion || !record.updateBinary) throw new Error("Invalid encrypted editor recovery")
    await this.serial(() => this.write(`ingress-${record.id}.json`, record))
  }
  listEditorIngress(): Promise<CollaborationOutboxRecord[]> { return this.listRecords("ingress", this.roomId, this.keyVersion) }
  async acknowledgeEditorIngress(id: string): Promise<void> {
    if (!idPattern.test(id)) throw new Error("Invalid editor recovery identity")
    await this.serial(async () => {
      await fs.rm(path.join(this.directory, `ingress-${id}.json`), { force: true })
      const directory = await fs.open(this.directory, "r")
      try { await directory.sync() } finally { await directory.close() }
    })
  }

  private async listRecords(prefix: "outbox" | "ingress", roomId: string, keyVersion: number): Promise<CollaborationOutboxRecord[]> {
    return this.serial(async () => {
      if (roomId !== this.roomId) throw new Error("Outbox room mismatch")
      await this.ensure()
      const records: CollaborationOutboxRecord[] = []
      for (const name of await fs.readdir(this.directory)) {
        if (!name.startsWith(`${prefix}-`) || !name.endsWith(".json")) continue
        const record = await this.read<CollaborationOutboxRecord>(name)
        if (!record || record.roomId !== roomId || !idPattern.test(record.id) || typeof record.updateBinary !== "string") throw new Error("Encrypted outbox is corrupt; local recovery data was retained")
        // Never silently hide pending work after a key rotation.
        if (record.keyVersion !== keyVersion) throw new Error("Pending edits use a previous room key and require recovery before rejoining")
        records.push(record)
      }
      return records.sort((a, b) => a.timestamp - b.timestamp || a.id.localeCompare(b.id))
    })
  }

  async retireRecoverySources(sources: Array<{ keyVersion: number; id: string; kind?: "ingress" }>): Promise<void> {
    for (const ref of sources) {
      if (ref.keyVersion > this.keyVersion || ref.keyVersion < 1) throw new Error("Invalid recovery source")
      const source = new DurableSessionStore(this.root, this.roomId, ref.keyVersion)
      if (ref.kind === "ingress") await source.acknowledgeEditorIngress(ref.id)
      else await source.acknowledge(ref.id)
    }
  }

  async acknowledge(id: string): Promise<void> { await this.acknowledgeChain(id, new Set()) }
  private async acknowledgeChain(id: string, visited: Set<string>): Promise<void> {
    if (!idPattern.test(id)) throw new Error("Invalid outbox acknowledgement")
    const identity = `${this.keyVersion}:${id}`
    if (visited.has(identity)) throw new Error("Cyclic migrated edit provenance")
    visited.add(identity)
    // Read and remove in separate serialized operations: a renewed initializer
    // may have a predecessor in this same key directory.
    const record = await this.serial(() => this.read<CollaborationOutboxRecord>(`outbox-${id}.json`))
    if (record?.migratedFrom) {
      if (record.migratedFrom.keyVersion > this.keyVersion || record.migratedFrom.keyVersion < 1) throw new Error("Invalid migrated edit provenance")
      const source = new DurableSessionStore(this.root, this.roomId, record.migratedFrom.keyVersion)
      if (record.migratedFrom.kind === "ingress") await source.acknowledgeEditorIngress(record.migratedFrom.id)
      else await source.acknowledgeChain(record.migratedFrom.id, visited)
    }
    await this.serial(async () => {
      await fs.rm(path.join(this.directory, `outbox-${id}.json`), { force: true })
      const directory = await fs.open(this.directory, "r")
      try { await directory.sync() } finally { await directory.close() }
    })
  }

  async saveAcknowledged(sequence: number, updateBinary: string): Promise<void> {
    if (!Number.isSafeInteger(sequence) || sequence < 1 || !updateBinary) throw new Error("Invalid acknowledged recovery sequence")
    await this.serial(() => this.write(`ack-${sequence.toString().padStart(16, "0")}.json`, { sequence, updateBinary }))
  }

  async prepareCheckpointUpload(leaseId: string, snapshotBinary: string): Promise<string> {
    if (!idPattern.test(leaseId) || !snapshotBinary) throw new Error("Invalid prepared checkpoint")
    return this.serial(async () => {
      const previous = await this.read<{ leaseId: string; snapshotBinary: string }>("checkpoint-upload.json")
      if (previous?.leaseId === leaseId) {
        if (typeof previous.snapshotBinary !== "string" || !previous.snapshotBinary) throw new Error("Prepared checkpoint is corrupt; recovery data was retained")
        return previous.snapshotBinary
      }
      await this.write("checkpoint-upload.json", { leaseId, snapshotBinary })
      return snapshotBinary
    })
  }

  async saveCheckpoint(checkpoint: DurableSessionCheckpoint): Promise<void> {
    if (checkpoint.roomId !== this.roomId || checkpoint.generation !== 3 || checkpoint.keyVersion !== this.keyVersion || !Number.isSafeInteger(checkpoint.sequence) || checkpoint.sequence < 0) throw new Error("Invalid local recovery checkpoint")
    await this.serial(async () => {
      const previous = await this.read<DurableSessionCheckpoint>("checkpoint.json")
      if (previous && previous.sequence > checkpoint.sequence) throw new Error("Recovery checkpoint cannot move backwards")
      await this.write("checkpoint.json", checkpoint)
      // The replacement is durable before deleting any covered log record.
      for (const name of await fs.readdir(this.directory)) {
        const match = /^ack-(\d{16})\.json$/.exec(name)
        if (match && Number(match[1]) <= checkpoint.sequence) await fs.rm(path.join(this.directory, name))
      }
    })
  }

  async recover(): Promise<{ checkpoint: DurableSessionCheckpoint | null; updates: DurableAcknowledgedUpdate[] }> {
    return this.serial(async () => {
      await this.ensure()
      const checkpoint = await this.read<DurableSessionCheckpoint>("checkpoint.json")
      if (checkpoint && (checkpoint.generation !== 3 || checkpoint.roomId !== this.roomId)) throw new Error("Local collaboration recovery generation does not match")
      const updates: DurableAcknowledgedUpdate[] = []
      let sequence = checkpoint?.sequence ?? 0
      for (const name of (await fs.readdir(this.directory)).filter(name => /^ack-\d{16}\.json$/.test(name)).sort()) {
        const update = await this.read<DurableAcknowledgedUpdate>(name)
        if (!update || !Number.isSafeInteger(update.sequence) || typeof update.updateBinary !== "string") throw new Error("Invalid encrypted acknowledgement log")
        if (update.sequence <= sequence) continue
        if (update.sequence !== sequence + 1) throw new Error("Local acknowledgement log has a gap; reload the room checkpoint before replaying pending edits")
        updates.push(update)
        sequence = update.sequence
      }
      return { checkpoint, updates }
    })
  }

  /** Caller authenticates this exact replacement, not just its plaintext cursor. */
  compactAcknowledged(verified: DurableSessionCheckpoint): Promise<CollaborationRecoveryCleanupResult> {
    return this.serial(async () => {
      await inventoryRecoveryStorage(this.root)
      const current = await this.read<DurableSessionCheckpoint>("checkpoint.json")
      if (!current || verified.roomId !== this.roomId || verified.keyVersion !== this.keyVersion ||
        current.generation !== 3 || current.roomId !== verified.roomId || current.keyVersion !== verified.keyVersion ||
        current.sequence !== verified.sequence || current.snapshotBinary !== verified.snapshotBinary ||
        !Number.isSafeInteger(current.sequence) || current.sequence < 0) throw new Error("Recovery checkpoint changed; retry cleanup without discarding data")
      const candidates: Array<{ filename: string; bytes: number }> = []
      for (const name of (await fs.readdir(this.directory)).sort()) {
        const match = /^ack-(\d{16})\.json$/.exec(name)
        if (!match || Number(match[1]) > current.sequence) continue
        const record = await this.read<DurableAcknowledgedUpdate>(name)
        if (!record || record.sequence !== Number(match[1]) || typeof record.updateBinary !== "string") throw new Error("Acknowledged recovery metadata is invalid; all records were retained")
        const filename = path.join(this.directory, name)
        candidates.push({ filename, bytes: (await fs.lstat(filename)).size })
        if (candidates.length === 256) break
      }
      for (const candidate of candidates) await fs.rm(candidate.filename)
      const directory = await fs.open(this.directory, "r")
      try { await directory.sync() } finally { await directory.close() }
      return { files: candidates.length, bytes: candidates.reduce((sum, item) => sum + item.bytes, 0) }
    })
  }

  async flush(): Promise<void> { await this.tail; await directoryOperations.get(path.resolve(this.directory)) }

  async readProjection(): Promise<string | null> {
    return this.serial(async () => {
      const record = await this.read<{ ciphertext: string }>("projection.json")
      if (record && typeof record.ciphertext !== "string") throw new Error("Projection recovery is corrupt; local files were retained")
      return record?.ciphertext ?? null
    })
  }

  async saveProjection(ciphertext: string): Promise<void> {
    if (!ciphertext) throw new Error("Missing encrypted projection recovery")
    await this.serial(() => this.write("projection.json", { ciphertext }))
  }
  close(): void { /* Owner awaits flush before Electron shutdown. */ }
}
