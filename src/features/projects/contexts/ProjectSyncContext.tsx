import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { useMutation } from "convex/react"
import { useNavigate } from "react-router-dom"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import type { SyncProgress, SyncPlan, SyncOperation } from "@/lib/sync/types"
import { SyncScreen } from "../components/SyncScreen"
import { useProjectDiffStore } from "@/stores/useProjectDiffStore"
import { YjsProjectProvider } from "@/contexts/YjsProjectContext"
import { useAgentFileSync } from "@/hooks/useAgentFileSync"
import { useBinaryFileSync } from "@/hooks/useBinaryFileSync"
import { useYjsFileWriteback } from "@/hooks/useYjsFileWriteback"
import { useYjsProject } from "@/contexts/YjsProjectContext"
import { DeleteConflictDialog } from "@/components/editor/DeleteConflictDialog"
import { Dialog, DialogContent, DialogDescription, DialogTitle } from "@/components/ui/dialog"
import {
  getMeaningfulLocalFileCount,
  isBootstrapOnlyLocalPath,
} from "../lib/localWorkspaceState"
import type {
  GitReplicaConflictDecision,
  GitReplicaPlanResult,
} from "@shared/electronApiTypes"

function createLocalPlaceholder(pathValue: string): SyncOperation["localEntry"] {
  return {
    path: pathValue,
    hash: "",
    size: 0,
    mtime: Date.now(),
  }
}

function createCloudPlaceholder(pathValue: string): SyncOperation["cloudEntry"] {
  return {
    _id: "placeholder" as Id<"projectFiles">,
    path: pathValue,
    hash: "",
    size: 0,
    version: 1,
    storageId: "placeholder" as Id<"_storage">,
    uploadedAt: Date.now(),
  }
}

function toSyncPlanFromReplicaPlan(replicaPlan: GitReplicaPlanResult): SyncPlan {
  return {
    downloads: replicaPlan.downloads.map((entry) => ({
      type: "download",
      path: entry.path,
      reason: entry.reason,
      cloudEntry: createCloudPlaceholder(entry.path),
    })),
    uploads: replicaPlan.uploads.map((entry) => ({
      type: "upload",
      path: entry.path,
      reason: entry.reason,
      localEntry: createLocalPlaceholder(entry.path),
    })),
    localDeletes: replicaPlan.localDeletes.map((entry) => ({
      type: "delete-local",
      path: entry.path,
      reason: entry.reason,
      localEntry: createLocalPlaceholder(entry.path),
    })),
    cloudDeletes: replicaPlan.cloudDeletes.map((entry) => ({
      type: "delete-cloud",
      path: entry.path,
      reason: entry.reason,
      cloudEntry: createCloudPlaceholder(entry.path),
    })),
    autoMerged: replicaPlan.autoMerged.map((entry) => ({
      type: "auto-merged",
      path: entry.path,
      reason: entry.reason,
      localEntry: createLocalPlaceholder(entry.path),
      cloudEntry: createCloudPlaceholder(entry.path),
      mergeDetails: {
        localChanges: 0,
        cloudChanges: 0,
        mergedContent: "",
      },
    })),
    conflicts: replicaPlan.conflicts.map((entry) => ({
      type: "conflict",
      path: entry.path,
      reason: entry.reason,
      localEntry: entry.localExists ? createLocalPlaceholder(entry.path) : undefined,
      cloudEntry: entry.remoteExists ? createCloudPlaceholder(entry.path) : undefined,
    })),
    noChange: replicaPlan.noChange,
  }
}

