import {
  useMemo,
  useEffect,
  useCallback,
  useState,
  type ReactNode,
} from "react"

import type { Id } from "../../../../convex/_generated/dataModel"
import { YjsProjectProvider, useYjsProject } from "@/contexts/YjsProjectContext"
import { useAuth } from "@/contexts/AuthContext"
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
import type { SyncProgress } from "@/lib/sync/types"

function AgentFileSyncBridge({
  projectId,
  userId,
  projectPath,
  children,
}: {
  projectId: Id<"projects"> | null
  userId: Id<"users"> | null
  projectPath: string | null
  children: ReactNode
}) {
  const { yjsDoc } = useYjsProject()

  useEffect(() => {
    if (!projectPath) return
    const yjsApi = window.electronAPI?.yjs
    if (yjsApi?.setInterestRoots) {
      void yjsApi.setInterestRoots({ roots: [projectPath] })
    }
    return () => {
      if (yjsApi?.setInterestRoots) {
        void yjsApi.setInterestRoots({ roots: [] })
      }
    }
  }, [projectPath])

  useEffect(() => {
    if (!projectPath || !yjsDoc) return

    let cancelled = false

    void window.electronAPI.project.watchStart({ projectPath }).then((res) => {
      if (!res?.success && !cancelled) {
        console.warn("[ProjectWatcher] Failed to start watcher:", res?.error)
      }
    })

    return () => {
      cancelled = true
      void window.electronAPI.project.watchStop({ projectPath })
    }
  }, [projectPath, yjsDoc])

  useAgentFileSync(yjsDoc, projectPath, projectId, userId)
  useBinaryFileSync(projectId, projectPath, userId)
  useYjsFileWriteback(yjsDoc, projectPath, projectId, userId)

  return <>{children}</>
}

export function ProjectSyncProviderRuntime({
  children,
  projectId,
  userId,
  userName,
  projectSlug: _projectSlug,
  localPath,
  lastSyncAt: initialLastSyncAt,
  skipInitialSyncCheck: _skipInitialSyncCheck = false,
  onFilesChanged,
  collaborationEnabled = true,
  activeBranch = null,
  sharedBranch = null,
  documentScopeId = null,
}: ProjectSyncProviderProps) {
  const resolvedProjectId = (projectId ?? "__inactive_project__") as Id<"projects">
  const resolvedUserId = (userId ?? "__inactive_user__") as Id<"users">
  const resolvedUserName = userName ?? "User"
  const { accessToken } = useAuth()
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(initialLastSyncAt ?? null)
  const [progress, setProgress] = useState<SyncProgress>(IDLE_SYNC_PROGRESS)

  useEffect(() => {
    setLastSyncAt(initialLastSyncAt ?? null)
  }, [initialLastSyncAt])

  const canSync = Boolean(projectId && userId && localPath)
  const sharedCollaborationEnabled = canSync && collaborationEnabled
  const collaborationMode = sharedCollaborationEnabled ? "shared" : "local"

  const {
    status: collabSessionStatus,
    session: collabSession,
    refresh: refreshCollabSession,
  } = useCollabSession({
    projectId: String(resolvedProjectId),
    accessToken,
    enabled: sharedCollaborationEnabled && Boolean(accessToken),
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
    if (!projectId || !localPath) {
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
  }, [localPath, onFilesChanged, projectId, refreshActiveCollabSession, sharedCollaborationEnabled])

  return (
    <ProjectSyncContext.Provider
      value={
        canSync
          ? {
              isSynced: true,
              cloudSyncBlocked: false,
              lastSyncAt,
              projectPath: localPath,
              collaborationEnabled: sharedCollaborationEnabled,
              collaborationMode,
              activeBranch,
              sharedBranch,
              triggerSync,
              syncProgress: progress,
            }
          : null
      }
    >
      <YjsProjectProvider
        projectId={resolvedProjectId}
        userId={resolvedUserId}
        userName={resolvedUserName}
        projectPath={localPath}
        enabled={canSync}
        documentScopeId={documentScopeId}
        collaborationEnabled={sharedCollaborationEnabled}
        collabSession={activeCollabSession}
        refreshCollabSession={refreshActiveCollabSession}
      >
        <DeleteConflictDialog />
        <AgentFileSyncBridge
          projectId={projectId}
          userId={userId}
          projectPath={localPath}
        >
          {children}
        </AgentFileSyncBridge>
      </YjsProjectProvider>
    </ProjectSyncContext.Provider>
  )
}
