import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  type ReactNode,
} from "react"
import { useQuery, useMutation, useConvex } from "convex/react"
import { api } from "../../../../convex/_generated/api"
import type { Id } from "../../../../convex/_generated/dataModel"
import {
  classifyProjectReconciliation,
  computeSyncPlanWithMerge,
  hasSyncOperations,
} from "@/lib/sync/syncEngine"
import { executeSyncPlan } from "@/lib/sync/syncExecutor"
import type { SyncProgress, SyncPlan, CloudFileEntry, LocalFileEntry } from "@/lib/sync/types"
import {
  inspectLocalSyncHistory,
  loadLocalSyncHistory,
  saveLocalSyncHistory,
} from "@/lib/sync/syncHistory"
import { syncCheckpointStore } from "@/lib/sync/SyncCheckpointStore"
import { normalizeCloudEntries, normalizeRelativePath } from "@/lib/sync/pathNormalization"
import { SyncScreen } from "../components/SyncScreen"
import { useProjectDiffStore } from "@/stores/useProjectDiffStore"
import { YjsProjectProvider } from "@/contexts/YjsProjectContext"
import { useAgentFileSync } from "@/hooks/useAgentFileSync"
import { useBinaryFileSync } from "@/hooks/useBinaryFileSync"
import { useYjsFileWriteback } from "@/hooks/useYjsFileWriteback"
import { useYjsProject } from "@/contexts/YjsProjectContext"
import { DeleteConflictDialog } from "@/components/editor/DeleteConflictDialog"

const MANIFEST_LOG_SAMPLE_LIMIT = 12

function shortHash(hash?: string): string {
  if (!hash) return "missing"
  return hash.slice(0, 12)
}

function formatTimestamp(value: number | undefined): string {
  if (!value || Number.isNaN(value)) return "n/a"
  return new Date(value).toISOString()
}

