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
import { FSEventsClient, type NativeFSEventItem } from "./FSEventsClient"

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
  readonly fseventsClient: FSEventsClient

  private lifecycle: WatcherLifecycle = "stopped"
  private bufferedHints: NativeFSEventItem[] = []
  private isProcessingEvent = false

  constructor(options: {
    workspaceRoot: string
    sessionId: string
    scopePolicy: ScopePolicy
    index: MaterializationIndex
    stableReader?: StableFileReader
    fseventsClient?: FSEventsClient
  }) {
    super()
    this.workspaceRoot = path.resolve(options.workspaceRoot)
    this.sessionId = options.sessionId
    this.scopePolicy = options.scopePolicy
    this.index = options.index
    this.stableReader = options.stableReader ?? new StableFileReader()
    this.scanner = new WorkspaceScanner(this.workspaceRoot, this.scopePolicy, this.stableReader)
    this.fseventsClient = options.fseventsClient ?? new FSEventsClient(this.workspaceRoot)
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
    this.fseventsClient.on("events", (items) => this.handleRawEvents(items))
    this.fseventsClient.on("dropped", (reason) => this.handleDropped(reason))

    await this.fseventsClient.start()

    // Step 3: Mark replica 'reconciling'
    this.lifecycle = "reconciling"
    this.emit("state", "reconciling")

    // Step 4 & 5: Full scan in-scope tree and compare against materialization index
    const diff = await this.scanner.diffAgainstIndex(this.sessionId, this.index)

    // Step 6: Process genuine offline local changes
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

    for (const deleted of diff.deleted) {
      this.emit("event", {
        type: "delete",
        relativePath: deleted.relativePath,
        fileId: deleted.fileId,
      } as NormalizedFileDelete)
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

  private handleRawEvents(items: NativeFSEventItem[]): void {
    if (this.lifecycle === "starting" || this.lifecycle === "reconciling") {
      this.bufferedHints.push(...items)
      return
    }

    void (async () => {
      for (const item of items) {
        await this.processEventItem(item)
      }
    })()
  }

  private handleDropped(reason: string): void {
    console.warn(`[WorkspaceWatcher] FSEvents dropped: ${reason}. Scheduling rescan.`)
    this.emit("rescan_needed", reason)
    void this.rescan()
  }

  async rescan(): Promise<void> {
    const diff = await this.scanner.diffAgainstIndex(this.sessionId, this.index)
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
    for (const d of diff.deleted) {
      this.emit("event", {
        type: "delete",
        relativePath: d.relativePath,
        fileId: d.fileId,
      } as NormalizedFileDelete)
    }
  }

  private async processEventItem(item: NativeFSEventItem): Promise<void> {
    const rel = this.scopePolicy.normalizeRelativePath(item.path)

    if (this.scopePolicy.isAlwaysIgnored(rel)) {
      return
    }

    const inScope = await this.scopePolicy.isInScope(rel)
    if (!inScope) {
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
          this.emit("event", {
            type: "delete",
            relativePath: rel,
          } as NormalizedFileDelete)
          return
        }
      }
    }

    // Read stable bytes
    const stable = await this.stableReader.read(absPath)
    if (!stable.exists || !stable.contentHash) {
      // File deleted during atomic-save transition
      this.emit("event", {
        type: "delete",
        relativePath: rel,
      } as NormalizedFileDelete)
      return
    }

    // Invariant C14 / Section 12.7: Hash-based echo classification
    const isEcho = this.index.isEcho(this.sessionId, rel, stable.contentHash)
    if (isEcho) {
      // Echo suppression: Disk content matches exact materialized hash. No event emitted!
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
