import { Suspense, lazy, useCallback, useEffect, useMemo, useState } from "react"

import { WorkbenchDockRuntimeProvider } from "@/features/workbench/WorkbenchDockRuntimeContext"
import { useWorkbenchDockviewRuntime } from "@/features/workbench/hooks/useWorkbenchDockviewRuntime"
import {
  ensureWorkbenchLayoutPersistenceReady,
  peekLayoutDiag,
  peekPersistedWorkbenchLayout,
} from "@/features/workbench/model/workbenchLayoutPersistence"
import { buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"
import {
  selectProjectWorkbench,
  useProjectWorkbenchStore,
} from "@/lib/workbenchStore"
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
      session.workspaceRevision,
    )
    // TEMP DIAGNOSTIC
    console.warn("[LayoutPeekDiag]", JSON.stringify({
      scopeKey: workbenchScopeKey,
      layoutResetKey: projectWorkbench.layoutResetKey,
      workspaceRevision: session.workspaceRevision,
      ready: isLayoutPersistenceReady,
      gotLayout: Boolean(pathAwareLayout),
      raw: peekLayoutDiag(workbenchScopeKey),
    }))
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
      session.workspaceRevision,
    )
  }, [isLayoutPersistenceReady, legacyWorkbenchScopeKey, projectWorkbench, session.workspaceRevision, workbenchScopeKey])

  const {
    dockviewHostRef,
    getSelectionPreviewTile,
    handleResolveSelectionTile,
    handleDuplicateAssistantTile,
    handleOpenAssistantConversation,
    handleSplitTile,
    handleDockviewReady,
  } = useWorkbenchDockviewRuntime({
    projectId: session.projectId,
    activeLaneId: session.activeLaneId,
    workspaceId: session.workspaceId,
    workspaceRevision: session.workspaceRevision,
    workbenchSessionKey: session.workbenchSessionKey,
    projectWorkbench,
    workbenchScopeKey,
    isLayoutPersistenceReady,
    persistedLayout,
    isActive,
  })

  useEffect(() => {
    let cancelled = false
    void ensureWorkbenchLayoutPersistenceReady(workbenchScopeKey).then(() => {
      if (!cancelled) setIsLayoutPersistenceReady(true)
    }).catch((error) => {
      console.error('[Workbench] Layout restoration failed; refusing empty initialization', error)
    })
    return () => { cancelled = true }
  }, [])

  const onReady = useCallback(
    (event: Parameters<typeof handleDockviewReady>[0]) => {
      handleDockviewReady(event)
    },
    [handleDockviewReady],
  )

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
      onOpenAssistantConversation={handleOpenAssistantConversation}
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
