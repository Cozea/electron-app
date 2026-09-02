import { useEffect, useState } from 'react'

import type { GitDirtyStateSnapshot } from '../../../../shared/electronApiTypes'

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
    const syncApi = window.electronAPI?.workspaceSync
    if (!syncApi?.subscribeGitDirtyState || !syncApi?.unsubscribeGitDirtyState || !syncApi?.onGitDirtyStateChange) {
      setSnapshot(null)
      return
    }

    const subscribedProjectPath = workspaceId
    const unsubscribeChannel = syncApi.onGitDirtyStateChange((nextSnapshot) => {
      if (cancelled) return
      if (nextSnapshot.workspaceId !== subscribedProjectPath) {
        return
      }
      setSnapshot(nextSnapshot)
    })

    void syncApi
      .subscribeGitDirtyState({
        workspaceId,
        authorName: authorName ?? undefined,
      })
      .then((initialSnapshot) => {
        if (cancelled) return
        setSnapshot(initialSnapshot)
      })
      .catch(() => {
        if (cancelled) return
        setSnapshot(null)
      })

    return () => {
      cancelled = true
      unsubscribeChannel()
      void syncApi.unsubscribeGitDirtyState({ workspaceId }).catch(() => {})
    }
  }, [authorName, workspaceId])

  return snapshot
}
