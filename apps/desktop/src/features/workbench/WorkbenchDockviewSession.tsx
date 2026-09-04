import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react"

import { WorkbenchDockRuntimeProvider } from "@/features/workbench/WorkbenchDockRuntimeContext"
import { useWorkbenchDockviewRuntime } from "@/features/workbench/hooks/useWorkbenchDockviewRuntime"
import {
  ensureWorkbenchLayoutPersistenceReady,
  peekPersistedWorkbenchLayout,
} from "@/features/workbench/model/workbenchLayoutPersistence"
import { buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"
import {
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/features/workbench/model/workbenchStore"
import {
  endProjectSwitch,
  markProjectSwitchPhase,
} from "@/lib/performance/projectSwitchMarks"
import type { WorkbenchSessionSnapshot } from "@shared/electronApiTypes"
import type { WorkbenchKeepAliveSession } from "@/features/workbench/workbenchKeepAlive"

const LazyWorkbenchDockviewCanvas = lazy(() =>
  import("@/features/workbench/WorkbenchDockviewCanvas").then((module) => ({
    default: module.WorkbenchDockviewCanvas,
  })),
)

interface WorkbenchDockviewSessionProps {
  session: WorkbenchKeepAliveSession
  isActive: boolean
  getWorkbenchSession: () => WorkbenchSessionSnapshot | null
}

export function WorkbenchDockviewSession({
  session,
  isActive,
  getWorkbenchSession,
}: WorkbenchDockviewSessionProps) {
  const [isLayoutPersistenceReady, setIsLayoutPersistenceReady] = useState(false)
  const workbenchScopeKey = session.scopeKey
  const legacyWorkbenchScopeKey = buildWorkbenchScopeKey(
    session.projectId,
    session.activeLaneId,
    null,
  )
  const projectWorkbench = useProjectWorkbenchStore(
    useMemo(
      () => selectProjectWorkbench(session.projectId, session.activeLaneId, session.workspaceId),
      [session.activeLaneId, session.projectId, session.workspaceId],
    ),
  )
  const persistedLayout = useMemo(() => {
    if (!workbenchScopeKey || !projectWorkbench) {
      return null
    }

    const pathAwareLayout = peekPersistedWorkbenchLayout(
      workbenchScopeKey,
      projectWorkbench.layoutResetKey,
    )
    if (
      pathAwareLayout ||
      !legacyWorkbenchScopeKey ||
      legacyWorkbenchScopeKey === workbenchScopeKey
    ) {
      return pathAwareLayout
    }

    return peekPersistedWorkbenchLayout(
      legacyWorkbenchScopeKey,
      projectWorkbench.layoutResetKey,
    )
  }, [legacyWorkbenchScopeKey, projectWorkbench, workbenchScopeKey])

  const {
    dockviewHostRef,
    getSelectionPreviewTile,
    handleResolveSelectionTile,
    handleDuplicateAssistantTile,
    handleSplitTile,
    handleDockviewReady,
  } = useWorkbenchDockviewRuntime({
    projectId: session.projectId,
    activeLaneId: session.activeLaneId,
    workspaceId: session.workspaceId,
    workbenchSessionKey: session.workbenchSessionKey,
    projectWorkbench,
    workbenchScopeKey,
    isLayoutPersistenceReady,
    persistedLayout,
    isActive,
  })

  const canvasReadyRef = useRef(false)

  useEffect(() => {
    ensureWorkbenchLayoutPersistenceReady()
    setIsLayoutPersistenceReady(true)
  }, [])

  const finishSwitchPaint = useCallback((keepAliveHit: boolean) => {
    markProjectSwitchPhase("dockview-ready", {
      scopeKey: workbenchScopeKey,
      keepAliveHit,
    })
    const frameId = window.requestAnimationFrame(() => {
      markProjectSwitchPhase("first-tile-paint", {
        scopeKey: workbenchScopeKey,
        keepAliveHit,
      })
      endProjectSwitch({
        scopeKey: workbenchScopeKey,
        keepAliveHit,
      })
    })
    return () => window.cancelAnimationFrame(frameId)
  }, [workbenchScopeKey])

  const onReady = useCallback(
    (event: Parameters<typeof handleDockviewReady>[0]) => {
      canvasReadyRef.current = true
      handleDockviewReady(event)
      if (isActive) {
        finishSwitchPaint(false)
      }
    },
    [finishSwitchPaint, handleDockviewReady, isActive],
  )

  useEffect(() => {
    if (!isActive || !canvasReadyRef.current) {
      return
    }
    return finishSwitchPaint(true)
  }, [finishSwitchPaint, isActive, workbenchScopeKey])

  return (
    <WorkbenchDockRuntimeProvider
      projectId={session.projectId}
      laneId={session.activeLaneId}
      projectRootPath={session.projectRootPath}
      gitRootPath={session.gitRootPath}
      projectName={session.projectName}
      workspaceId={session.workspaceId}
      framework={session.framework}
      storedDevCommand={session.storedDevCommand}
      storedDevPort={session.storedDevPort}
      workbenchSessionKey={session.workbenchSessionKey}
      surfaceVisible={isActive}
      getWorkbenchSession={getWorkbenchSession}
      getSelectionPreviewTile={getSelectionPreviewTile}
      onDuplicateAssistantTile={handleDuplicateAssistantTile}
      onResolveSelectionTile={handleResolveSelectionTile}
      onSplitTile={handleSplitTile}
    >
      <div ref={dockviewHostRef} className="h-full min-h-0 w-full min-w-0">
        <Suspense fallback={null}>
          <LazyWorkbenchDockviewCanvas
            dockviewKey={workbenchScopeKey}
            themeScheme={session.themeScheme}
            onReady={onReady}
          />
        </Suspense>
      </div>
    </WorkbenchDockRuntimeProvider>
  )
}
