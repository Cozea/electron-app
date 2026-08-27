import {
  useMemo,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from "react"

import type { Id } from "../../../../../../convex/_generated/dataModel"
import { YjsProjectProvider } from "@/contexts/YjsProjectContext"
import { useYjsProject } from "@/contexts/YjsProjectContextValue"
import { useAgentFileSync } from "@/hooks/useAgentFileSync"
import { useBinaryFileSync } from "@/hooks/useBinaryFileSync"
import { useCollabSession } from "@/hooks/useCollabSession"
import { useYjsFileWriteback } from "@/hooks/useYjsFileWriteback"
import { DeleteConflictDialog } from "@/components/editor/DeleteConflictDialog"
import type { CollabSessionDescriptor } from "@/lib/yjs/CollabWsProvider"
import {
  IDLE_SYNC_PROGRESS,
  ProjectSyncContext,
  type ProjectSyncProviderProps,
} from "@/features/projects/contexts/projectSyncShared"
import { useProjectCheckpointCleanup } from "@/features/projects/hooks/useProjectCheckpointCleanup"
import type { SyncProgress } from "@/lib/sync/types"

interface ProjectSyncProviderRuntimeProps extends ProjectSyncProviderProps {
  renderDeleteConflictDialog?: boolean
}

function AgentFileSyncBridge({
  projectId,
  userId,
  workspaceId,
  gitCwd,
  children,
}: {
  projectId: Id<"projects"> | null
  userId: Id<"users"> | null
  workspaceId: string | null
  gitCwd: string | null
  children: ReactNode
}) {
  const { yjsDoc } = useYjsProject()

  useEffect(() => {
    if (!workspaceId || !yjsDoc) return

    let cancelled = false

    void window.electronAPI.project.watchStart({ workspaceId }).then((res) => {
      if (!res?.success && !cancelled) {
        console.warn("[ProjectWatcher] Failed to start watcher:", res?.error)
      }
    })

    return () => {
      cancelled = true
      void window.electronAPI.project.watchStop({ workspaceId })
    }
  }, [workspaceId, yjsDoc])

  useAgentFileSync(yjsDoc, workspaceId, projectId, userId)
  useBinaryFileSync(projectId, workspaceId, userId)
  useYjsFileWriteback(yjsDoc, workspaceId, gitCwd, projectId, userId)

  return <>{children}</>
}

export function ProjectSyncProviderRuntime({
  children,
  projectId,
  userId,
  userName,
  laneId: _laneId = null,
  projectSlug: _projectSlug,
  workspaceId,
  gitCwd = null,
  lastSyncAt: initialLastSyncAt,
  skipInitialSyncCheck: _skipInitialSyncCheck = false,
  onFilesChanged,
  collaborationEnabled = true,
  activeBranch = null,
  sharedBranch = null,
  documentScopeId = null,
  renderDeleteConflictDialog = true,
}: ProjectSyncProviderRuntimeProps) {
  const resolvedProjectId = (projectId ?? "__inactive_project__") as Id<"projects">
  const resolvedUserId = (userId ?? "__inactive_user__") as Id<"users">
  const resolvedUserName = userName ?? "User"
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(initialLastSyncAt ?? null)
  const [progress, setProgress] = useState<SyncProgress>(IDLE_SYNC_PROGRESS)

  useProjectCheckpointCleanup(projectId, workspaceId)

  useEffect(() => {
    setLastSyncAt(initialLastSyncAt ?? null)
  }, [initialLastSyncAt])

  const canSync = Boolean(projectId && userId && workspaceId)
  const sharedCollaborationEnabled = canSync && collaborationEnabled
  const collaborationMode: "shared" | "local" = sharedCollaborationEnabled ? "shared" : "local"

  const {
    status: collabSessionStatus,
    session: collabSession,
    error: collabSessionError,
    refresh: refreshCollabSession,
  } = useCollabSession({
    projectId: String(resolvedProjectId),
    enabled: sharedCollaborationEnabled,
  })

  const activeCollabSession: CollabSessionDescriptor | null =
    sharedCollaborationEnabled && collabSessionStatus === "ready" && collabSession
      ? {
          projectId: String(resolvedProjectId),
          roomId: collabSession.roomId,
          collabWsUrl: collabSession.collabWsUrl,
          token: collabSession.token,
          protocolVersion: collabSession.protocolVersion,
          deviceId: collabSession.deviceId,
          devicePublicKeyJwk: collabSession.devicePublicKeyJwk,
          encryption: collabSession.encryption,
        }
      : null

  const refreshActiveCollabSession = useMemo(
    () => async (): Promise<CollabSessionDescriptor | null> => {
      if (!sharedCollaborationEnabled) {
        return null
      }

      const nextSession = await refreshCollabSession()
      if (!nextSession?.token || !nextSession?.roomId) {
        return null
      }

      return {
        projectId: String(resolvedProjectId),
        roomId: nextSession.roomId,
        collabWsUrl: nextSession.collabWsUrl,
        token: nextSession.token,
        protocolVersion: nextSession.protocolVersion,
        deviceId: nextSession.deviceId,
        devicePublicKeyJwk: nextSession.devicePublicKeyJwk,
        encryption: nextSession.encryption,
      }
    },
    [refreshCollabSession, resolvedProjectId, sharedCollaborationEnabled],
  )

  const triggerSync = useCallback(async () => {
    if (!projectId || !workspaceId) {
      return
    }

    try {
      if (!sharedCollaborationEnabled) {
        setProgress({
          status: "complete",
          message: "Local branch mode",
          current: 0,
          total: 0,
          logs: ["Live collaboration is paused on this branch."],
        })
        window.setTimeout(() => {
          setProgress(IDLE_SYNC_PROGRESS)
        }, 1200)
        return
      }

      setProgress({
        status: "syncing",
        message: "Refreshing collaboration session...",
        current: 0,
        total: 0,
        logs: [],
      })

      await refreshActiveCollabSession()
      const now = Date.now()
      setLastSyncAt(now)
      onFilesChanged?.()
      setProgress({
        status: "complete",
        message: "Live collaboration active",
        current: 0,
        total: 0,
        logs: [],
      })
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
  }, [workspaceId, onFilesChanged, projectId, refreshActiveCollabSession, sharedCollaborationEnabled])

  // Identity-stable context value: this object is republished into the
  // workspace runtime store and fans out to ~100 consumers (sidebar, header,
  // sync chrome). As an inline literal it changed identity on every render
  // of this engine — each collab/yjs/progress flip re-rendered them all.
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
            collabSessionStatus,
            collabSessionError,
            collabEncryptionStatus: collabSession?.encryption?.status ?? null,
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
      collabSessionStatus,
      collabSessionError,
      collabSession?.encryption?.status,
      triggerSync,
      progress,
    ],
  )

  return (
    <ProjectSyncContext.Provider value={syncContextValue}>
      <YjsProjectProvider
        projectId={resolvedProjectId}
        userId={resolvedUserId}
        userName={resolvedUserName}
        workspaceId={workspaceId}
        enabled={canSync}
        documentScopeId={documentScopeId}
        collaborationEnabled={sharedCollaborationEnabled}
        collabSession={activeCollabSession}
        refreshCollabSession={refreshActiveCollabSession}
      >
        {renderDeleteConflictDialog ? <DeleteConflictDialog /> : null}
        <AgentFileSyncBridge
          projectId={projectId}
          userId={userId}
          workspaceId={workspaceId}
          gitCwd={gitCwd}
        >
          {children}
        </AgentFileSyncBridge>
      </YjsProjectProvider>
    </ProjectSyncContext.Provider>
  )
}
