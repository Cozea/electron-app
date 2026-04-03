import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useMemo,
  type ReactNode,
} from "react"
import { useConvex } from "convex/react"
import type { Id } from "../../../../convex/_generated/dataModel"
import type { SyncProgress } from "@/lib/sync/types"
import { YjsProjectProvider, normalizeCollabTransport } from "@/contexts/YjsProjectContext"
import { useAuth } from "@/contexts/AuthContext"
import { useAgentFileSync } from "@/hooks/useAgentFileSync"
import { useBinaryFileSync } from "@/hooks/useBinaryFileSync"
import { useCollabSession } from "@/hooks/useCollabSession"
import { useYjsFileWriteback } from "@/hooks/useYjsFileWriteback"
import { useYjsProject } from "@/contexts/YjsProjectContext"
import { DeleteConflictDialog } from "@/components/editor/DeleteConflictDialog"
import type { CollabSessionDescriptor } from "@/lib/yjs/CollabWsProvider"
import { GitDurabilityCoordinator } from "@/lib/git/GitDurabilityCoordinator"

interface ProjectSyncContextValue {
  isSynced: boolean
  cloudSyncBlocked: boolean
  lastSyncAt: number | null
  projectPath: string | null
  triggerSync: () => Promise<void>
  syncProgress: SyncProgress
}

const ProjectSyncContext = createContext<ProjectSyncContextValue | null>(null)

const IDLE_SYNC_PROGRESS: SyncProgress = {
  status: "idle",
  message: "",
  current: 0,
  total: 0,
  logs: [],
}

export function useProjectSyncContext() {
  const ctx = useContext(ProjectSyncContext)
  if (!ctx) {
    throw new Error(
      "useProjectSyncContext must be used within ProjectSyncProvider"
    )
  }
  return ctx
}

export function useOptionalProjectSyncContext() {
  return useContext(ProjectSyncContext)
}

interface ProjectSyncProviderProps {
  children: ReactNode
  projectId: Id<"projects"> | null
  userId: Id<"users"> | null
  userName: string | null
  projectSlug: string | null
  localPath: string | null
  lastSyncAt?: number
  skipInitialSyncCheck?: boolean
  onFilesChanged?: () => void
}

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

export function ProjectSyncProvider({
  children,
  projectId,
  userId,
  userName,
  projectSlug: _projectSlug,
  localPath,
  lastSyncAt: initialLastSyncAt,
  skipInitialSyncCheck: _skipInitialSyncCheck = false,
  onFilesChanged,
}: ProjectSyncProviderProps) {
  const resolvedProjectId = (projectId ?? "__inactive_project__") as Id<"projects">
  const resolvedUserId = (userId ?? "__inactive_user__") as Id<"users">
  const resolvedUserName = userName ?? "User"
  const convex = useConvex()
  const { accessToken } = useAuth()
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(initialLastSyncAt ?? null)
  const [progress, setProgress] = useState<SyncProgress>(IDLE_SYNC_PROGRESS)
  const collabTransport = useMemo(
    () => normalizeCollabTransport(import.meta.env.VITE_COLLAB_TRANSPORT),
    []
  )

  useEffect(() => {
    setLastSyncAt(initialLastSyncAt ?? null)
  }, [initialLastSyncAt])

  const canSync = Boolean(projectId && userId && localPath)
  const shouldUseWsCollab = canSync && collabTransport === "ws"

  const {
    status: collabSessionStatus,
    session: collabSession,
    refresh: refreshCollabSession,
  } = useCollabSession({
    projectId: String(resolvedProjectId),
    accessToken,
    enabled: shouldUseWsCollab && Boolean(accessToken),
  })

  const activeCollabSession: CollabSessionDescriptor | null =
    shouldUseWsCollab && collabSessionStatus === "ready" && collabSession
      ? {
          projectId: String(resolvedProjectId),
          roomId: collabSession.roomId,
          collabWsUrl: collabSession.collabWsUrl,
          token: collabSession.token,
          protocolVersion: collabSession.protocolVersion,
        }
      : null

  const refreshActiveCollabSession = useMemo(
    () => async (): Promise<CollabSessionDescriptor | null> => {
      if (!shouldUseWsCollab) {
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
      }
    },
    [refreshCollabSession, resolvedProjectId, shouldUseWsCollab]
  )

  const triggerSync = useCallback(async () => {
    if (!projectId || !userId || !localPath) {
      return
    }

    const coordinator = GitDurabilityCoordinator.acquireShared({
      projectId,
      projectPath: localPath,
      convex,
      userId,
    })

    setProgress({
      status: "syncing",
      message: "Syncing project...",
      current: 0,
      total: 0,
      logs: [],
    })

    try {
      await coordinator.flushNow(true)
      const now = Date.now()
      setLastSyncAt(now)
      onFilesChanged?.()
      setProgress({
        status: "complete",
        message: "Sync complete",
        current: 0,
        total: 0,
        logs: [],
      })
      window.setTimeout(() => {
        setProgress(IDLE_SYNC_PROGRESS)
      }, 1200)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "Failed to sync project"
      setProgress({
        status: "error",
        message,
        current: 0,
        total: 0,
        logs: [`Error: ${message}`],
      })
    } finally {
      coordinator.release()
    }
  }, [convex, localPath, onFilesChanged, projectId, userId])

  return (
    <ProjectSyncContext.Provider
      value={
        canSync
          ? {
              isSynced: true,
              cloudSyncBlocked: false,
              lastSyncAt,
              projectPath: localPath,
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
