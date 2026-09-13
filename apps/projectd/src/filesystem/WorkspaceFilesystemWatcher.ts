/**
 * Workspace Filesystem Watcher and Reconciliation Coordinator.
 *
 * Master Specification: Section 12.1 - 12.8
 *
 * Startup Order (Section 12.3):
 * 1. Open durable local DB;
 * 2. Start FSEvents and buffer hints;
 * 3. Mark replica 'reconciling';
 * 4. Full scan in-scope tree;
 * 5. Compare against materialization index;
 * 6. Process genuine offline local changes;
 * 7. Replay buffered watcher hints;
 * 8. Declare 'ready'.
 */

import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import path from "node:path"

import type { ScopePolicy } from "./ScopePolicy"
import { StableFileReader } from "./StableRead"
import type { MaterializationIndex } from "./MaterializationIndex"
import { WorkspaceScanner } from "./Scanner"
import { FSEventsClient, type FileEventSource, type NativeFSEventItem } from "./FSEventsClient"

export type WatcherLifecycle = "stopped" | "starting" | "reconciling" | "ready"

export interface NormalizedFileChange {
  type: "change"
  relativePath: string
  absolutePath: string
  contentHash: string
  size: number
  mode: number
  isSymlink: boolean
  symlinkTarget?: string
}

export interface NormalizedFileDelete {
  type: "delete"
  relativePath: string
  fileId?: string
}

export interface NormalizedFileRename {
  type: "rename"
  fromPath: string
  toPath: string
}

export type NormalizedFsEvent =
  | NormalizedFileChange
  | NormalizedFileDelete
  | NormalizedFileRename

export class WorkspaceFilesystemWatcher extends EventEmitter {
  readonly workspaceRoot: string
  readonly sessionId: string
  readonly scopePolicy: ScopePolicy
  readonly index: MaterializationIndex
  readonly scanner: WorkspaceScanner
  readonly stableReader: StableFileReader
  readonly fseventsClient: FileEventSource

  private lifecycle: WatcherLifecycle = "stopped"
  private bufferedHints: NativeFSEventItem[] = []

  constructor(options: {
    workspaceRoot: string
    sessionId: string
    scopePolicy: ScopePolicy
    index: MaterializationIndex
    stableReader?: StableFileReader
    fseventsClient?: FileEventSource
  }) {
    super()
    this.workspaceRoot = path.resolve(options.workspaceRoot)
    this.sessionId = options.sessionId
    this.scopePolicy = options.scopePolicy
    this.index = options.index
    this.stableReader = options.stableReader ?? new StableFileReader()
    this.scanner = new WorkspaceScanner(this.workspaceRoot, this.scopePolicy, this.stableReader)
    this.fseventsClient = options.fseventsClient ?? new FSEventsClient(this.workspaceRoot)
    // Registered once, so a watcher stopped and started again reports each event once.
    this.fseventsClient.on("events", (items) => this.handleRawEvents(items))
    this.fseventsClient.on("dropped", (reason) => this.handleDropped(reason))
  }

  get state(): WatcherLifecycle {
    return this.lifecycle
  }

  /**
   * Implements Section 12.3 Startup Order.
   */
  async start(): Promise<void> {
    if (this.lifecycle !== "stopped") return
    this.lifecycle = "starting"

    // Step 2: Start FSEvents and buffer hints
    this.bufferedHints = []
    await this.fseventsClient.start()

    // Step 3: Mark replica 'reconciling'
    this.lifecycle = "reconciling"
    this.emit("state", "reconciling")

    // Step 4 & 5: Full scan in-scope tree and compare against materialization index
    const diff = await this.scanner.diffAgainstIndex(this.sessionId, this.index)

    // Step 6: Process genuine offline local changes. Deletes go first, so a file that
    // was renamed is known to be gone when its new name turns up.
    for (const deleted of diff.deleted) {
      this.emit("event", {
        type: "delete",
        relativePath: deleted.relativePath,
        fileId: deleted.fileId,
      } as NormalizedFileDelete)
    }

    for (const created of diff.created) {
      if (created.contentHash) {
        this.emit("event", {
          type: "change",
          relativePath: created.relativePath,
          absolutePath: created.absolutePath,
          contentHash: created.contentHash,
          size: created.size,
          mode: created.mode,
          isSymlink: created.isSymlink,
        } as NormalizedFileChange)
      }
    }

    for (const modified of diff.modified) {
      if (modified.contentHash) {
        this.emit("event", {
          type: "change",
          relativePath: modified.relativePath,
          absolutePath: modified.absolutePath,
          contentHash: modified.contentHash,
          size: modified.size,
          mode: modified.mode,
          isSymlink: modified.isSymlink,
        } as NormalizedFileChange)
      }
    }

    // Step 7: Replay buffered watcher hints
    const replayHints = [...this.bufferedHints]
    this.bufferedHints = []

    for (const hint of replayHints) {
      await this.processEventItem(hint)
    }

    // Step 8: Transition to 'ready'
    this.lifecycle = "ready"
    this.emit("state", "ready")
  }

