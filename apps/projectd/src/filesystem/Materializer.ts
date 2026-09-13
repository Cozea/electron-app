/**
 * CRDT -> Filesystem Materializer with low-latency adaptive coalescing.
 *
 * Master Specification: Section 10.15, 28.3
 * Features:
 * - 20-40ms adaptive coalescing (max 100ms under load);
 * - Atomic safe writes (temp file + rename);
 * - Divergent disk protection (preserves un-ingested local changes);
 * - Symlink and file mode (+x) application;
 * - Materialization index and baseline store updates;
 * - Path collision suppression (Invariant C18);
 * - Tree paths confined to the workspace (Invariant C37);
 * - Renames and deletes remove only bytes this materializer wrote.
 */

import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"

import type { BaselineStore } from "../collaboration/BaselineStore"
import type { BinaryRevision } from "../collaboration/BinaryStore"
import { InvalidProjectPathError } from "../collaboration/projectPath"
import type { MaterializationIndex, MaterializedEntry } from "./MaterializationIndex"
import type { SessionReplica } from "../collaboration/SessionReplica"
import type { ProjectEntryRecord } from "../collaboration/TreeDoc"
import { resolveWorkspaceFilePath } from "./workspacePath"
import { ConflictEngine } from "../collaboration/ConflictEngine"
import { writeVerifiedBinaryAtomic } from "./AtomicBinaryMaterialization"

const HASH_READ_BYTES = 4 * 1024 * 1024

export interface MaterializerOptions {
  workspaceRoot: string
  sessionId: string
  replica: SessionReplica
  index: MaterializationIndex
  baselineStore: BaselineStore
  /** Compatibility fallback for bounded callers that still resolve a complete binary. */
  resolveBinary?: (revision: BinaryRevision) => Promise<Buffer>
  /** Preferred path: streams a verified immutable binary revision in bounded chunks. */
  streamBinary?: (revision: BinaryRevision, write: (chunk: Buffer) => Promise<void>) => Promise<void>
  normalDelayMs?: number
  maxDelayMs?: number
}

interface PendingMaterialization {
  fileId: string
  firstQueuedAt: number
  timer: NodeJS.Timeout
}

export class FilesystemMaterializer {
  readonly workspaceRoot: string
  readonly sessionId: string
  readonly replica: SessionReplica
  readonly index: MaterializationIndex
  readonly baselineStore: BaselineStore
  private readonly resolveBinary?: (revision: BinaryRevision) => Promise<Buffer>
  private readonly streamBinary?: (revision: BinaryRevision, write: (chunk: Buffer) => Promise<void>) => Promise<void>

  readonly normalDelayMs: number
  readonly maxDelayMs: number

  private pendingQueue = new Map<string, PendingMaterialization>()
  private scheduledWork: Promise<void> = Promise.resolve()
  private scheduledError: unknown = null
  public lastLatencyMs = 0

