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
  localPath,
  gitCwd = null,
  lastSyncAt,
  skipInitialSyncCheck: _skipInitialSyncCheck = false,
  onFilesChanged: _onFilesChanged,
  collaborationEnabled = true,
  activeBranch = null,
  sharedBranch = null,
  documentScopeId = null,
}: ProjectSyncProviderProps) {
  const ensureRuntime = useWorkspaceRuntimeStore((state) => state.actions.ensureRuntime)
  const attachRuntime = useWorkspaceRuntimeStore((state) => state.actions.attachRuntime)
  const detachRuntime = useWorkspaceRuntimeStore((state) => state.actions.detachRuntime)

  const workspaceId = useMemo(
    () =>
      resolveWorkspaceRuntimeId({
        projectId,
        laneId,
        localPath,
      }),
    [laneId, localPath, projectId],
  )

  const canHostRuntime = Boolean(projectId && userId && localPath && workspaceId)

  useEffect(() => {
    if (!canHostRuntime || !workspaceId) {
      return
    }

    ensureRuntime({
      projectId,
      userId,
      userName,
      laneId: normalizeWorkspaceLaneId(laneId),
      projectSlug,
      localPath,
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
    localPath,
    projectId,
    projectSlug,
    sharedBranch,
    userId,
    userName,
    workspaceId,
  ])

  useEffect(() => {
    if (!canHostRuntime || !workspaceId) {
      return
    }

    attachRuntime(workspaceId)
    return () => {
      detachRuntime(workspaceId)
    }
  }, [attachRuntime, canHostRuntime, detachRuntime, workspaceId])

  const runtimeRecord = useWorkspaceRuntimeStore(
    useMemo(
      () => (state) => (workspaceId ? state.runtimes[workspaceId] ?? null : null),
      [workspaceId],
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
