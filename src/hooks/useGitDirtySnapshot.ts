import { useEffect, useState } from 'react'

import type { GitDirtyStateSnapshot } from '../../shared/electronApiTypes'

export function useGitDirtySnapshot(
  projectPath: string | null,
  authorName?: string | null,
): GitDirtyStateSnapshot | null {
  const [snapshot, setSnapshot] = useState<GitDirtyStateSnapshot | null>(null)

  useEffect(() => {
    if (!projectPath) {
      setSnapshot(null)
      return
    }

    let cancelled = false
    const syncApi = window.electronAPI?.sync
    if (!syncApi?.subscribeGitDirtyState || !syncApi?.unsubscribeGitDirtyState || !syncApi?.onGitDirtyStateChange) {
      setSnapshot(null)
      return
    }

    const subscribedProjectPath = projectPath
    const unsubscribeChannel = syncApi.onGitDirtyStateChange((nextSnapshot) => {
      if (cancelled) return
      if (nextSnapshot.projectPath !== subscribedProjectPath) {
        return
      }
      setSnapshot(nextSnapshot)
    })

    void syncApi
      .subscribeGitDirtyState({
        projectPath,
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
      void syncApi.unsubscribeGitDirtyState({ projectPath }).catch(() => {})
    }
  }, [authorName, projectPath])

  return snapshot
}