  constructor(options: MaterializerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot)
    this.sessionId = options.sessionId
    this.replica = options.replica
    this.index = options.index
    this.baselineStore = options.baselineStore
    this.resolveBinary = options.resolveBinary
    this.streamBinary = options.streamBinary
    this.normalDelayMs = options.normalDelayMs ?? 25
    this.maxDelayMs = options.maxDelayMs ?? 100
  }

  /**
   * Schedules a file for materialization with adaptive coalescing.
   */
  scheduleMaterialization(fileId: string): void {
    const existing = this.pendingQueue.get(fileId)
    const now = Date.now()

    if (existing) {
      clearTimeout(existing.timer)
      const elapsed = now - existing.firstQueuedAt

      // If elapsed reaches maxDelayMs, materialize immediately without waiting
      if (elapsed >= this.maxDelayMs) {
        this.pendingQueue.delete(fileId)
        this.queueMaterialization(fileId, existing.firstQueuedAt)
        return
      }

      // Otherwise reschedule with normalDelayMs
      const remainingToMax = this.maxDelayMs - elapsed
      const nextDelay = Math.min(this.normalDelayMs, remainingToMax)

      existing.timer = setTimeout(() => {
        this.pendingQueue.delete(fileId)
        this.queueMaterialization(fileId, existing.firstQueuedAt)
      }, nextDelay)
      return
    }

    const timer = setTimeout(() => {
      this.pendingQueue.delete(fileId)
      this.queueMaterialization(fileId, now)
    }, this.normalDelayMs)

    this.pendingQueue.set(fileId, {
      fileId,
      firstQueuedAt: now,
      timer,
    })
  }

  /**
   * Forces immediate flush of all pending materializations.
   */
  async flush(): Promise<void> {
    const fileIds = Array.from(this.pendingQueue.keys())
    for (const fileId of fileIds) {
      const pending = this.pendingQueue.get(fileId)
      if (pending) {
        clearTimeout(pending.timer)
        this.pendingQueue.delete(fileId)
        this.queueMaterialization(fileId, pending.firstQueuedAt)
      }
    }
    await this.scheduledWork
    if (this.scheduledError) throw this.scheduledError
  }

  private queueMaterialization(fileId: string, queuedAt: number): void {
    this.scheduledWork = this.scheduledWork
      .then(() => this.materializeFile(fileId, queuedAt))
      .catch((error: unknown) => {
        // Timer callbacks have no awaiting caller. Retain the failure for flush
        // rather than producing an unhandled rejection during shutdown.
        this.scheduledError ??= error
      })
  }

  dispose(): void {
    for (const pending of this.pendingQueue.values()) {
      clearTimeout(pending.timer)
    }
    this.pendingQueue.clear()
  }

  /**
   * Safely materializes a file to disk.
   */
  async materializeFile(fileId: string, queuedAt: number): Promise<void> {
    const entry = this.replica.tree.getEntry(fileId)
    if (!entry) return

    // Path collision suppression (Invariant C18)
    const conflicts = this.replica.detectConflicts()
    const hasCollision = conflicts.pathCollisions.some((c) => c.fileIds.includes(fileId))
    if (hasCollision) {
      console.warn(`[Materializer] Suppressing materialization of ${entry.path}: path collision active`)
      return
    }

    const previous = this.index.getByFileId(this.sessionId, fileId)

    if (conflicts.deleteModifyConflicts.some((conflict) => conflict.fileId === fileId)) {
      console.warn(`[Materializer] Keeping ${entry.path}: deletion overlaps edits awaiting resolution`)
      return
    }

    // Handle deleted entry
    if (entry.deleted) {
      await this.handleDeletion(entry, previous)
      this.lastLatencyMs = Date.now() - queuedAt
      return
    }

    const absPath = await this.resolvePath(entry.fileId, entry.path)
    if (!absPath) return

    let wrote = false
    if (entry.kind === "symlink") {
      wrote = await this.handleSymlink(entry, absPath)
    } else if (entry.kind === "text") {
      await this.handleTextMaterialization(entry, absPath)
      wrote = true
    } else if (entry.kind === "binary") {
      wrote = await this.handleBinaryMaterialization(entry, absPath)
    }
    if (!wrote) return

    // A rename or move leaves the old path on disk unless it is removed here.
    if (previous && previous.relativePath !== entry.path) {
      await this.removeStaleMaterialization(previous, absPath)
    }
    this.lastLatencyMs = Date.now() - queuedAt
  }

  private async resolvePath(fileId: string, relativePath: string): Promise<string | null> {
    try {
      return await resolveWorkspaceFilePath(this.workspaceRoot, relativePath)
    } catch (error) {
      if (error instanceof InvalidProjectPathError) {
        console.warn(`[Materializer] Refusing to materialize ${fileId}: ${error.message}`)
        return null
      }
      throw error
    }
  }

  private async handleTextMaterialization(entry: ProjectEntryRecord, absPath: string): Promise<void> {
    // Read the text and its Yjs state together, before any await, so the baseline
    // describes exactly the bytes written even if peer updates land mid-write.
    const content = this.replica.textDocs.getTextContent(entry.fileId)
    const snapshotUpdate = this.replica.textDocs.encodeStateAsUpdate(entry.fileId)
    const stateVector = this.replica.textDocs.getStateVector(entry.fileId)
    const contentHash = sha256(content)

    // Ensure parent directory exists
    const dir = path.dirname(absPath)
    await fs.mkdir(dir, { recursive: true })

    // Divergent disk protection (Section 28.3):
    // If a regular file already exists on disk, verify it equals last known baseline
    const baseline = this.baselineStore.getBaseline(entry.fileId)
    const existing = await fs.lstat(absPath).catch(() => null)
    if (existing?.isFile()) {
      const diskExisting = await fs.readFile(absPath, "utf8")
      if (baseline && diskExisting !== baseline.text && diskExisting !== content) {
        // Disk has divergent local edits! Save backup to prevent data loss
        const backupPath = `${absPath}.conflict.${Date.now()}`
        await fs.writeFile(backupPath, diskExisting, "utf8")
        console.warn(`[Materializer] Preserved divergent local file at ${backupPath}`)
      }
    }

    // Atomic write: write to temporary file in same folder, then rename
    const tempPath = `${absPath}.tmp.${entry.fileId}.${crypto.randomUUID().slice(0, 8)}`
    await fs.writeFile(tempPath, content, { encoding: "utf8", mode: entry.mode })
    await fs.chmod(tempPath, entry.mode & 0o777)
    await fs.rename(tempPath, absPath)

    const stat = await fs.lstat(absPath)

    // Update MaterializationIndex (Section 12.7, Invariant C14)
    this.index.recordMaterialization({
      sessionId: this.sessionId,
      fileId: entry.fileId,
      relativePath: entry.path,
      kind: "text",
      mode: entry.mode,
      diskHash: contentHash,
      diskSize: stat.size,
      diskMtimeMs: stat.mtimeMs,
      state: "materialized",
    })

    // Baseline B is the live doc as written, so a later external save diffs against
    // shared Yjs history and merges with concurrent peer edits (Section 10.11).
    this.baselineStore.setBaseline({
      fileId: entry.fileId,
      text: content,
      stateVector,
      snapshotUpdate,
      contentHash,
    })
  }

  private async handleSymlink(entry: ProjectEntryRecord, absPath: string): Promise<boolean> {
    if (!entry.symlinkTarget) return false

    const dir = path.dirname(absPath)
    await fs.mkdir(dir, { recursive: true })

    // Create the replacement first: a failed symlink syscall must leave the old
    // entry intact. Rename replaces the link itself, never its target.
    const tempPath = `${absPath}.tmp.${entry.fileId}.${crypto.randomUUID().slice(0, 8)}`
    try {
      await fs.symlink(entry.symlinkTarget, tempPath)
      await fs.rename(tempPath, absPath)
    } finally {
      await fs.rm(tempPath, { force: true })
    }
    const stat = await fs.lstat(absPath)
    const targetHash = sha256(entry.symlinkTarget)

    this.index.recordMaterialization({
      sessionId: this.sessionId,
      fileId: entry.fileId,
      relativePath: entry.path,
      kind: "symlink",
      mode: entry.mode,
      diskHash: targetHash,
      diskSize: stat.size,
      diskMtimeMs: stat.mtimeMs,
      state: "materialized",
    })
    return true
  }

  private async handleBinaryMaterialization(entry: ProjectEntryRecord, absPath: string): Promise<boolean> {
    const conflict = this.replica.binaryStore.detectConcurrentRevisions(entry.fileId)
    if (conflict) {
      console.warn(`[Materializer] Suppressing materialization of ${entry.path}: binary conflict active`)
      return false
    }
    const revision = this.replica.binaryStore.getHeadRevision(entry.fileId)
    if (!revision) return false
    if (!this.streamBinary && !this.resolveBinary) {
      throw new Error(`Cannot materialize binary ${entry.path}: no binary resolver is configured`)
    }

    const previous = this.index.getByFileId(this.sessionId, entry.fileId)
    const existing = await fs.lstat(absPath).catch(() => null)
    if (existing?.isFile()) {
      const diskHash = await hashRegularFile(absPath)
      if (previous && diskHash !== previous.diskHash && diskHash !== revision.contentHash) {
        const backupPath = `${absPath}.conflict.${Date.now()}`
        await fs.copyFile(absPath, backupPath)
        console.warn(`[Materializer] Preserved divergent local binary at ${backupPath}`)
      }
    }

    const result = await writeVerifiedBinaryAtomic({
      destinationPath: absPath,
      tempIdentity: entry.fileId,
      mode: entry.mode,
      expectedSize: revision.size,
      expectedHash: revision.contentHash,
      stream: async (write) => {
        if (this.streamBinary) {
          await this.streamBinary(revision, write)
          return
        }
        await write(await this.resolveBinary!(revision))
      },
    })

    this.index.recordMaterialization({
      sessionId: this.sessionId,
      fileId: entry.fileId,
      relativePath: entry.path,
      kind: "binary",
      mode: entry.mode,
      diskHash: result.contentHash,
      diskSize: result.size,
      diskMtimeMs: result.mtimeMs,
      state: "materialized",
    })
    return true
  }

  private async handleDeletion(entry: ProjectEntryRecord, previous: MaterializedEntry | null): Promise<void> {
    const relativePath = previous?.relativePath ?? entry.path
    if (this.replica.tree.listLiveEntries().some((other) => other.fileId !== entry.fileId && ConflictEngine.normalizeForVolumeComparison(other.path) === ConflictEngine.normalizeForVolumeComparison(relativePath))) {
      this.index.remove(this.sessionId, entry.fileId)
      this.baselineStore.deleteBaseline(entry.fileId)
      return
    }
    const absPath = await this.resolvePath(entry.fileId, relativePath)

    if (absPath) {
      const diskHash = await hashDiskEntry(absPath, previous?.kind ?? entry.kind)
      if (diskHash !== null) {
        const expectedHash = previous?.diskHash ?? this.baselineStore.getBaseline(entry.fileId)?.contentHash
        if (diskHash !== expectedHash) {
          // Bytes nobody ingested: keep them, so the delete surfaces as a
          // delete/modify conflict instead of silently discarding work (C18).
          console.warn(`[Materializer] Kept ${relativePath}: it changed locally after the last sync`)
          return
        }
        await fs.unlink(absPath)
      }
    }

    this.index.remove(this.sessionId, entry.fileId)
    this.baselineStore.deleteBaseline(entry.fileId)
  }

  private async removeStaleMaterialization(previous: MaterializedEntry, currentAbsPath: string): Promise<void> {
    if (this.replica.tree.listLiveEntries().some((other) => other.fileId !== previous.fileId && ConflictEngine.normalizeForVolumeComparison(other.path) === ConflictEngine.normalizeForVolumeComparison(previous.relativePath))) return
    const staleAbsPath = await this.resolvePath(previous.fileId, previous.relativePath)
    if (!staleAbsPath) return

    const staleStat = await fs.lstat(staleAbsPath).catch(() => null)
    if (!staleStat) return

    // On a case-insensitive volume a case-only rename writes the same file.
    const currentStat = await fs.lstat(currentAbsPath)
    if (staleStat.ino === currentStat.ino && staleStat.dev === currentStat.dev) return

    const diskHash = await hashDiskEntry(staleAbsPath, previous.kind)
    if (diskHash !== previous.diskHash) {
      console.warn(`[Materializer] Kept ${previous.relativePath} after its rename: it changed locally after the last sync`)
      return
    }
    await fs.unlink(staleAbsPath)
  }
}

function sha256(data: string | Buffer): string {
  return createHash("sha256").update(data).digest("hex")
}

async function hashRegularFile(absPath: string): Promise<string> {
  const handle = await fs.open(absPath, "r")
  const digest = createHash("sha256")
  try {
    let position = 0
    for (;;) {
      const buffer = Buffer.allocUnsafe(HASH_READ_BYTES)
      const { bytesRead } = await handle.read(buffer, 0, buffer.length, position)
      if (!bytesRead) break
      digest.update(buffer.subarray(0, bytesRead))
      position += bytesRead
    }
    return digest.digest("hex")
  } finally {
    await handle.close()
  }
}

async function hashDiskEntry(absPath: string, kind: string): Promise<string | null> {
  try {
    const stat = await fs.lstat(absPath)
    if (kind === "symlink") {
      if (!stat.isSymbolicLink()) return null
      return sha256(await fs.readlink(absPath))
    }
    if (!stat.isFile()) return null
    return hashRegularFile(absPath)
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null
    throw error
  }
}
