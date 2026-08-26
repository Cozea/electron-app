import fs from "node:fs"
import path from "node:path"
import { BrowserWindow } from "electron"
import * as Effect from "effect/Effect"

import type {
  WorkspaceCatalogSnapshot,
  WorkspaceCatalogSnapshotEntry,
} from "../../shared/workspaceTypes.ts"
import { WorkspaceCatalog, type WorkspaceCatalogInterface } from "./WorkspaceCatalog.ts"
import { waitForWorkspaceCatalogRuntime } from "./WorkspaceCatalogRuntime.ts"

export const CATALOG_SNAPSHOT_CHANGED_CHANNEL = "workspace:catalogSnapshotChanged"

const REFRESH_DEBOUNCE_MS = 150
const VERIFIER_SWEEP_INTERVAL_MS = 5 * 60 * 1000
const VERIFICATION_STALE_AFTER_MS = 10 * 60 * 1000
const WATCHER_DEBOUNCE_MS = 500
const MAX_WATCHED_ROOTS = 50

let currentSnapshot: WorkspaceCatalogSnapshot | null = null
let revision = 0
let started = false
let refreshTimer: NodeJS.Timeout | null = null
let sweepTimer: NodeJS.Timeout | null = null
let refreshInFlight: Promise<WorkspaceCatalogSnapshot> | null = null
// Set when a refresh is requested while one is already in flight, so a mutation
// that commits after the in-flight rebuild's SELECT can still be picked up by a
// trailing rebuild instead of being silently dropped until the next mutation.
let refreshDirty = false

// Parent-directory watchers keyed by the watched directory; each watcher
// covers every workspace whose root lives directly inside that directory.
const parentWatchers = new Map<string, fs.FSWatcher>()
const watchedBasenames = new Map<string, Map<string, string>>() // parentDir -> basename -> workspaceId
const pendingWatcherVerifies = new Map<string, NodeJS.Timeout>()

async function runCatalog<A>(
  f: (catalog: WorkspaceCatalogInterface) => Effect.Effect<A>,
): Promise<A> {
  const runtime = await waitForWorkspaceCatalogRuntime()
  return runtime.runPromise(
    Effect.flatMap(Effect.service(WorkspaceCatalog), f) as Effect.Effect<A, never, WorkspaceCatalog>,
  )
}

function broadcast(snapshot: WorkspaceCatalogSnapshot): void {
  for (const window of BrowserWindow.getAllWindows()) {
    if (!window.isDestroyed()) {
      window.webContents.send(CATALOG_SNAPSHOT_CHANGED_CHANNEL, snapshot)
    }
  }
}

/**
 * Stable, comparison-only serialization of the snapshot entries:
 *
 *  - Keys are sorted so the result is independent of the SQL scan order
 *    (`SELECT ... WHERE is_active = 1` has no `ORDER BY`, so two rebuilds of the
 *    same content can come back in a different row order). [#44]
 *  - The verify sweep bumps `verifiedAt`/`updatedAt` unconditionally every time
 *    it re-verifies a workspace, even when nothing semantically changed, so
 *    those timestamps are excluded from the compare to avoid a redundant
 *    broadcast on each sweep. [#32]
 */
function canonicalizeForCompare(
  entries: Record<string, WorkspaceCatalogSnapshotEntry>,
): string {
  const normalized = Object.keys(entries)
    .sort()
    .map((key) => {
      const entry = entries[key]
      const { verifiedAt: _verifiedAt, updatedAt: _updatedAt, ...workspace } =
        entry.workspace
      return [key, { ...entry, workspace }] as const
    })
  return JSON.stringify(normalized)
}

function entriesEqual(
  left: Record<string, WorkspaceCatalogSnapshotEntry>,
  right: Record<string, WorkspaceCatalogSnapshotEntry>,
): boolean {
  return canonicalizeForCompare(left) === canonicalizeForCompare(right)
}

async function rebuildSnapshot(): Promise<WorkspaceCatalogSnapshot> {
  const entryList = await runCatalog((c) => c.buildSnapshotEntries())
  const entries: Record<string, WorkspaceCatalogSnapshotEntry> = {}
  for (const entry of entryList) {
    entries[entry.projectId] = entry
  }

  if (currentSnapshot && entriesEqual(currentSnapshot.entries, entries)) {
    return currentSnapshot
  }

  revision += 1
  currentSnapshot = {
    revision,
    generatedAt: Date.now(),
    entries,
  }
  syncRootWatchers(entryList)
  broadcast(currentSnapshot)
  return currentSnapshot
}

function refreshNow(): Promise<WorkspaceCatalogSnapshot> {
  if (refreshInFlight) {
    // A rebuild's SELECT was taken before this caller's mutation committed;
    // flag a trailing rebuild so the change is not dropped until the next
    // unrelated mutation.
    refreshDirty = true
    return refreshInFlight
  }
  refreshInFlight = rebuildSnapshot()
    .catch((error) => {
      console.error("[CatalogSnapshot] refresh failed:", error)
      return (
        currentSnapshot ?? {
          revision,
          generatedAt: Date.now(),
          entries: {},
        }
      )
    })
    .finally(() => {
      refreshInFlight = null
      if (refreshDirty) {
        refreshDirty = false
        void refreshNow()
      }
    })
  return refreshInFlight
}

