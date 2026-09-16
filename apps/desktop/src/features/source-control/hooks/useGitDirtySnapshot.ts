import { useEffect, useState } from 'react'

import type { GitDirtyStateSnapshot } from '@shared/electronApiTypes'

type SnapshotListener = (snapshot: GitDirtyStateSnapshot | null) => void

interface SharedSubscription {
  listeners: Set<SnapshotListener>
  latest: GitDirtyStateSnapshot | null
  detachChannel: () => void
}

/**
 * One IPC subscription per workspace, shared by every caller in this window.
 *
 * The main process keys dirty-state subscribers by `WebContents` id, so a
 * second independent subscription from the same window replaces the first in
 * that map, and whichever unmounts first cancels the stream for both. Sharing
 * a single subscription keeps that from being expressible.
 */
const sharedSubscriptions = new Map<string, SharedSubscription>()

function subscribeToDirtyState(
  workspaceId: string,
  authorName: string | undefined,
  listener: SnapshotListener,
): () => void {
  let shared = sharedSubscriptions.get(workspaceId)

  if (!shared) {
    const syncApi = window.electronAPI?.workspaceSync
    if (
      !syncApi?.subscribeGitDirtyState ||
      !syncApi?.unsubscribeGitDirtyState ||
      !syncApi?.onGitDirtyStateChange
    ) {
      listener(null)
      return () => {}
    }

    const created: SharedSubscription = {
      listeners: new Set(),
      latest: null,
      detachChannel: () => {},
    }

    const broadcast = (snapshot: GitDirtyStateSnapshot | null): void => {
      // Replaced already: this subscription lost its claim on the workspace.
      if (sharedSubscriptions.get(workspaceId) !== created) return
      created.latest = snapshot
      for (const each of Array.from(created.listeners)) each(snapshot)
    }

    created.detachChannel = syncApi.onGitDirtyStateChange((snapshot) => {
      if (snapshot.workspaceId !== workspaceId) return
      broadcast(snapshot)
    })

    sharedSubscriptions.set(workspaceId, created)
    shared = created

    // `authorName` belongs to whoever subscribed first. Nothing downstream
    // reads it — the counts come from the working tree, not from an identity.
    void syncApi
      .subscribeGitDirtyState({ workspaceId, authorName })
      .then(broadcast)
      .catch(() => broadcast(null))
  }

  const entry = shared
  entry.listeners.add(listener)
  if (entry.latest) listener(entry.latest)

  return () => {
    entry.listeners.delete(listener)
    if (entry.listeners.size > 0) return
    if (sharedSubscriptions.get(workspaceId) === entry) {
      sharedSubscriptions.delete(workspaceId)
    }
    entry.detachChannel()
    void window.electronAPI?.workspaceSync?.unsubscribeGitDirtyState?.({ workspaceId }).catch(() => {})
  }
}

export function useGitDirtySnapshot(
  workspaceId: string | null,
  authorName?: string | null,
): GitDirtyStateSnapshot | null {
  const [snapshot, setSnapshot] = useState<GitDirtyStateSnapshot | null>(null)

  useEffect(() => {
    if (!workspaceId) {
      setSnapshot(null)
      return
    }

    let cancelled = false
    const unsubscribe = subscribeToDirtyState(workspaceId, authorName ?? undefined, (next) => {
      if (cancelled) return
      setSnapshot(next)
    })

    return () => {
      cancelled = true
      unsubscribe()
    }
  }, [authorName, workspaceId])

  return snapshot
}
