import { useEffect, useRef, useState } from "react"

import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

interface UseWorkbenchSessionLifecycleArgs {
  projectId: string | null
  laneId: string | null
  projectPath: string | null
  backgroundMode?: "backgroundWarm" | "backgroundFrozen"
  enabled?: boolean
}

function matchesSession(
  snapshot: WorkbenchSessionSnapshot,
  sessionKey: string | null,
  projectId: string | null,
  laneId: string | null,
  projectPath: string | null,
): boolean {
  if (sessionKey) {
    return snapshot.sessionKey === sessionKey
  }
  if (!projectId || !laneId) return false
  if (snapshot.projectId !== projectId || snapshot.laneId !== laneId) {
    return false
  }
  if (projectPath) {
    return snapshot.projectPath === projectPath
  }
  return true
}

export function useWorkbenchSessionLifecycle({
  projectId,
  laneId,
  projectPath,
  backgroundMode = "backgroundWarm",
  enabled = true,
}: UseWorkbenchSessionLifecycleArgs): WorkbenchSessionSnapshot | null {
  const [snapshot, setSnapshot] = useState<WorkbenchSessionSnapshot | null>(null)
  const activeSessionKeyRef = useRef<string | null>(null)

  useEffect(() => {
    if (!enabled || !projectId || !laneId) {
      activeSessionKeyRef.current = null
      setSnapshot(null)
      return
    }

    let cancelled = false

    const applySnapshot = (nextSnapshot: WorkbenchSessionSnapshot | null) => {
      if (cancelled || !nextSnapshot) return
      if (!matchesSession(nextSnapshot, activeSessionKeyRef.current, projectId, laneId, projectPath)) return
      setSnapshot(nextSnapshot)
    }

    void window.electronAPI.workbenchSession
      .ensureSession({
        projectId,
        laneId,
        projectPath,
      })
      .then((nextSnapshot) => {
        activeSessionKeyRef.current = nextSnapshot.sessionKey
        applySnapshot(nextSnapshot)
        return window.electronAPI.workbenchSession.activateSession({
          sessionKey: nextSnapshot.sessionKey,
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
      const sessionKey = activeSessionKeyRef.current
      activeSessionKeyRef.current = null
      cancelled = true
      unsubscribe()
      if (!sessionKey) {
        return
      }
      void window.electronAPI.workbenchSession
        .backgroundSession({
          sessionKey,
          projectId,
          laneId,
          mode: backgroundMode,
        })
        .catch((error) => {
          console.warn("[WorkbenchSession] Failed to background session", error)
        })
    }
  }, [backgroundMode, enabled, laneId, projectId, projectPath])

  return snapshot
}
