import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { useQuery, useMutation } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import { computeSyncPlan, hasSyncOperations, createEmptySyncPlan } from "@/lib/sync/syncEngine"
import { executeSyncPlan } from "@/lib/sync/syncExecutor"
import type { SyncProgress, SyncPlan, CloudFileEntry, LocalFileEntry } from "@/lib/sync/types"
import { SyncScreen } from "../components/SyncScreen"
import { useProjectDiffStore } from "@/stores/useProjectDiffStore"
import { YjsProjectProvider } from "@/contexts/YjsProjectContext"
import { useAgentFileSync } from "@/hooks/useAgentFileSync"
import { useYjsFileWriteback } from "@/hooks/useYjsFileWriteback"
import { useYjsProject } from "@/contexts/YjsProjectContext"

interface ProjectSyncContextValue {
  isSynced: boolean
  lastSyncAt: number | null
  triggerSync: () => Promise<void>
  syncProgress: SyncProgress
}

const ProjectSyncContext = createContext<ProjectSyncContextValue | null>(null)

export function useProjectSyncContext() {
  const ctx = useContext(ProjectSyncContext)
  if (!ctx) {
    throw new Error(
      "useProjectSyncContext must be used within ProjectSyncProvider"
    )
  }
  return ctx
}

interface ProjectSyncProviderProps {
  children: ReactNode
  projectId: Id<"projects">
  userId: Id<"users">
  userName: string
  projectSlug: string
  localPath: string | null
  lastSyncAt?: number
}

// Inner component that bridges agent file changes to Yjs and writes remote changes to disk
function AgentFileSyncBridge({
  projectPath,
  children,
}: {
  projectPath: string | null
  children: ReactNode
}) {
  const { yjsDoc } = useYjsProject()
  // Bridge local agent file writes to Yjs (local → Yjs → remote)
  useAgentFileSync(yjsDoc, projectPath)
  // Write remote Yjs changes back to local disk (remote → Yjs → local)
  useYjsFileWriteback(yjsDoc, projectPath)
  return <>{children}</>
}

