import {
  useMemo,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from "react"

import type { Id } from "../../../../../convex/_generated/dataModel"
import { YjsProjectProvider } from "@/contexts/YjsProjectContext"
import { useYjsProject } from "@/contexts/YjsProjectContextValue"
import { useAgentFileSync } from "@/hooks/useAgentFileSync"
import { useBinaryFileSync } from "@/hooks/useBinaryFileSync"
import { useYjsFileWriteback } from "@/hooks/useYjsFileWriteback"
import { DeleteConflictDialog } from "@/components/editor/DeleteConflictDialog"
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

function AgentFileSyncBridge({
  projectId,
  principalId,
  workspaceId,
  gitCwd,
  children,
}: {
  projectId: Id<"projects"> | null
  principalId: Id<"devicePrincipals"> | null
  workspaceId: string | null
  gitCwd: string | null
  children: ReactNode
}) {
  const { yjsDoc } = useYjsProject()

  useEffect(() => {
    if (!workspaceId || !yjsDoc) return

    let cancelled = false
    void window.electronAPI.project.watchStart({ workspaceId }).then((result) => {
      if (!result?.success && !cancelled) {
        console.warn("[ProjectWatcher] Failed to start watcher:", result?.error)
      }
    })

    return () => {
      cancelled = true
      void window.electronAPI.project.watchStop({ workspaceId })
    }
  }, [workspaceId, yjsDoc])

  useAgentFileSync(yjsDoc, workspaceId, projectId, principalId)
  useBinaryFileSync(projectId, workspaceId, principalId)
  useYjsFileWriteback(yjsDoc, workspaceId, gitCwd, projectId, principalId)

  return <>{children}</>
}

/**
 * Local-workspace Yjs host only.
 *
 * Live collaboration is owned exclusively by the Electron generation-3 runtime
 * and is selected through a `session:<id>` workspace lane. This compatibility
 * host deliberately has no collaboration-session acquisition or websocket path.
 */
export function ProjectSyncProviderRuntime({
  children,
  projectId,
  principalId,
  displayName,
  laneId: _laneId = null,
  projectSlug: _projectSlug,
  workspaceId,
  gitCwd = null,
  lastSyncAt: initialLastSyncAt,
  skipInitialSyncCheck: _skipInitialSyncCheck = false,
  onFilesChanged,
  collaborationEnabled: _collaborationEnabled = false,
  activeBranch = null,
  sharedBranch = null,
  documentScopeId = null,
  renderDeleteConflictDialog = true,
}: ProjectSyncProviderRuntimeProps) {
  const resolvedProjectId = (projectId ?? "__inactive_project__") as Id<"projects">
  const resolvedPrincipalId = (principalId ?? "__inactive_principal__") as Id<"devicePrincipals">
  const resolvedDisplayName = displayName ?? "This device"
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(initialLastSyncAt ?? null)
  const [progress, setProgress] = useState<SyncProgress>(IDLE_SYNC_PROGRESS)

  useProjectCheckpointCleanup(projectId, workspaceId)

  useEffect(() => {
    setLastSyncAt(initialLastSyncAt ?? null)
  }, [initialLastSyncAt])

  const canSync = Boolean(projectId && principalId && workspaceId)

  const triggerSync = useCallback(async () => {
    if (!projectId || !workspaceId) return

    const now = Date.now()
    setLastSyncAt(now)
    onFilesChanged?.()
    setProgress({
      status: "complete",
      message: "Local workspace ready",
      current: 0,
      total: 0,
      logs: ["Live collaboration starts only from an explicit Live session lane."],
    })
    window.setTimeout(() => setProgress(IDLE_SYNC_PROGRESS), 1200)
  }, [onFilesChanged, projectId, workspaceId])

  const syncContextValue = useMemo(
    () =>
      canSync
        ? {
            isSynced: true,
            cloudSyncBlocked: false,
            lastSyncAt,
            workspaceId,
            gitCwd,
            collaborationEnabled: false,
            collaborationMode: "local" as const,
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
      activeBranch,
      canSync,
      gitCwd,
      lastSyncAt,
      progress,
      sharedBranch,
      triggerSync,
      workspaceId,
    ],
  )

  return (
    <ProjectSyncContext.Provider value={syncContextValue}>
      <YjsProjectProvider
        projectId={resolvedProjectId}
        principalId={resolvedPrincipalId}
        displayName={resolvedDisplayName}
        workspaceId={workspaceId}
        enabled={canSync}
        documentScopeId={documentScopeId}
        collaborationEnabled={false}
        collabSession={null}
      >
        {renderDeleteConflictDialog ? <DeleteConflictDialog /> : null}
        <AgentFileSyncBridge
          projectId={projectId}
          principalId={principalId}
          workspaceId={workspaceId}
          gitCwd={gitCwd}
        >
          {children}
        </AgentFileSyncBridge>
      </YjsProjectProvider>
    </ProjectSyncContext.Provider>
  )
}
