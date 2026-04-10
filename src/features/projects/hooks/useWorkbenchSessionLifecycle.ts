import { useEffect, useState } from "react"

import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

interface UseWorkbenchSessionLifecycleArgs {
  projectId: string | null
  laneId: string | null
  projectPath: string | null
  enabled?: boolean
}

function matchesSession(
  snapshot: WorkbenchSessionSnapshot,
  projectId: string | null,
  laneId: string | null,
): boolean {
  if (!projectId || !laneId) return false
  return snapshot.projectId === projectId && snapshot.laneId === laneId
}

export function useWorkbenchSessionLifecycle({
  projectId,
  laneId,
  projectPath,
  enabled = true,
}: UseWorkbenchSessionLifecycleArgs): WorkbenchSessionSnapshot | null {
  const [snapshot, setSnapshot] = useState<WorkbenchSessionSnapshot | null>(null)

  useEffect(() => {
    if (!enabled || !projectId || !laneId) {
      setSnapshot(null)
      return
    }

    let cancelled = false

    const applySnapshot = (nextSnapshot: WorkbenchSessionSnapshot | null) => {
      if (cancelled || !nextSnapshot) return
      if (!matchesSession(nextSnapshot, projectId, laneId)) return
      setSnapshot(nextSnapshot)
    }

    void window.electronAPI.workbenchSession
      .ensureSession({
        projectId,
        laneId,
        projectPath,
      })
      .then((nextSnapshot) => {
        applySnapshot(nextSnapshot)
        return window.electronAPI.workbenchSession.activateSession({
          projectId,
          laneId,
          projectPath,
        })
      })
      .then((nextSnapshot) => {
        applySnapshot(nextSnapshot)
      })
      .catch((error) => {
        console.warn("[WorkbenchSession] Failed to activate session", error)
      })

    const unsubscribe = window.electronAPI.workbenchSession.onStateChanged((nextSnapshot) => {
      applySnapshot(nextSnapshot)
    })

    return () => {
      cancelled = true
      unsubscribe()
      void window.electronAPI.workbenchSession
        .backgroundSession({
          projectId,
          laneId,
          mode: "backgroundWarm",
        })
        .catch((error) => {
          console.warn("[WorkbenchSession] Failed to background session", error)
        })
    }
  }, [enabled, laneId, projectId, projectPath])

  return snapshot
}
