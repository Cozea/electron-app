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
import { YjsProjectProvider } from "@/contexts/YjsProjectContext"
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
  projectId: Id<"projects">
  userId: Id<"users">
  userName: string
  projectSlug: string
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
  projectId: Id<"projects">
  userId: Id<"users">
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
  const convex = useConvex()
  const { accessToken } = useAuth()
  const [currentLocalPath, setCurrentLocalPath] = useState<string | null>(localPath)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(initialLastSyncAt ?? null)
  const [progress, setProgress] = useState<SyncProgress>(IDLE_SYNC_PROGRESS)

  useEffect(() => {
    setCurrentLocalPath(localPath)
  }, [localPath])

  useEffect(() => {
    setLastSyncAt(initialLastSyncAt ?? null)
  }, [initialLastSyncAt])

  const canSync = Boolean(currentLocalPath)

  const {
    status: collabSessionStatus,
    session: collabSession,
    refresh: refreshCollabSession,
  } = useCollabSession({
    projectId: String(projectId),
    accessToken,
    enabled: canSync && Boolean(accessToken),
  })

  const activeCollabSession: CollabSessionDescriptor | null =
    collabSessionStatus === "ready" && collabSession
      ? {
          projectId: String(projectId),
          roomId: collabSession.roomId,
          collabWsUrl: collabSession.collabWsUrl,
          token: collabSession.token,
          protocolVersion: collabSession.protocolVersion,
        }
      : null

  const refreshActiveCollabSession = useMemo(
    () => async (): Promise<CollabSessionDescriptor | null> => {
      const nextSession = await refreshCollabSession()
      if (!nextSession?.token || !nextSession?.roomId) {
        return null
      }

      return {
        projectId: String(projectId),
        roomId: nextSession.roomId,
        collabWsUrl: nextSession.collabWsUrl,
        token: nextSession.token,
        protocolVersion: nextSession.protocolVersion,
      }
    },
    [projectId, refreshCollabSession]
  )

  const triggerSync = useCallback(async () => {
    if (!currentLocalPath) {
      return
    }

    const coordinator = GitDurabilityCoordinator.acquireShared({
      projectId,
      projectPath: currentLocalPath,
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
  }, [convex, currentLocalPath, onFilesChanged, projectId, userId])

  return (
    <ProjectSyncContext.Provider
      value={{
        isSynced: canSync,
        cloudSyncBlocked: false,
        lastSyncAt,
        projectPath: currentLocalPath,
        triggerSync,
        syncProgress: progress,
      }}
    >
      <YjsProjectProvider
        projectId={projectId}
        userId={userId}
        userName={userName}
        projectPath={currentLocalPath}
        enabled={canSync}
        collabSession={activeCollabSession}
        refreshCollabSession={refreshActiveCollabSession}
      >
        <DeleteConflictDialog />
        {canSync ? (
          <AgentFileSyncBridge
            projectId={projectId}
            userId={userId}
            projectPath={currentLocalPath}
          >
            {children}
          </AgentFileSyncBridge>
        ) : (
          children
        )}
      </YjsProjectProvider>
    </ProjectSyncContext.Provider>
  )
}
