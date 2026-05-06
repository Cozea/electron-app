import { lazy, Suspense, useEffect, useMemo } from "react"

export {
  IDLE_SYNC_PROGRESS,
  ProjectSyncContext,
  useOptionalProjectSyncContext,
  useProjectSyncContext,
  type ProjectSyncContextValue,
  type ProjectSyncProviderProps,
} from "@/features/projects/contexts/projectSyncShared"

import {
  EMPTY_YJS_PROJECT_CONTEXT_VALUE,
  YjsProjectContextBridgeProvider,
} from "@/contexts/YjsProjectContextValue"
import {
  ProjectSyncContext,
  type ProjectSyncProviderProps,
} from "@/features/projects/contexts/projectSyncShared"
import {
  resolveWorkspaceRuntimeId,
  useWorkspaceRuntimeStore,
} from "@/features/projects/workspaces/useWorkspaceRuntimeStore"
import { normalizeWorkspaceLaneId } from "@/features/projects/workspaces/workspaceIdentity"

const LazyDeleteConflictDialog = lazy(() =>
  import("@/components/editor/DeleteConflictDialog").then((module) => ({
    default: module.DeleteConflictDialog,
  })),
)

export function ProjectSyncProvider({
  children,
  projectId,
  userId,
  userName,
  laneId = null,
  projectSlug,
  gitCwd = null,
  lastSyncAt,
  skipInitialSyncCheck: _skipInitialSyncCheck = false,
  onFilesChanged: _onFilesChanged,
  collaborationEnabled = true,
  activeBranch = null,
  sharedBranch = null,
  documentScopeId = null,
  workspaceId: fallbackWorkspaceId,
  workspaceRevision = 1,
}: ProjectSyncProviderProps) {
  const ensureRuntime = useWorkspaceRuntimeStore((state) => state.actions.ensureRuntime)
  const attachRuntime = useWorkspaceRuntimeStore((state) => state.actions.attachRuntime)
  const detachRuntime = useWorkspaceRuntimeStore((state) => state.actions.detachRuntime)

  const runtimeId = useMemo(
    () =>
      resolveWorkspaceRuntimeId({
        projectId,
        workspaceId: fallbackWorkspaceId,
        laneId,
        workspaceRevision,
      }),
    [fallbackWorkspaceId, laneId, projectId, workspaceRevision],
  )

  const canHostRuntime = Boolean(projectId && userId && fallbackWorkspaceId && runtimeId)

  useEffect(() => {
    if (!canHostRuntime || !runtimeId || !fallbackWorkspaceId) {
      return
    }

    ensureRuntime({
      projectId,
      userId,
      userName,
      workspaceId: fallbackWorkspaceId,
      laneId: normalizeWorkspaceLaneId(laneId),
      workspaceRevision,
      projectSlug,
      gitCwd,
      lastSyncAt: lastSyncAt ?? null,
      collaborationEnabled,
      activeBranch,
      sharedBranch,
      documentScopeId,
    })
  }, [
    activeBranch,
    canHostRuntime,
    collaborationEnabled,
    documentScopeId,
    ensureRuntime,
    gitCwd,
    laneId,
    lastSyncAt,
    projectId,
    projectSlug,
    sharedBranch,
    userId,
    userName,
    fallbackWorkspaceId,
    workspaceRevision,
    runtimeId,
  ])

  useEffect(() => {
    if (!canHostRuntime || !runtimeId) {
      return
    }

    attachRuntime(runtimeId)
    return () => {
      detachRuntime(runtimeId)
    }
  }, [attachRuntime, canHostRuntime, detachRuntime, runtimeId])

  const runtimeRecord = useWorkspaceRuntimeStore(
    useMemo(
      () => (state) => (runtimeId ? state.runtimes[runtimeId] ?? null : null),
      [runtimeId],
    ),
  )

  const syncContextValue = runtimeRecord?.syncContext ?? null
  const yjsContextValue = runtimeRecord?.yjsContext ?? EMPTY_YJS_PROJECT_CONTEXT_VALUE

  return (
    <ProjectSyncContext.Provider value={syncContextValue}>
      <YjsProjectContextBridgeProvider value={yjsContextValue}>
        {syncContextValue ? (
          <Suspense fallback={null}>
            <LazyDeleteConflictDialog />
          </Suspense>
        ) : null}
        {children}
      </YjsProjectContextBridgeProvider>
    </ProjectSyncContext.Provider>
  )
}