function buildManifestComparisonLogs(
  localFiles: LocalFileEntry[],
  cloudFiles: CloudFileEntry[]
): string[] {
  const normalizedLocal = localFiles
    .map((file) => ({ entry: file, normalizedPath: normalizeRelativePath(file.path) }))
    .filter((item) => item.normalizedPath.length > 0)
  const normalizedCloud = normalizeCloudEntries(cloudFiles)

  const localByPath = new Map<string, LocalFileEntry>()
  for (const file of normalizedLocal) {
    localByPath.set(file.normalizedPath, file.entry)
  }

  const cloudByPath = new Map<string, CloudFileEntry>()
  for (const file of normalizedCloud) {
    cloudByPath.set(file.normalizedPath, file.entry)
  }

  const allPaths = new Set<string>([
    ...normalizedLocal.map((item) => item.normalizedPath),
    ...normalizedCloud.map((item) => item.normalizedPath),
  ])

  const mismatches: Array<{ path: string; local: LocalFileEntry; cloud: CloudFileEntry }> = []
  const localOnly: Array<{ path: string; local: LocalFileEntry }> = []
  const cloudOnly: Array<{ path: string; cloud: CloudFileEntry }> = []
  const cloudMissingHash: Array<{ path: string; local: LocalFileEntry; cloud: CloudFileEntry }> = []
  let identicalCount = 0

  for (const path of Array.from(allPaths).sort()) {
    const local = localByPath.get(path)
    const cloud = cloudByPath.get(path)

    if (local && cloud) {
      if (!cloud.hash) {
        cloudMissingHash.push({ path, local, cloud })
      } else if (local.hash === cloud.hash) {
        identicalCount += 1
      } else {
        mismatches.push({ path, local, cloud })
      }
      continue
    }

    if (local && !cloud) {
      localOnly.push({ path, local })
      continue
    }

    if (!local && cloud) {
      cloudOnly.push({ path, cloud })
    }
  }

  const logs: string[] = [
    `Manifest compare (normalized): local=${normalizedLocal.length}, cloud=${normalizedCloud.length}, union=${allPaths.size}`,
    `Manifest summary: same=${identicalCount}, mismatch=${mismatches.length}, localOnly=${localOnly.length}, cloudOnly=${cloudOnly.length}, cloudHashMissing=${cloudMissingHash.length}`,
  ]

  const appendSample = <T,>(
    title: string,
    rows: T[],
    formatter: (row: T) => string
  ) => {
    if (rows.length === 0) return
    logs.push(`${title} (${rows.length}):`)
    for (const row of rows.slice(0, MANIFEST_LOG_SAMPLE_LIMIT)) {
      logs.push(`  ${formatter(row)}`)
    }
    if (rows.length > MANIFEST_LOG_SAMPLE_LIMIT) {
      logs.push(`  ... +${rows.length - MANIFEST_LOG_SAMPLE_LIMIT} more`)
    }
  }

  appendSample("Hash mismatches", mismatches, (row) => (
    `${row.path} local=${shortHash(row.local.hash)} @ ${formatTimestamp(row.local.mtime)} cloud=${shortHash(row.cloud.hash)} @ ${formatTimestamp(row.cloud.uploadedAt)}`
  ))
  appendSample("Local-only paths", localOnly, (row) => (
    `${row.path} local=${shortHash(row.local.hash)} @ ${formatTimestamp(row.local.mtime)}`
  ))
  appendSample("Cloud-only paths", cloudOnly, (row) => (
    `${row.path} cloud=${shortHash(row.cloud.hash)} @ ${formatTimestamp(row.cloud.uploadedAt)}`
  ))
  appendSample("Cloud paths missing hash", cloudMissingHash, (row) => (
    `${row.path} local=${shortHash(row.local.hash)} cloud=missing`
  ))

  return logs
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
  const convex = useConvex()

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
  useBinaryFileSync(projectId, projectPath, userId, convex)
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
   * Execute sync plan.
   */
  const executeSync = useCallback(async (projectPath: string, syncPlan: SyncPlan) => {
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
      const cloudPaths = new Set(
        normalizeCloudEntries(
          (cloudManifest ?? []).map((file) => ({
            path: file.path,
            uploadedAt: file.uploadedAt,
            version: file.version,
          }))
        ).map((entry) => entry.normalizedPath)
      )
      for (const op of syncPlan.uploads) cloudPaths.add(op.path)
      for (const op of syncPlan.cloudDeletes) cloudPaths.delete(op.path)
      // Include auto-merged files in cloud paths
      for (const op of syncPlan.autoMerged ?? []) cloudPaths.add(op.path)
      await saveLocalSyncHistory(projectId, {
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
            if (readResult.success && readResult.content !== undefined) {
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
    } else {
      // Surface failures in the sync screen so users can retry instead of
      // continuing with a silently partial local/cloud state.
      setShowSyncScreen(true)
    }

    // Mark sync as complete regardless of result
    setIsSyncRunning(false)
  }, [
    clearDiff,
    cloudManifest,
    filesWithUrls,
    generateUploadUrl,
    markFilesDeletedMutation,
    onFilesChanged,
    projectId,
    projectSlug,
    saveFilesMutation,
    updateSyncStatus,
    userId,
  ])

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
        // Check if we already have a local path (e.g., from repo import)
        let effectiveLocalPath = currentLocalPath

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

        // Get local manifest
        const localResult = await window.electronAPI.sync.getLocalManifest({
          projectPath: effectiveLocalPath,
        })

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
        const manifestComparisonLogs = buildManifestComparisonLogs(localFiles, cloudFiles)

        console.groupCollapsed(`[Sync][Manifest] ${projectSlug}`)
        for (const line of manifestComparisonLogs) {
          console.log(line)
        }
        console.groupEnd()

        setProgress((prev) => ({
          ...prev,
          status: "planning",
          message: "Comparing files...",
          logs: [
            ...prev.logs,
            ...manifestComparisonLogs,
          ],
        }))

        const historyInspection = await inspectLocalSyncHistory(projectId)
        const localHistory = await loadLocalSyncHistory(projectId)

        const checkpointMap = await syncCheckpointStore.getCheckpointMap(projectId)

        // Compute sync plan with 3-way merge support
        const syncPlan = await computeSyncPlanWithMerge(
          localFiles,
          cloudFiles,
          localHistory.lastSyncAt ?? undefined,
          localHistory.cloudPathsAtLastSync,
          {
            projectId,
            checkpointMap,
            maxMergeBytes: 2 * 1024 * 1024,
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
        const planLogs: string[] = [
          `Plan summary: ↓${syncPlan.downloads.length} ↑${syncPlan.uploads.length} ✕local ${syncPlan.localDeletes.length} ✕cloud ${syncPlan.cloudDeletes.length} ⚠${syncPlan.conflicts.length} ⊕${syncPlan.autoMerged.length} =${syncPlan.noChange}`,
        ]
        if (syncPlan.conflicts.length > 0) {
          for (const conflict of syncPlan.conflicts.slice(0, MANIFEST_LOG_SAMPLE_LIMIT)) {
            planLogs.push(`  ⚠ conflict ${conflict.path} (${conflict.reason})`)
          }
          if (syncPlan.conflicts.length > MANIFEST_LOG_SAMPLE_LIMIT) {
            planLogs.push(`  ... +${syncPlan.conflicts.length - MANIFEST_LOG_SAMPLE_LIMIT} more conflicts`)
          }
        }

        const reconciliation = classifyProjectReconciliation(syncPlan, {
          pathExists: localPathExists,
          journalCorrupt: historyInspection.corrupted,
        })
        setProgress((prev) => ({
          ...prev,
          logs: [
            ...prev.logs,
            ...planLogs,
            `Reconciliation state: ${reconciliation.state}`,
            reconciliation.reason,
            ...(historyInspection.corrupted
              ? ["Detected corrupted local sync history; continuing with safe reconciliation defaults"]
              : []),
          ],
        }))

        const totalChanges =
          syncPlan.downloads.length +
          syncPlan.uploads.length +
          syncPlan.localDeletes.length +
          syncPlan.cloudDeletes.length +
          (syncPlan.autoMerged?.length ?? 0)

        if (totalChanges === 0) {
          // Already synced - no screen needed
          const now = Date.now()
          await saveLocalSyncHistory(projectId, {
            lastSyncAt: now,
            cloudPathsAtLastSync: normalizeCloudEntries(cloudFiles).map((f) => f.normalizedPath),
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
  }, [
    cloudManifest,
    filesWithUrls,
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

  // Conflicts/errors must be handled before entering the workspace.
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
        <DeleteConflictDialog />
        <AgentFileSyncBridge
          projectId={projectId}
          userId={userId}
          projectPath={currentLocalPath}
        >
          {children}
        </AgentFileSyncBridge>
      </YjsProjectProvider>
    </ProjectSyncContext.Provider>
  )
}
