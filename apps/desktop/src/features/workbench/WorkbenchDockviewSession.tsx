import { Suspense, lazy, useCallback, useEffect, useMemo, useState, useSyncExternalStore } from "react"

import { WorkbenchDockRuntimeProvider } from "@/features/workbench/WorkbenchDockRuntimeContext"
import { useWorkbenchDockviewRuntime } from "@/features/workbench/hooks/useWorkbenchDockviewRuntime"
import {
  ensureWorkbenchLayoutPersistenceReady,
  peekPersistedWorkbenchLayout,
  isWorkbenchLayoutPersistenceReady,
  subscribeWorkbenchLayouts,
  getWorkbenchLayoutsRevision,
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
  const workbenchScopeKey = session.scopeKey
  const [isLayoutPersistenceReady, setIsLayoutPersistenceReady] = useState(() => isWorkbenchLayoutPersistenceReady(workbenchScopeKey))
  const [layoutHydrationError, setLayoutHydrationError] = useState<string | null>(null)
  const [hydrationAttempt, setHydrationAttempt] = useState(0)
  const layoutsRevision = useSyncExternalStore(subscribeWorkbenchLayouts, getWorkbenchLayoutsRevision, getWorkbenchLayoutsRevision)
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
  }, [legacyWorkbenchScopeKey, projectWorkbench, workbenchScopeKey, layoutsRevision])

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
    workbenchSessionKey: session.workbenchSessionKey,
    projectWorkbench,
    workbenchScopeKey,
    isLayoutPersistenceReady,
    persistedLayout,
    isActive,
  })

  useEffect(() => {
    let cancelled = false
    setLayoutHydrationError(null)
    setIsLayoutPersistenceReady(isWorkbenchLayoutPersistenceReady(workbenchScopeKey))
    void ensureWorkbenchLayoutPersistenceReady(workbenchScopeKey).then(() => {
      if (!cancelled) setIsLayoutPersistenceReady(true)
    }, (error: unknown) => {
      if (!cancelled) setLayoutHydrationError(error instanceof Error ? error.message : String(error))
    })
    return () => { cancelled = true }
  }, [workbenchScopeKey, hydrationAttempt])

  const onReady = useCallback(
    (event: Parameters<typeof handleDockviewReady>[0]) => {
      handleDockviewReady(event)
    },
    [handleDockviewReady],
  )

  if (layoutHydrationError) {
    return <div role="alert" className="flex h-full flex-col items-center justify-center gap-3 p-6">
      <p>Saved workbench state could not be loaded. No replacement layout was written.</p>
      <p className="text-xs text-muted-foreground">{layoutHydrationError}</p>
      <button type="button" onClick={() => setHydrationAttempt((attempt) => attempt + 1)}>Retry loading saved state</button>
    </div>
  }
  if (!isLayoutPersistenceReady) {
    return <div role="status" className="flex h-full items-center justify-center text-sm text-muted-foreground">Restoring saved workbench…</div>
  }

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