function deriveConflictDecisions(
  originalPlan: SyncPlan,
  resolvedPlan: SyncPlan
): Record<string, GitReplicaConflictDecision> {
  const decisions: Record<string, GitReplicaConflictDecision> = {}
  const addedUploads = new Set(
    resolvedPlan.uploads
      .map((entry) => entry.path)
      .filter((pathValue) => !originalPlan.uploads.some((item) => item.path === pathValue))
  )
  const addedDownloads = new Set(
    resolvedPlan.downloads
      .map((entry) => entry.path)
      .filter((pathValue) => !originalPlan.downloads.some((item) => item.path === pathValue))
  )
  const addedLocalDeletes = new Set(
    resolvedPlan.localDeletes
      .map((entry) => entry.path)
      .filter((pathValue) => !originalPlan.localDeletes.some((item) => item.path === pathValue))
  )
  const addedCloudDeletes = new Set(
    resolvedPlan.cloudDeletes
      .map((entry) => entry.path)
      .filter((pathValue) => !originalPlan.cloudDeletes.some((item) => item.path === pathValue))
  )

  for (const conflict of originalPlan.conflicts) {
    const pathValue = conflict.path
    if (conflict.localEntry && conflict.cloudEntry) {
      if (addedUploads.has(pathValue)) decisions[pathValue] = "local"
      if (addedDownloads.has(pathValue)) decisions[pathValue] = "cloud"
      continue
    }
    if (conflict.localEntry && !conflict.cloudEntry) {
      if (addedUploads.has(pathValue)) decisions[pathValue] = "local"
      if (addedLocalDeletes.has(pathValue)) decisions[pathValue] = "cloud"
      continue
    }
    if (!conflict.localEntry && conflict.cloudEntry) {
      if (addedCloudDeletes.has(pathValue)) decisions[pathValue] = "local"
      if (addedDownloads.has(pathValue)) decisions[pathValue] = "cloud"
    }
  }

  // Apply non-conflict intent overrides when caller rewrites the plan shape
  // (e.g. local-wipe recovery converting cloudDeletes -> downloads).
  const originalUploadPaths = new Set(originalPlan.uploads.map((entry) => entry.path))
  const resolvedUploadPaths = new Set(resolvedPlan.uploads.map((entry) => entry.path))
  const originalCloudDeletePaths = new Set(originalPlan.cloudDeletes.map((entry) => entry.path))
  const resolvedDownloadPaths = new Set(resolvedPlan.downloads.map((entry) => entry.path))

  for (const pathValue of originalUploadPaths) {
    if (!resolvedUploadPaths.has(pathValue)) {
      decisions[pathValue] = "cloud"
    }
  }

  for (const pathValue of originalCloudDeletePaths) {
    if (resolvedDownloadPaths.has(pathValue)) {
      decisions[pathValue] = "cloud"
    }
  }

  return decisions
}

function hasSyncOperations(plan: SyncPlan): boolean {
  return (
    plan.downloads.length > 0 ||
    plan.uploads.length > 0 ||
    plan.localDeletes.length > 0 ||
    plan.cloudDeletes.length > 0 ||
    plan.autoMerged.length > 0 ||
    plan.conflicts.length > 0
  )
}

function isLikelyLocalWorkspaceWipe(
  plan: SyncPlan,
  meaningfulLocalFileCount: number | null
): boolean {
  if (meaningfulLocalFileCount !== 0) {
    return false
  }

  const hasNoLocalMutations =
    plan.uploads.every((entry) => isBootstrapOnlyLocalPath(entry.path)) &&
    plan.localDeletes.every((entry) => isBootstrapOnlyLocalPath(entry.path)) &&
    plan.conflicts.every((entry) => isBootstrapOnlyLocalPath(entry.path)) &&
    (plan.autoMerged?.every((entry) => isBootstrapOnlyLocalPath(entry.path)) ?? true)

  if (!hasNoLocalMutations) {
    return false
  }

  // Replica plans may express a wipe either as restore downloads
  // or as cloud-delete intents from an empty local tree.
  return plan.downloads.length > 0 || plan.cloudDeletes.length > 0
}

function buildLocalWipeRecoveryPlan(plan: SyncPlan): SyncPlan {
  const restoreDownloads =
    plan.downloads.length > 0
      ? plan.downloads.map((entry) => ({
          ...entry,
          reason: "Local workspace is empty; restore from cloud",
        }))
      : plan.cloudDeletes.map((entry) => ({
          type: "download" as const,
          path: entry.path,
          reason: "Local workspace is empty; restore from cloud",
          cloudEntry: createCloudPlaceholder(entry.path),
        }))

  return {
    downloads: restoreDownloads,
    uploads: [],
    localDeletes: [],
    cloudDeletes: [],
    conflicts: [],
    autoMerged: [],
    noChange: restoreDownloads.length === 0 ? plan.noChange : 0,
  }
}

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
  initialGateSyncScreen?: boolean
  skipInitialSyncCheck?: boolean
  onFilesChanged?: () => void
}

