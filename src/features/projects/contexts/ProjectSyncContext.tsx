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
import { computeSyncPlan, computeSyncPlanWithMerge, hasSyncOperations } from "@/lib/sync/syncEngine"
import { executeSyncPlan } from "@/lib/sync/syncExecutor"
import type { SyncProgress, SyncPlan, CloudFileEntry, LocalFileEntry } from "@/lib/sync/types"
import { loadLocalSyncHistory, saveLocalSyncHistory } from "@/lib/sync/syncHistory"
import { syncCheckpointStore } from "@/lib/sync/SyncCheckpointStore"
import { SyncScreen } from "../components/SyncScreen"
import { useProjectDiffStore } from "@/stores/useProjectDiffStore"
import { YjsProjectProvider } from "@/contexts/YjsProjectContext"
import { useAgentFileSync } from "@/hooks/useAgentFileSync"
import { useYjsFileWriteback } from "@/hooks/useYjsFileWriteback"
import { useYjsProject } from "@/contexts/YjsProjectContext"

interface ProjectSyncContextValue {
  isSynced: boolean
  lastSyncAt: number | null
  projectPath: string | null
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
  onFilesChanged?: () => void
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

  // Watch local filesystem for edits that bypass Electron IPC (terminal, external editor, etc.)
  useEffect(() => {
    if (!projectPath || !yjsDoc) return

    let cancelled = false

    void window.electronAPI.project.watchStart({ projectPath }).then((res) => {
      if (!res?.success && !cancelled) {
        console.warn('[ProjectWatcher] Failed to start watcher:', res?.error)
      }
    })

    return () => {
      cancelled = true
      void window.electronAPI.project.watchStop({ projectPath })
    }
  }, [projectPath, yjsDoc])

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
  onFilesChanged,
}: ProjectSyncProviderProps) {
  const [isSynced, setIsSynced] = useState(false)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(
    initialLastSyncAt ?? null
  )
  // Don't show sync screen initially - only show if there are actual changes
  const [showSyncScreen, setShowSyncScreen] = useState(false)
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [currentLocalPath, setCurrentLocalPath] = useState<string | null>(localPath)
  // Prevent concurrent sync runs
  const [isSyncRunning, setIsSyncRunning] = useState(false)
  const [hasRunInitialSync, setHasRunInitialSync] = useState(false)

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
  // Use per-user local path (stored in projectMembers, not projects)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)

  /**
   * Run initial sync check when component mounts.
   */
  useEffect(() => {
    if (cloudManifest === undefined || filesWithUrls === undefined) {
      // Still loading from Convex
      return
    }

    // Prevent re-running if already synced or sync in progress
    if (hasRunInitialSync || isSyncRunning) {
      return
    }

    const runInitialSync = async () => {
      setIsSyncRunning(true)
      setHasRunInitialSync(true)
      setProgress({
        status: "checking",
        message: "Checking project files...",
        current: 0,
        total: 0,
        logs: ["Starting sync check..."],
      })

      try {
        // Check if local folder exists (always check, even if localPath not stored)
        let effectiveLocalPath = currentLocalPath
        const folderExists = await window.electronAPI.project.exists(projectSlug)

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

          // Update per-user local path (machine-specific)
          await updateMemberLocalPath({ projectId, userId, localPath: effectiveLocalPath })

          setProgress((prev) => ({
            ...prev,
            logs: [...prev.logs, `Created folder at: ${effectiveLocalPath}`],
          }))
        } else if (!effectiveLocalPath) {
          // Folder exists but we don't have the path stored - get it from electron
          const localPath = await window.electronAPI.project.getLocalPath(projectSlug)
          if (localPath) {
            effectiveLocalPath = localPath
            setCurrentLocalPath(effectiveLocalPath)
            // Update per-user local path (machine-specific)
            await updateMemberLocalPath({ projectId, userId, localPath: effectiveLocalPath })
            setProgress((prev) => ({
              ...prev,
              logs: [...prev.logs, `Found existing folder at: ${effectiveLocalPath}`],
            }))
          }
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

	    const localHistory = loadLocalSyncHistory(projectId)

	    // Compute sync plan with 3-way merge support
	    const syncPlan = await computeSyncPlanWithMerge(
	      localFiles,
	      cloudFiles,
	      localHistory.lastSyncAt ?? undefined,
	      localHistory.cloudPathsAtLastSync,
	      {
	        projectId,
	        readLocalFile: async (path: string) => {
	          const result = await window.electronAPI.project.readFile({
	            projectPath: effectiveLocalPath,
	            filePath: path,
	          })
	          return result.success ? result.content ?? null : null
	        },
	        fetchCloudFile: async (storageId: string) => {
	          const file = filesWithUrls?.find((f) => f.storageId === storageId)
	          if (!file?.url) return null
	          try {
	            const response = await fetch(file.url)
	            return response.ok ? await response.text() : null
	          } catch {
	            return null
	          }
	        },
	      }
	    )
	    setPlan(syncPlan)

        const totalChanges =
          syncPlan.downloads.length +
          syncPlan.uploads.length +
          syncPlan.localDeletes.length +
          syncPlan.cloudDeletes.length +
          (syncPlan.autoMerged?.length ?? 0)

	        if (totalChanges === 0) {
	          // Already synced - no screen needed
	          const now = Date.now()
	          saveLocalSyncHistory(projectId, {
	            lastSyncAt: now,
	            cloudPathsAtLastSync: cloudFiles.map((f) => f.path),
	          })
	          setLastSyncAt(now)
	          setProgress({
	            status: "complete",
	            message: "Everything up to date!",
	            current: 0,
            total: 0,
            logs: [],
          })
          setIsSynced(true)
          setIsSyncRunning(false)
          // showSyncScreen is already false
        } else if (syncPlan.conflicts.length === 0) {
          // No conflicts - auto-sync silently
          setProgress((prev) => ({
            ...prev,
            status: "syncing",
            message: `Syncing ${totalChanges} files...`,
            logs: [],
          }))

          await executeSync(effectiveLocalPath, syncPlan)
        } else {
          // Conflicts exist - show sync screen for manual resolution
          setShowSyncScreen(true)
          setIsSyncRunning(false)
          setProgress((prev) => ({
            ...prev,
            status: "planning",
            message: `${syncPlan.conflicts.length} conflicts detected`,
            logs: [
              `⚠ ${syncPlan.conflicts.length} files have conflicts`,
              "Manual resolution required",
            ],
          }))
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error"
        console.error("[Sync] Initial sync failed:", error)
        setShowSyncScreen(true)
        setIsSyncRunning(false)
        setProgress({
          status: "error",
          message: errorMsg,
          current: 0,
          total: 0,
          logs: [`Error: ${errorMsg}`],
        })
      }
    }

    runInitialSync()
  }, [cloudManifest, filesWithUrls, hasRunInitialSync, isSyncRunning])

  /**
   * Execute sync plan.
   */
  const executeSync = async (projectPath: string, syncPlan: SyncPlan) => {
    setIsSyncRunning(true)

    if (!hasSyncOperations(syncPlan)) {
      setIsSynced(true)
      setShowSyncScreen(false)
      setIsSyncRunning(false)
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
	      const now = Date.now()
	      const cloudPaths = new Set((cloudManifest ?? []).map((f) => f.path))
	      for (const op of syncPlan.uploads) cloudPaths.add(op.path)
	      for (const op of syncPlan.cloudDeletes) cloudPaths.delete(op.path)
	      // Include auto-merged files in cloud paths
	      for (const op of syncPlan.autoMerged ?? []) cloudPaths.add(op.path)
	      saveLocalSyncHistory(projectId, {
	        lastSyncAt: now,
	        cloudPathsAtLastSync: cloudPaths,
	      })

	      // Save file checkpoints for future 3-way merges
	      try {
	        const checkpointFiles = new Map<string, { content: string; hash: string }>()

	        // Read all synced files and save as checkpoints
	        const filesToCheckpoint = [
	          ...syncPlan.downloads.map((op) => op.path),
	          ...syncPlan.uploads.map((op) => op.path),
	          ...(syncPlan.autoMerged ?? []).map((op) => op.path),
	        ]

	        for (const filePath of filesToCheckpoint) {
	          try {
	            const readResult = await window.electronAPI.project.readFile({
	              projectPath,
	              filePath,
	            })
	            if (readResult.success && readResult.content) {
	              // Compute hash
	              const encoder = new TextEncoder()
	              const data = encoder.encode(readResult.content)
	              const hashBuffer = await crypto.subtle.digest("SHA-256", data)
	              const hashArray = Array.from(new Uint8Array(hashBuffer))
	              const hash = hashArray.map((b) => b.toString(16).padStart(2, "0")).join("")

	              checkpointFiles.set(filePath, { content: readResult.content, hash })
	            }
	          } catch {
	            // Skip files that can't be read (binary, etc.)
	          }
	        }

	        if (checkpointFiles.size > 0) {
	          await syncCheckpointStore.saveCheckpoint(projectId, checkpointFiles)
	        }
	      } catch (err) {
	        console.warn("[Sync] Failed to save checkpoints:", err)
	        // Non-fatal - sync still succeeded
	      }

	      setIsSynced(true)
	      setLastSyncAt(now)
	      setShowSyncScreen(false)
	      // Clear the diff badge for this project
	      clearDiff(projectSlug)
	      onFilesChanged?.()
	    }

    // Mark sync as complete regardless of result
    setIsSyncRunning(false)
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

  /**
   * Handle sync after resolving conflicts.
   */
  const handleSyncResolved = async (resolvedPlan: SyncPlan) => {
    if (!currentLocalPath) return

    setPlan(resolvedPlan)
    setProgress((prev) => ({
      ...prev,
      status: "syncing",
      message: "Syncing files...",
      logs: [],
    }))

    await executeSync(currentLocalPath, resolvedPlan)
  }

  // Show sync screen while syncing
  if (showSyncScreen && !isSynced) {
    return (
      <SyncScreen
        progress={progress}
        plan={plan}
        onContinue={handleContinue}
        onRetry={handleRetry}
        onSync={handleSyncResolved}
      />
    )
  }

  return (
    <ProjectSyncContext.Provider
      value={{
        isSynced,
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
      >
        <AgentFileSyncBridge projectPath={currentLocalPath}>
          {children}
        </AgentFileSyncBridge>
      </YjsProjectProvider>
    </ProjectSyncContext.Provider>
  )
}