export function ProjectSyncProvider({
  children,
  projectId,
  userId,
  userName,
  projectSlug,
  localPath,
  lastSyncAt: initialLastSyncAt,
}: ProjectSyncProviderProps) {
  const [isSynced, setIsSynced] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(
    initialLastSyncAt ?? null
  )
  const [showSyncScreen, setShowSyncScreen] = useState(true)
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [currentLocalPath, setCurrentLocalPath] = useState<string | null>(localPath)

  const [progress, setProgress] = useState<SyncProgress>({
    status: "idle",
    message: "",
    current: 0,
    total: 0,
    logs: [],
  })

  // Diff store - to clear badges when sync completes
  const clearDiff = useProjectDiffStore((state) => state.clearDiff)

  // Convex queries
  const cloudManifest = useQuery(api.projectFiles.getManifestForProject, {
    projectId,
  })

  // Query that includes download URLs
  const filesWithUrls = useQuery(api.projectFiles.listForProject, { projectId })

  // Convex mutations
  const generateUploadUrl = useMutation(api.projectFiles.generateUploadUrl)
  const saveFilesMutation = useMutation(api.projectFiles.saveFiles)
  const markFilesDeletedMutation = useMutation(api.projectFiles.markFilesDeleted)
  const updateSyncStatus = useMutation(api.projects.updateSyncStatus)
  const updateLocalPath = useMutation(api.projects.updateLocalPath)

  /**
   * Run initial sync check when component mounts.
   */
  useEffect(() => {
    if (cloudManifest === undefined || filesWithUrls === undefined) {
      // Still loading from Convex
      return
    }

    const runInitialSync = async () => {
      setProgress({
        status: "checking",
        message: "Checking project files...",
        current: 0,
        total: 0,
        logs: ["Starting sync check..."],
      })

      try {
        // Check if local folder exists
        let effectiveLocalPath = currentLocalPath
        const folderExists = effectiveLocalPath
          ? await window.electronAPI.project.exists(projectSlug)
          : false

        if (!folderExists) {
          // Create local folder
          setProgress((prev) => ({
            ...prev,
            message: "Creating local folder...",
            logs: [...prev.logs, "Local folder not found, creating..."],
          }))

          const result = await window.electronAPI.project.createFolder({
            slug: projectSlug,
            initGit: true,
          })

          if (!result.success) {
            throw new Error(result.error || "Failed to create folder")
          }

          effectiveLocalPath = result.localPath!
          setCurrentLocalPath(effectiveLocalPath)

          // Update project with local path
          await updateLocalPath({ projectId, localPath: effectiveLocalPath })

          setProgress((prev) => ({
            ...prev,
            logs: [...prev.logs, `Created folder at: ${effectiveLocalPath}`],
          }))
        }

        if (!effectiveLocalPath) {
          throw new Error("No local path available")
        }

        // Get local manifest
        const localResult = await window.electronAPI.sync.getLocalManifest({
          projectPath: effectiveLocalPath,
        })

        setProgress((prev) => ({
          ...prev,
          status: "planning",
          message: "Comparing files...",
          logs: [
            ...prev.logs,
            `Found ${localResult.totalFiles} local files`,
            `Found ${cloudManifest.length} cloud files`,
          ],
        }))

        // Convert manifests
        const localFiles: LocalFileEntry[] = localResult.manifest
        const cloudFiles: CloudFileEntry[] = cloudManifest.map((f) => ({
          _id: f._id,
          path: f.path,
          hash: f.hash,
          size: f.size,
          version: f.version,
          storageId: f.storageId,
          uploadedAt: f.uploadedAt,
        }))

        // Compute sync plan
        const syncPlan = computeSyncPlan(localFiles, cloudFiles, lastSyncAt ?? undefined)
        setPlan(syncPlan)

        const totalChanges =
          syncPlan.downloads.length +
          syncPlan.uploads.length +
          syncPlan.localDeletes.length +
          syncPlan.cloudDeletes.length

        if (totalChanges === 0) {
          // Already synced
          setProgress({
            status: "complete",
            message: "Everything up to date!",
            current: 0,
            total: 0,
            logs: [
              ...progress.logs,
              `${syncPlan.noChange} files in sync`,
              "✓ No changes needed",
            ],
          })
          setIsSynced(true)
          setShowSyncScreen(false)
        } else if (syncPlan.conflicts.length === 0) {
          // No conflicts - auto-sync
          setProgress((prev) => ({
            ...prev,
            message: `Syncing ${totalChanges} files...`,
            logs: [
              ...prev.logs,
              `Plan: ${syncPlan.downloads.length} downloads, ${syncPlan.uploads.length} uploads`,
            ],
          }))

          await executeSync(effectiveLocalPath, syncPlan)
        } else {
          // Conflicts exist - show sync screen for manual resolution
          setProgress((prev) => ({
            ...prev,
            status: "planning",
            message: `${syncPlan.conflicts.length} conflicts detected`,
            logs: [
              ...prev.logs,
              `⚠ ${syncPlan.conflicts.length} files have conflicts`,
              "Manual resolution required",
            ],
          }))
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error"
        console.error("[Sync] Initial sync failed:", error)
        setProgress({
          status: "error",
          message: errorMsg,
          current: 0,
          total: 0,
          logs: [...progress.logs, `Error: ${errorMsg}`],
        })
      }
    }

    runInitialSync()
  }, [cloudManifest, filesWithUrls]) // Re-run when cloud data loads

  /**
   * Execute sync plan.
   */
  const executeSync = async (projectPath: string, syncPlan: SyncPlan) => {
    if (!hasSyncOperations(syncPlan)) {
      setIsSynced(true)
      setShowSyncScreen(false)
      return
    }

    // Update project status
    try {
      await updateSyncStatus({ projectId, userId, status: "syncing" })
    } catch (err) {
      console.error("[Sync] Failed to update status:", err)
    }

    const result = await executeSyncPlan(syncPlan, {
      projectId,
      userId,
      projectPath,
      onProgress: setProgress,
      generateUploadUrl: () => generateUploadUrl({ projectId }),
      saveFiles: (args) => saveFilesMutation(args),
      markFilesDeleted: (args) => markFilesDeletedMutation(args),
      getStorageUrl: async (storageId) => {
        const file = filesWithUrls?.find((f) => f.storageId === storageId)
        return file?.url ?? null
      },
    })

    // Update final status
    try {
      await updateSyncStatus({
        projectId,
        userId,
        status: result.success ? "synced" : "error",
        errorMessage: result.error,
      })
    } catch (err) {
      console.error("[Sync] Failed to update final status:", err)
    }

    if (result.success) {
      setIsSynced(true)
      setLastSyncAt(Date.now())
      setShowSyncScreen(false)
      // Clear the diff badge for this project
      clearDiff(projectSlug)
    }
  }

  /**
   * Manual sync trigger.
   */
  const triggerSync = useCallback(async () => {
    if (!currentLocalPath || !plan) return

    await executeSync(currentLocalPath, plan)
  }, [currentLocalPath, plan])

  /**
   * Handle continue (skip sync).
   */
  const handleContinue = () => {
    setIsSynced(true)
    setShowSyncScreen(false)
  }

  /**
   * Handle retry sync.
   */
  const handleRetry = async () => {
    if (!currentLocalPath || !plan) return

    setProgress((prev) => ({
      ...prev,
      status: "syncing",
      message: "Retrying sync...",
    }))

    await executeSync(currentLocalPath, plan)
  }

  // Show sync screen while syncing
  if (showSyncScreen && !isSynced) {
    return (
      <SyncScreen
        progress={progress}
        plan={plan}
        onContinue={handleContinue}
        onRetry={handleRetry}
      />
    )
  }

  return (
    <ProjectSyncContext.Provider
      value={{
        isSynced,
        lastSyncAt,
        triggerSync,
        syncProgress: progress,
      }}
    >
      <YjsProjectProvider
        projectId={projectId}
        userId={userId}
        userName={userName}
      >
        <AgentFileSyncBridge projectPath={currentLocalPath}>
          {children}
        </AgentFileSyncBridge>
      </YjsProjectProvider>
    </ProjectSyncContext.Provider>
  )
}