// Inner component that bridges agent file changes to Yjs and writes remote changes to disk
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
  useAgentFileSync(yjsDoc, projectPath, projectId, userId)
  // Sync binary files via shared file-op pipeline.
  useBinaryFileSync(projectId, projectPath, userId)
  // Write remote Yjs changes back to local disk (remote → Yjs → local)
  useYjsFileWriteback(yjsDoc, projectPath, projectId)
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
  initialGateSyncScreen = false,
  skipInitialSyncCheck = false,
  onFilesChanged,
}: ProjectSyncProviderProps) {
  const navigate = useNavigate()
  const [isSynced, setIsSynced] = useState(skipInitialSyncCheck)
  const [lastSyncAt, setLastSyncAt] = useState<number | null>(
    initialLastSyncAt ?? null
  )
  // Usually we don't show sync screen initially, but card/row pre-check can
  // request a gated open when conflicts/recovery are likely.
  const [showSyncScreen, setShowSyncScreen] = useState(initialGateSyncScreen)
  const [plan, setPlan] = useState<SyncPlan | null>(null)
  const [requireSyncBeforeContinue, setRequireSyncBeforeContinue] = useState(false)
  const [currentLocalPath, setCurrentLocalPath] = useState<string | null>(localPath)
  // Prevent concurrent sync runs
  const [isSyncRunning, setIsSyncRunning] = useState(false)
  const [hasRunInitialSync, setHasRunInitialSync] = useState(skipInitialSyncCheck)

  const [progress, setProgress] = useState<SyncProgress>(() =>
    initialGateSyncScreen
      ? {
        status: "checking",
        message: "Checking project files...",
        current: 0,
        total: 0,
        logs: ["Starting sync check..."],
      }
      : {
        status: "idle",
        message: "",
        current: 0,
        total: 0,
        logs: [],
      }
  )

  // Diff store - to clear badges when sync completes
  const clearDiff = useProjectDiffStore((state) => state.clearDiff)

  const [replicaPlan, setReplicaPlan] = useState<GitReplicaPlanResult | null>(null)

  const updateSyncStatus = useMutation(api.projects.updateSyncStatus)
  // Use per-user local path (stored in projectMembers, not projects)
  const updateMemberLocalPath = useMutation(api.projectMembers.updateMemberLocalPath)

  /**
   * Execute Git replica sync plan.
   */
  const executeSync = useCallback(async (
    projectPath: string,
    syncPlan: SyncPlan,
    overrideConflictDecisions?: Record<string, GitReplicaConflictDecision>
  ) => {
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

    const sessionId = replicaPlan?.sessionId ?? crypto.randomUUID()
    const conflictDecisions = overrideConflictDecisions ??
      (plan ? deriveConflictDecisions(plan, syncPlan) : {})

    if (requireSyncBeforeContinue && plan) {
      for (const entry of plan.cloudDeletes) {
        conflictDecisions[entry.path] = "cloud"
      }
      for (const entry of plan.uploads) {
        conflictDecisions[entry.path] = "cloud"
      }
    }

    console.log("[ProjectSync] Executing replica apply", {
      projectId: String(projectId),
      sessionId,
      decisions: Object.keys(conflictDecisions).length,
      requireSyncBeforeContinue,
    })

    try {
      const result = await window.electronAPI.sync.gitReplicaExecute({
        projectId: String(projectId),
        projectPath,
        sessionId,
        conflictDecisions,
      })

      const syncErrorMessage =
        result.error || "Failed to sync project files"

      // Update final status
      try {
        await updateSyncStatus({
          projectId,
          userId,
          status: result.success && result.applied ? "synced" : "error",
          errorMessage: result.success && result.applied ? undefined : syncErrorMessage,
        })
      } catch (err) {
        console.error("[Sync] Failed to update final status:", err)
      }

      if (result.success && result.applied) {
        const now = Date.now()
        setIsSynced(true)
        setLastSyncAt(now)
        setShowSyncScreen(false)
        setRequireSyncBeforeContinue(false)
        // Clear the diff badge for this project
        clearDiff(projectSlug)
        onFilesChanged?.()
        setProgress({
          status: "complete",
          message: "Sync complete",
          current: 0,
          total: 0,
          logs: [],
        })
      } else if (result.requiresConflictResolution) {
        setShowSyncScreen(true)
        setProgress((prev) => ({
          ...prev,
          status: "planning",
          message: "Conflict resolution required",
          logs: [...prev.logs, "⚠ Conflict resolution required before sync can continue"],
        }))
      } else {
        // Surface non-conflict failures explicitly. Otherwise UI can stay on
        // "Syncing files..." while already failed.
        setShowSyncScreen(true)
        setProgress({
          status: "error",
          message: syncErrorMessage,
          current: 0,
          total: 0,
          logs: [`Error: ${syncErrorMessage}`],
        })
      }
    } catch (error) {
      const syncErrorMessage =
        error instanceof Error ? error.message : "Failed to sync project files"

      try {
        await updateSyncStatus({
          projectId,
          userId,
          status: "error",
          errorMessage: syncErrorMessage,
        })
      } catch (err) {
        console.error("[Sync] Failed to update error status:", err)
      }

      setShowSyncScreen(true)
      setProgress({
        status: "error",
        message: syncErrorMessage,
        current: 0,
        total: 0,
        logs: [`Error: ${syncErrorMessage}`],
      })
    } finally {
      // Mark sync as complete regardless of result.
      setIsSyncRunning(false)
    }
  }, [
    clearDiff,
    onFilesChanged,
    plan,
    projectId,
    projectSlug,
    requireSyncBeforeContinue,
    replicaPlan,
    updateSyncStatus,
    userId,
  ])

  /**
   * Run initial sync check when component mounts.
   */
  useEffect(() => {
    // Prevent re-running if already synced or sync in progress
    if (hasRunInitialSync || isSyncRunning) {
      return
    }

    const runInitialSync = async () => {
      setIsSyncRunning(true)
      setHasRunInitialSync(true)
      setRequireSyncBeforeContinue(false)
      setProgress({
        status: "checking",
        message: "Checking project files...",
        current: 0,
        total: 0,
        logs: ["Starting sync check..."],
      })

      try {
        // Check if we already have a local path (e.g., from repo import)
        let effectiveLocalPath = currentLocalPath
      let localFileCount: number | null = null
      let meaningfulLocalFileCount: number | null = null

        if (effectiveLocalPath) {
          // For repo imports, we already have the local path - just verify it exists
          setProgress((prev) => ({
            ...prev,
            logs: [...prev.logs, `Using existing folder at: ${effectiveLocalPath}`],
          }))
        } else {
          // No localPath provided - check if folder exists at slug path or create one
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
          } else {
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
        }

        if (!effectiveLocalPath) {
          throw new Error("No local path available")
        }

        const localPathExists = await window.electronAPI.project.pathExists(effectiveLocalPath)
        if (!localPathExists) {
          throw new Error("Local project directory no longer exists")
        }

        const localFiles = await window.electronAPI.project.listFiles({
          projectPath: effectiveLocalPath,
        })
        if (localFiles.success) {
          const localPaths = (localFiles.files ?? []).map((entry) => entry.path)
          localFileCount = localPaths.length
          meaningfulLocalFileCount = getMeaningfulLocalFileCount(localPaths)
        }

        setProgress((prev) => ({
          ...prev,
          status: "planning",
          message: "Bootstrapping Git replica...",
        }))

        const bootstrap = await window.electronAPI.sync.gitReplicaBootstrap({
          projectId: String(projectId),
          projectPath: effectiveLocalPath,
        })
        if (!bootstrap.success) {
          throw new Error(bootstrap.error || "Failed to bootstrap replica")
        }

        setProgress((prev) => ({
          ...prev,
          status: "planning",
          message: "Planning replica merge...",
        }))

        const replicaSyncPlan = await window.electronAPI.sync.gitReplicaPlan({
          projectId: String(projectId),
          projectPath: effectiveLocalPath,
        })
        if (!replicaSyncPlan.success) {
          throw new Error(replicaSyncPlan.error || "Failed to create replica sync plan")
        }
        console.log("[ProjectSync] Replica plan computed", {
          projectId: String(projectId),
          projectPath: effectiveLocalPath,
          localFileCount,
          downloads: replicaSyncPlan.downloads.length,
          uploads: replicaSyncPlan.uploads.length,
          cloudDeletes: replicaSyncPlan.cloudDeletes.length,
          localDeletes: replicaSyncPlan.localDeletes.length,
          conflicts: replicaSyncPlan.conflicts.length,
          autoMerged: replicaSyncPlan.autoMerged.length,
          noChange: replicaSyncPlan.noChange,
        })
        setReplicaPlan(replicaSyncPlan)
        const syncPlan = toSyncPlanFromReplicaPlan(replicaSyncPlan)
        const localWipeDetected = isLikelyLocalWorkspaceWipe(syncPlan, meaningfulLocalFileCount)
        if (localWipeDetected) {
          console.warn("[ProjectSync] Local wipe detection triggered", {
            projectId: String(projectId),
            projectPath: effectiveLocalPath,
            localFileCount,
            meaningfulLocalFileCount,
            restoreCandidates: Math.max(syncPlan.downloads.length, syncPlan.cloudDeletes.length),
            cloudDeletes: syncPlan.cloudDeletes.length,
            downloads: syncPlan.downloads.length,
            uploads: syncPlan.uploads.length,
            localDeletes: syncPlan.localDeletes.length,
            conflicts: syncPlan.conflicts.length,
            autoMerged: syncPlan.autoMerged.length,
          })
          setRequireSyncBeforeContinue(true)
          const recoveryPlan = buildLocalWipeRecoveryPlan(syncPlan)
          setPlan(recoveryPlan)
          setShowSyncScreen(true)
          setIsSyncRunning(false)
          setProgress({
            status: "planning",
            message: "Local files are missing. Restore from cloud?",
            current: 0,
            total: 0,
            logs: [
              "⚠ Local workspace is empty. Preparing cloud restore.",
              `Prepared ${recoveryPlan.downloads.length} files to download from cloud`,
              "Click Download cloud files to restore your local workspace",
            ],
          })
          return
        }

        setPlan(syncPlan)

        const totalChanges =
          syncPlan.downloads.length +
          syncPlan.uploads.length +
          syncPlan.localDeletes.length +
          syncPlan.cloudDeletes.length +
          (syncPlan.autoMerged?.length ?? 0)
        const conflictCount = syncPlan.conflicts.length

        if (conflictCount > 0) {
          console.warn("[ProjectSync] Conflict detection triggered", {
            projectId: String(projectId),
            projectPath: effectiveLocalPath,
            localFileCount,
            meaningfulLocalFileCount,
            conflicts: conflictCount,
            downloads: syncPlan.downloads.length,
            uploads: syncPlan.uploads.length,
            cloudDeletes: syncPlan.cloudDeletes.length,
            localDeletes: syncPlan.localDeletes.length,
            autoMerged: syncPlan.autoMerged.length,
            totalChanges,
          })
        }

        if (totalChanges === 0) {
          // Already synced - no screen needed
          const now = Date.now()
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
  }, [
    hasRunInitialSync,
    isSyncRunning,
    currentLocalPath,
    projectId,
    projectSlug,
    updateMemberLocalPath,
    userId,
    executeSync,
  ])

  /**
   * Manual sync trigger.
   */
  const triggerSync = useCallback(async () => {
    if (!currentLocalPath || !plan) return

    await executeSync(currentLocalPath, plan)
  }, [currentLocalPath, plan, executeSync])

  /**
   * Handle continue (skip sync).
   */
  const handleContinue = () => {
    setIsSynced(true)
    setRequireSyncBeforeContinue(false)
    setShowSyncScreen(false)
  }

  const handleCancel = () => {
    setRequireSyncBeforeContinue(false)
    navigate("/projects")
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

    const decisions = plan ? deriveConflictDecisions(plan, resolvedPlan) : {}
    await executeSync(currentLocalPath, resolvedPlan, decisions)
  }

  const isBlockingSyncScreen = showSyncScreen && !isSynced

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
        projectPath={currentLocalPath}
      >
        <DeleteConflictDialog />
        {isBlockingSyncScreen ? (
          <Dialog
            open
            onOpenChange={() => {
              // Keep this blocking gate modal open until explicit action.
            }}
          >
            <DialogContent
              showCloseButton={false}
              className="w-[min(960px,calc(100vw-2rem))] max-w-none max-h-[85vh] overflow-y-auto border-0 bg-transparent p-0 shadow-none"
            >
              <>
                <DialogTitle className="sr-only">Project sync required</DialogTitle>
                <DialogDescription className="sr-only">
                  Resolve sync changes before entering the project workspace.
                </DialogDescription>
                <SyncScreen
                  progress={progress}
                  plan={plan}
                  onContinue={handleContinue}
                  onRetry={handleRetry}
                  onCancel={handleCancel}
                  onSync={handleSyncResolved}
                  syncActionLabel={requireSyncBeforeContinue ? "Download cloud files" : undefined}
                  syncActionIcon={requireSyncBeforeContinue ? "download" : undefined}
                  hideContinue={requireSyncBeforeContinue}
                  variant="panel"
                />
              </>
            </DialogContent>
          </Dialog>
        ) : (
          <AgentFileSyncBridge
            projectId={projectId}
            userId={userId}
            projectPath={currentLocalPath}
          >
            {children}
          </AgentFileSyncBridge>
        )}
      </YjsProjectProvider>
    </ProjectSyncContext.Provider>
  )
}