/** Debounced refresh + broadcast. Call after any catalog mutation. */
export function notifyWorkspaceCatalogChanged(): void {
  if (refreshTimer) {
    clearTimeout(refreshTimer)
  }
  refreshTimer = setTimeout(() => {
    refreshTimer = null
    void refreshNow()
  }, REFRESH_DEBOUNCE_MS)
}

/** Current snapshot, building it on first access. */
export async function getCatalogSnapshot(): Promise<WorkspaceCatalogSnapshot> {
  if (currentSnapshot) {
    return currentSnapshot
  }
  return refreshNow()
}

function scheduleWatcherVerify(workspaceId: string): void {
  const existing = pendingWatcherVerifies.get(workspaceId)
  if (existing) {
    clearTimeout(existing)
  }
  pendingWatcherVerifies.set(
    workspaceId,
    setTimeout(() => {
      pendingWatcherVerifies.delete(workspaceId)
      void runCatalog((c) => c.verify(workspaceId))
        .then(() => notifyWorkspaceCatalogChanged())
        .catch(() => {})
    }, WATCHER_DEBOUNCE_MS),
  )
}

/**
 * Watch the parent directory of each active workspace root so a delete/rename
 * of the folder demotes the binding without waiting for the TTL sweep. The
 * parent (not the root itself) keeps this quiet during normal file churn.
 */
function syncRootWatchers(entries: WorkspaceCatalogSnapshotEntry[]): void {
  const nextBasenames = new Map<string, Map<string, string>>()

  for (const entry of entries.slice(0, MAX_WATCHED_ROOTS)) {
    const rootPath = entry.workspace.projectRootPath
    const parentDir = path.dirname(rootPath)
    const basename = path.basename(rootPath)
    const forParent = nextBasenames.get(parentDir) ?? new Map<string, string>()
    forParent.set(basename, entry.workspace.workspaceId)
    nextBasenames.set(parentDir, forParent)
  }

  for (const [parentDir, watcher] of parentWatchers) {
    if (!nextBasenames.has(parentDir)) {
      watcher.close()
      parentWatchers.delete(parentDir)
      watchedBasenames.delete(parentDir)
    }
  }

  for (const [parentDir, basenames] of nextBasenames) {
    watchedBasenames.set(parentDir, basenames)
    if (parentWatchers.has(parentDir)) {
      continue
    }
    try {
      const watcher = fs.watch(parentDir, (_eventType, filename) => {
        if (!filename) return
        const workspaceId = watchedBasenames.get(parentDir)?.get(filename.toString())
        if (workspaceId) {
          scheduleWatcherVerify(workspaceId)
        }
      })
      watcher.on("error", () => {
        watcher.close()
        parentWatchers.delete(parentDir)
      })
      parentWatchers.set(parentDir, watcher)
    } catch {
      // Watching is best-effort; the TTL sweep still covers this root.
    }
  }
}

async function runVerifierSweep(): Promise<void> {
  const snapshot = await getCatalogSnapshot()
  const staleBefore = Date.now() - VERIFICATION_STALE_AFTER_MS
  const stale = Object.values(snapshot.entries).filter((entry) => {
    const verifiedAt = entry.workspace.verifiedAt
    return typeof verifiedAt !== "number" || verifiedAt < staleBefore
  })

  for (const entry of stale) {
    try {
      await runCatalog((c) => c.verify(entry.workspace.workspaceId))
    } catch {
      // Per-workspace verification is best-effort.
    }
  }

  if (stale.length > 0) {
    notifyWorkspaceCatalogChanged()
  }
}

/** Boot: initial snapshot, TTL sweep loop, root watchers. Idempotent. */
export async function startCatalogSnapshotService(): Promise<void> {
  if (started) return
  started = true

  await refreshNow()
  // First sweep shortly after boot verifies everything the snapshot serves
  // optimistically; later sweeps only touch stale entries.
  sweepTimer = setInterval(() => {
    void runVerifierSweep()
  }, VERIFIER_SWEEP_INTERVAL_MS)
  void runVerifierSweep()
}

export function stopCatalogSnapshotService(): void {
  started = false
  if (refreshTimer) {
    clearTimeout(refreshTimer)
    refreshTimer = null
  }
  if (sweepTimer) {
    clearInterval(sweepTimer)
    sweepTimer = null
  }
  for (const timer of pendingWatcherVerifies.values()) {
    clearTimeout(timer)
  }
  pendingWatcherVerifies.clear()
  for (const watcher of parentWatchers.values()) {
    watcher.close()
  }
  parentWatchers.clear()
  watchedBasenames.clear()
}
