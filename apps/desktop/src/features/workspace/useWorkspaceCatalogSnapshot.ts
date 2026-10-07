import { useSyncExternalStore } from "react"

import type {
  WorkspaceCatalogSnapshot,
  WorkspaceCatalogSnapshotEntry,
} from "@shared/workspaceTypes"
import { invalidateProjectWorkspaceResolution } from "@/app/resources/workspaceResources"
import { workspaceSnapshotBindingChanged } from "./catalogSnapshotComparison"

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
let initialFetchPromise: Promise<void> | null = null
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
  const previous = snapshot
  snapshot = next
  const projectIds = new Set([...Object.keys(previous?.entries ?? {}), ...Object.keys(next.entries)])
  for (const projectId of projectIds) {
    if (workspaceSnapshotBindingChanged(previous?.entries[projectId], next.entries[projectId])) {
      invalidateProjectWorkspaceResolution(projectId)
    }
  }
  emit()
}

function ensureInitialized(): void {
  if (initialFetchDone || initialFetchPromise) return
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

  initialFetchPromise = workspaceApi
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
    .finally(() => {
      initialFetchPromise = null
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

const subscribeDisabled = () => () => {}
const getEmptySnapshot = () => null

export function useWorkspaceCatalogSnapshot(enabled = true): WorkspaceCatalogSnapshot | null {
  return useSyncExternalStore(
    enabled ? subscribe : subscribeDisabled,
    enabled ? () => snapshot : getEmptySnapshot,
    getEmptySnapshot,
  )
}
