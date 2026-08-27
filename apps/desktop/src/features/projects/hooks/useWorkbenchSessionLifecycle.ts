import { useEffect, useRef, useState } from "react"

import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"

interface UseWorkbenchSessionLifecycleArgs {
  projectId: string | null
  laneId: string | null
  workspaceId: string | null
  backgroundMode?: "backgroundWarm" | "backgroundFrozen"
  enabled?: boolean
}

/**
 * Compares everything consumers actually render. The activity timestamps
 * (openedAt/lastFocusedAt/lastBackgroundedAt) are deliberately excluded: the
 * session manager bumps them on every ensure/activate/focus broadcast, and
 * propagating those would re-render the whole dock chrome on every click.
 */
function isMeaningfullyEqual(
  a: WorkbenchSessionSnapshot,
  b: WorkbenchSessionSnapshot,
): boolean {
  return (
    a.sessionKey === b.sessionKey &&
    a.projectId === b.projectId &&
    a.laneId === b.laneId &&
    a.workspaceId === b.workspaceId &&
    a.lifecycle === b.lifecycle &&
    a.pinned === b.pinned &&
    a.hasBrowserSurface === b.hasBrowserSurface &&
    a.hasNativePreviewSession === b.hasNativePreviewSession &&
    JSON.stringify(a.terminalBindings) === JSON.stringify(b.terminalBindings) &&
    JSON.stringify(a.devServer) === JSON.stringify(b.devServer)
  )
}

function matchesSession(
  snapshot: WorkbenchSessionSnapshot,
  sessionKey: string | null,
  projectId: string | null,
  laneId: string | null,
  workspaceId: string | null,
): boolean {
  if (sessionKey) {
    return snapshot.sessionKey === sessionKey
  }
  if (!projectId || !laneId) return false
  if (snapshot.projectId !== projectId || snapshot.laneId !== laneId) {
    return false
  }
  if (workspaceId) {
    return snapshot.workspaceId === workspaceId
  }
  return true
}

export function useWorkbenchSessionLifecycle({
  projectId,
  laneId,
  workspaceId,
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
      if (!matchesSession(nextSnapshot, activeSessionKeyRef.current, projectId, laneId, workspaceId)) return
      setSnapshot((current) =>
        current && isMeaningfullyEqual(current, nextSnapshot) ? current : nextSnapshot,
      )
    }

    void window.electronAPI.workbenchSession
      .ensureSession({
        projectId,
        laneId,
        workspaceId,
      })
      .then((nextSnapshot) => {
        activeSessionKeyRef.current = nextSnapshot.sessionKey
        applySnapshot(nextSnapshot)
        return window.electronAPI.workbenchSession.activateSession({
          sessionKey: nextSnapshot.sessionKey,
          projectId,
          laneId,
          workspaceId,
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
  }, [backgroundMode, enabled, laneId, projectId, workspaceId])

  return snapshot
}
