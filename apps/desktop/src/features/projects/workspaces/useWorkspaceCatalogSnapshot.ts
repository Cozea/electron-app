import { useSyncExternalStore } from "react"

import type {
  WorkspaceCatalogSnapshot,
  WorkspaceCatalogSnapshotEntry,
} from "../../../../../../shared/workspaceTypes"

/**
 * Renderer mirror of the pushed catalog snapshot: one IPC fetch at first use,
 * then main-process pushes on every catalog change. Read-only consumers (the
 * sidebar's project rows) subscribe here instead of issuing a resolveProject
 * round-trip per row.
 */
let snapshot: WorkspaceCatalogSnapshot | null = null
// The push listener is attached exactly once and kept for the app's lifetime;
// the initial fetch is tracked separately so it can be retried on a later
// subscribe WITHOUT registering a duplicate ipcRenderer listener (which leaked
// N listeners — and N+1 applySnapshot runs per push — after one slow-boot
// fetch rejection).
let listenerAttached = false
let initialFetchDone = false
const listeners = new Set<() => void>()

function emit(): void {
  for (const listener of listeners) {
    listener()
  }
}

function applySnapshot(next: WorkspaceCatalogSnapshot): void {
  // Pushes can race the initial fetch; revisions are monotonic, so never
  // replace a newer snapshot with an older one.
  if (snapshot && next.revision <= snapshot.revision) {
    return
  }
  snapshot = next
  emit()
}

function ensureInitialized(): void {
  if (initialFetchDone) return
  const workspaceApi = typeof window !== "undefined" ? window.electronAPI?.workspace : undefined
  if (!workspaceApi?.getCatalogSnapshot || !workspaceApi.onCatalogSnapshotChanged) {
    return
  }

  // Attach the push listener once; pushes keep the mirror fresh even if the
  // initial fetch below fails.
  if (!listenerAttached) {
    listenerAttached = true
    workspaceApi.onCatalogSnapshotChanged((next) => {
      applySnapshot(next)
    })
  }

  void workspaceApi
    .getCatalogSnapshot()
    .then((next) => {
      initialFetchDone = true
      applySnapshot(next)
    })
    .catch((error) => {
      // Leave initialFetchDone false so a later subscribe retries the fetch —
      // but the listener stays attached, so no duplicate registration.
      console.warn("[WorkspaceCatalogSnapshot] initial fetch failed:", error)
    })
}

function subscribe(listener: () => void): () => void {
  ensureInitialized()
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function useWorkspaceSnapshotEntry(
  projectId: string | null | undefined,
): WorkspaceCatalogSnapshotEntry | null {
  return useSyncExternalStore(
    subscribe,
    () => (projectId ? snapshot?.entries[projectId] ?? null : null),
    () => null,
  )
}

export function useWorkspaceCatalogSnapshot(): WorkspaceCatalogSnapshot | null {
  return useSyncExternalStore(
    subscribe,
    () => snapshot,
    () => null,
  )
}
