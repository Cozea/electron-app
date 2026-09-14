import {
  useMemo,
  useEffect,
  useCallback,
  useState,
} from "react"

import {
  IDLE_SYNC_PROGRESS,
  ProjectSyncContext,
  type ProjectSyncProviderProps,
} from "@/contexts/project/projectSyncShared"
import { useProjectCheckpointCleanup } from "@/features/source-control/hooks/useProjectCheckpointCleanup"
import type { SyncProgress } from "@/lib/sync/types"

interface ProjectSyncProviderRuntimeProps extends ProjectSyncProviderProps {
  renderDeleteConflictDialog?: boolean
}

export function ProjectSyncProviderRuntime({
  children,
  projectId,
  principalId: _principalId,
  displayName: _displayName,
  laneId: _laneId = null,
  projectSlug: _projectSlug,
  workspaceId,
  gitCwd = null,
  lastSyncAt: initialLastSyncAt,
  skipInitialSyncCheck: _skipInitialSyncCheck = false,
  onFilesChanged,
  collaborationEnabled = false,
  activeBranch = null,
  sharedBranch = null,
  documentScopeId: _documentScopeId = null,
  renderDeleteConflictDialog: _renderDeleteConflictDialog = false,
}: ProjectSyncProviderRuntimeProps) {
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(initialLastSyncAt ?? null)
  const [progress, setProgress] = useState<SyncProgress>(IDLE_SYNC_PROGRESS)

  useProjectCheckpointCleanup(projectId, workspaceId)

  useEffect(() => {
    setLastSyncAt(initialLastSyncAt ?? null)
  }, [initialLastSyncAt])

  const canSync = Boolean(projectId && workspaceId)
  const daemonWorkspace = /^ws_collab_czs_[a-f0-9]{16}$/.test(workspaceId ?? "")
  const sharedCollaborationEnabled = canSync && collaborationEnabled && !daemonWorkspace
  const collaborationMode: "shared" | "local" = sharedCollaborationEnabled ? "shared" : "local"

  const triggerSync = useCallback(async () => {
    if (!projectId || !workspaceId) {
      return
    }

    try {
      setProgress({
        status: "complete",
        message: "Local branch mode",
        current: 0,
        total: 0,
        logs: [],
      })
      const now = Date.now()
      setLastSyncAt(now)
      onFilesChanged?.()
      window.setTimeout(() => {
        setProgress(IDLE_SYNC_PROGRESS)
      }, 1200)
    } catch (error) {
      const message = error instanceof Error ? error.message : "Failed to sync project"
      setProgress({
        status: "error",
        message,
        current: 0,
        total: 0,
        logs: [`Error: ${message}`],
      })
    }
  }, [workspaceId, onFilesChanged, projectId])

  const syncContextValue = useMemo(
    () =>
      canSync
        ? {
            isSynced: true,
            cloudSyncBlocked: false,
            lastSyncAt,
            workspaceId,
            gitCwd,
            collaborationEnabled: sharedCollaborationEnabled,
            collaborationMode,
            activeBranch,
            sharedBranch,
            collabSessionStatus: "idle" as const,
            collabSessionError: null,
            collabEncryptionStatus: null,
            triggerSync,
            syncProgress: progress,
          }
        : null,
    [
      canSync,
      lastSyncAt,
      workspaceId,
      gitCwd,
      sharedCollaborationEnabled,
      collaborationMode,
      activeBranch,
      sharedBranch,
      triggerSync,
      progress,
    ],
  )

  return (
    <ProjectSyncContext.Provider value={syncContextValue}>
      {children}
    </ProjectSyncContext.Provider>
  )
}