  private isStopped(): boolean {
    return this.lifecycle === "stopped"
  }

  private handleRawEvents(items: NativeFSEventItem[]): void {
    if (this.isStopped()) return
    if (this.lifecycle === "starting" || this.lifecycle === "reconciling") {
      this.bufferedHints.push(...items)
      return
    }

    void (async () => {
      for (const item of items) {
        if (this.isStopped()) break
        await this.processEventItem(item)
      }
    })().catch((error: unknown) => {
      if (this.isStopped()) return
      console.warn("[WorkspaceWatcher] Event processing failed:", error)
    })
  }

  private handleDropped(reason: string): void {
    console.warn(`[WorkspaceWatcher] FSEvents dropped: ${reason}. Scheduling rescan.`)
    this.emit("rescan_needed", reason)
    void this.rescan()
  }

  async rescan(): Promise<void> {
    if (this.isStopped()) return
    const diff = await this.scanner.diffAgainstIndex(this.sessionId, this.index)
    if (this.isStopped()) return
    // Deletes first, as at startup, so renames pair up.
    for (const d of diff.deleted) {
      this.emit("event", {
        type: "delete",
        relativePath: d.relativePath,
        fileId: d.fileId,
      } as NormalizedFileDelete)
    }
    for (const c of diff.created) {
      if (c.contentHash) {
        this.emit("event", {
          type: "change",
          relativePath: c.relativePath,
          absolutePath: c.absolutePath,
          contentHash: c.contentHash,
          size: c.size,
          mode: c.mode,
          isSymlink: c.isSymlink,
        } as NormalizedFileChange)
      }
    }
    for (const m of diff.modified) {
      if (m.contentHash) {
        this.emit("event", {
          type: "change",
          relativePath: m.relativePath,
          absolutePath: m.absolutePath,
          contentHash: m.contentHash,
          size: m.size,
          mode: m.mode,
          isSymlink: m.isSymlink,
        } as NormalizedFileChange)
      }
    }
  }

  private async processEventItem(item: NativeFSEventItem): Promise<void> {
    // A folder moved or removed arrives as one event for the folder; its files are found by scanning.
    if (item.isDir) {
      await this.rescan()
      return
    }
    const rel = this.scopePolicy.normalizeRelativePath(item.path)

    if (this.scopePolicy.isAlwaysIgnored(rel)) {
      return
    }

    if (this.isStopped()) return
    const inScope = await this.scopePolicy.isInScope(rel)
    if (!inScope || this.isStopped()) {
      return
    }

    const absPath = path.isAbsolute(item.path)
      ? item.path
      : path.join(this.workspaceRoot, item.path)

    if (item.isRemoved) {
      // Verify if actually deleted
      try {
        await fs.lstat(absPath)
      } catch (err: any) {
        if (err.code === "ENOENT") {
          if (this.isStopped()) return
          this.emit("event", {
            type: "delete",
            relativePath: rel,
          } as NormalizedFileDelete)
          return
        }
      }
    }

    // The watcher needs stable hash/metadata only. The host reads actual payload bytes
    // once if this proves to be a genuine local modification.
    const stable = await this.stableReader.readMetadata(absPath)
    if (this.isStopped()) return
    if (!stable.exists || !stable.contentHash) {
      // File deleted during atomic-save transition
      this.emit("event", {
        type: "delete",
        relativePath: rel,
      } as NormalizedFileDelete)
      return
    }

    // Invariant C14 / Section 12.7: Hash-based echo classification
    if (this.isStopped()) return
    const indexed = this.index.getByPath(this.sessionId, rel)
    const mode = (stable.mode ?? 0o100644) & 0o111 ? 0o100755 : 0o100644
    const sameKind = stable.isSymlink === (indexed?.kind === "symlink")
    const isEcho = sameKind && this.index.isEcho(this.sessionId, rel, stable.contentHash) && (stable.isSymlink || indexed?.mode === mode)
    if (isEcho) {
      // Suppress only matching content and mode; chmod is a real shared edit.
      return
    }

    // Genuine local modification
    this.emit("event", {
      type: "change",
      relativePath: rel,
      absolutePath: absPath,
      contentHash: stable.contentHash,
      size: stable.size ?? 0,
      mode: stable.mode ?? 0o100644,
      isSymlink: stable.isSymlink,
      symlinkTarget: stable.symlinkTarget,
    } as NormalizedFileChange)
  }

  stop(): void {
    this.fseventsClient.stop()
    this.bufferedHints = []
    this.lifecycle = "stopped"
    this.emit("state", "stopped")
  }
}
