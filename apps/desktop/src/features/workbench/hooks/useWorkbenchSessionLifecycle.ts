import { useEffect, useRef, useState } from "react"

import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"
import type { ResolvedWorkbenchIdentity } from "@shared/navigationRuntimeTypes"
import { navigationController } from "@/app/navigation/navigationController"

interface UseWorkbenchSessionLifecycleArgs {
  projectId: string | null
  laneId: string | null
  workspaceId: string | null
  workspaceRevision: number | null
  retained?: readonly ResolvedWorkbenchIdentity[]
  backgroundMode?: "backgroundWarm" | "backgroundFrozen"
  enabled?: boolean
}

const EMPTY_RETAINED_IDENTITIES: readonly ResolvedWorkbenchIdentity[] = []

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
  workspaceRevision,
  retained = EMPTY_RETAINED_IDENTITIES,
  backgroundMode = "backgroundWarm",
  enabled = true,
}: UseWorkbenchSessionLifecycleArgs): WorkbenchSessionSnapshot | null {
  const [snapshot, setSnapshot] = useState<WorkbenchSessionSnapshot | null>(null)
  const activeSessionKeyRef = useRef<string | null>(null)
  const retainedRef = useRef(retained)
  retainedRef.current = retained

  useEffect(() => {
    if (!enabled || !projectId || !laneId || !workspaceId || !workspaceRevision) {
      activeSessionKeyRef.current = null
      setSnapshot(null)
      void navigationController.setPresentation(null, retainedRef.current)
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

    const identity: ResolvedWorkbenchIdentity = {
      projectId,
      laneId,
      workspaceId,
      workspaceRevision,
    }

    void navigationController
      .setPresentation(identity, retainedRef.current)
      .then((result) => {
        if (cancelled || result?.status !== "applied" || !result.sessionKey) return null
        activeSessionKeyRef.current = result.sessionKey
        return window.electronAPI.workbenchSession.getSession({
          sessionKey: result.sessionKey,
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
      void sessionKey
      void backgroundMode
      void navigationController.setPresentation(null, retainedRef.current)
    }
  }, [backgroundMode, enabled, laneId, projectId, workspaceId, workspaceRevision])

  return snapshot
}
