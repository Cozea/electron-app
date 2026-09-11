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
 * - Path collision suppression (Invariant C18).
 */

import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import path from "node:path"
import * as Y from "yjs"

import type { BaselineStore } from "../collaboration/BaselineStore"
import type { MaterializationIndex } from "./MaterializationIndex"
import type { SessionReplica } from "../collaboration/SessionReplica"
import type { ProjectEntryRecord } from "../collaboration/TreeDoc"

export interface MaterializerOptions {
  workspaceRoot: string
  sessionId: string
  replica: SessionReplica
  index: MaterializationIndex
  baselineStore: BaselineStore
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

  readonly normalDelayMs: number
  readonly maxDelayMs: number

  private pendingQueue = new Map<string, PendingMaterialization>()
  private isMaterializing = false
  public lastLatencyMs = 0

  constructor(options: MaterializerOptions) {
    this.workspaceRoot = path.resolve(options.workspaceRoot)
    this.sessionId = options.sessionId
    this.replica = options.replica
    this.index = options.index
    this.baselineStore = options.baselineStore
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
        void this.materializeFile(fileId, now)
        return
      }

      // Otherwise reschedule with normalDelayMs
      const remainingToMax = this.maxDelayMs - elapsed
      const nextDelay = Math.min(this.normalDelayMs, remainingToMax)

      existing.timer = setTimeout(() => {
        this.pendingQueue.delete(fileId)
        void this.materializeFile(fileId, existing.firstQueuedAt)
      }, nextDelay)
      return
    }

    const timer = setTimeout(() => {
      this.pendingQueue.delete(fileId)
      void this.materializeFile(fileId, now)
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
        await this.materializeFile(fileId, pending.firstQueuedAt)
      }
    }
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

    const absPath = path.join(this.workspaceRoot, entry.path)

    // Handle deleted entry
    if (entry.deleted) {
      await this.handleDeletion(entry, absPath)
      this.lastLatencyMs = Date.now() - queuedAt
      return
    }

    if (entry.kind === "symlink") {
      await this.handleSymlink(entry, absPath)
      this.lastLatencyMs = Date.now() - queuedAt
      return
    }

    if (entry.kind === "text") {
      await this.handleTextMaterialization(entry, absPath)
      this.lastLatencyMs = Date.now() - queuedAt
      return
    }
  }

  private async handleTextMaterialization(entry: ProjectEntryRecord, absPath: string): Promise<void> {
    const content = this.replica.textDocs.getTextContent(entry.fileId)
    const contentHash = createHash("sha256").update(content).digest("hex")

    // Ensure parent directory exists
    const dir = path.dirname(absPath)
    await fs.mkdir(dir, { recursive: true })

    // Divergent disk protection (Section 28.3):
    // If file already exists on disk, verify it equals last known baseline
    const baseline = this.baselineStore.getBaseline(entry.fileId)
    try {
      const diskExisting = await fs.readFile(absPath, "utf8")
      if (baseline && diskExisting !== baseline.text && diskExisting !== content) {
        // Disk has divergent local edits! Save backup to prevent data loss
        const backupPath = `${absPath}.conflict.${Date.now()}`
        await fs.writeFile(backupPath, diskExisting, "utf8")
        console.warn(`[Materializer] Preserved divergent local file at ${backupPath}`)
      }
    } catch {
      // File does not exist on disk yet
    }

    // Atomic write: write to temporary file in same folder, then rename
    const tempPath = `${absPath}.tmp.${entry.fileId}.${crypto.randomUUID().slice(0, 8)}`
    await fs.writeFile(tempPath, content, { encoding: "utf8", mode: entry.mode })
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

    // Update BaselineStore
    const shadowDoc = new Y.Doc({ guid: `shadow:${entry.fileId}` })
    const shadowText = shadowDoc.getText("content")
    shadowDoc.transact(() => shadowText.insert(0, content))
    this.baselineStore.setBaseline({
      fileId: entry.fileId,
      text: content,
      stateVector: Y.encodeStateVector(shadowDoc),
      snapshotUpdate: Y.encodeStateAsUpdate(shadowDoc),
      contentHash,
    })
    shadowDoc.destroy()
  }

  private async handleSymlink(entry: ProjectEntryRecord, absPath: string): Promise<void> {
    if (!entry.symlinkTarget) return

    const dir = path.dirname(absPath)
    await fs.mkdir(dir, { recursive: true })

    try {
      await fs.unlink(absPath)
    } catch {
      // Ignore if doesn't exist
    }

    await fs.symlink(entry.symlinkTarget, absPath)
    const stat = await fs.lstat(absPath)
    const targetHash = createHash("sha256").update(entry.symlinkTarget).digest("hex")

    this.index.recordMaterialization({
      sessionId: this.sessionId,
      fileId: entry.fileId,
      relativePath: entry.path,
      kind: "symlink",
      mode: entry.mode,
      diskHash: targetHash,
      diskSize: entry.symlinkTarget.length,
      diskMtimeMs: stat.mtimeMs,
      state: "materialized",
    })
  }

  private async handleDeletion(entry: ProjectEntryRecord, absPath: string): Promise<void> {
    try {
      await fs.unlink(absPath)
    } catch {
      // Already deleted
    }

    this.index.remove(this.sessionId, entry.fileId)
    this.baselineStore.deleteBaseline(entry.fileId)
  }
}
