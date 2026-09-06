import { lazy, Suspense, useEffect, useMemo } from "react"

export {
  IDLE_SYNC_PROGRESS,
  ProjectSyncContext,
  useOptionalProjectSyncContext,
  useProjectSyncContext,
  type CollabEncryptionStatus,
  type CollabSessionStatus,
  type ProjectSyncContextValue,
  type ProjectSyncProviderProps,
} from "@/contexts/project/projectSyncShared"

import {
  EMPTY_YJS_PROJECT_CONTEXT_VALUE,
  YjsProjectContextBridgeProvider,
} from "@/contexts/YjsProjectContextValue"
import {
  ProjectSyncContext,
  type ProjectSyncProviderProps,
} from "@/contexts/project/projectSyncShared"
import {
  resolveWorkspaceRuntimeId,
  useWorkspaceRuntimeStore,
} from "@/lib/workspaceRuntimeStore"
import { normalizeWorkspaceLaneId } from "@/lib/workspaceIdentity"

const LazyDeleteConflictDialog = lazy(() =>
  import("@/components/editor/DeleteConflictDialog").then((module) => ({
    default: module.DeleteConflictDialog,
  })),
)

export function ProjectSyncProvider({
  children,
  projectId,
  principalId,
  displayName,
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

  const canHostRuntime = Boolean(projectId && principalId && fallbackWorkspaceId && runtimeId)

  useEffect(() => {
    if (!canHostRuntime || !runtimeId || !fallbackWorkspaceId) {
      return
    }

    ensureRuntime({
      projectId,
      principalId,
      displayName,
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
    principalId,
    displayName,
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

  // Subscribe to exactly the two fields this provider renders. The full
  // runtime record changes on every attach/detach, session-snapshot bind and
  // lifecycle flip, and each of those re-rendered this provider plus its
  // entire context subtree (~100 components: sidebar, header, sync chrome).
  const syncContextValue = useWorkspaceRuntimeStore(
    useMemo(
      () => (state) => (runtimeId ? state.runtimes[runtimeId]?.syncContext ?? null : null),
      [runtimeId],
    ),
  )
  const yjsContextValue = useWorkspaceRuntimeStore(
    useMemo(
      () => (state) =>
        runtimeId
          ? state.runtimes[runtimeId]?.yjsContext ?? EMPTY_YJS_PROJECT_CONTEXT_VALUE
          : EMPTY_YJS_PROJECT_CONTEXT_VALUE,
      [runtimeId],
    ),
  )

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
