import type { LocalFileEntry, CloudFileEntry, SyncPlan, SyncOperation } from "./types"
import { syncCheckpointStore } from "./SyncCheckpointStore"
import { threeWayMerge } from "./ThreeWayMerge"
import type { Id } from "../../../convex/_generated/dataModel"

/**
 * Binary file extensions that cannot be merged.
 */
const BINARY_EXTENSIONS = new Set([
  "png", "jpg", "jpeg", "gif", "webp", "ico", "bmp", "tiff", "svg",
  "pdf", "zip", "gz", "tar", "rar", "7z",
  "mp3", "wav", "ogg", "mp4", "mov", "avi", "webm",
  "ttf", "otf", "woff", "woff2", "eot", "wasm",
])

/**
 * Check if a file path is a binary file.
 */
function isBinaryPath(filePath: string): boolean {
  const ext = filePath.split(".").pop()?.toLowerCase() ?? ""
  return BINARY_EXTENSIONS.has(ext)
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  fn: (item: T) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return []
  const results = new Array<R>(items.length)
  let index = 0

  const workers = new Array(Math.min(limit, items.length)).fill(0).map(async () => {
    while (true) {
      const current = index++
      if (current >= items.length) break
      results[current] = await fn(items[current])
    }
  })

  await Promise.all(workers)
  return results
}

/**
 * Options for 3-way merge during sync planning.
 */
export interface MergeOptions {
  /** Project ID for loading checkpoints */
  projectId: Id<"projects">
  /** Optional preloaded checkpoint map for fast lookup */
  checkpointMap?: Record<string, { content: string; hash: string; syncedAt: number }>
  /** Callback to read local file content */
  readLocalFile: (path: string) => Promise<string | null>
  /** Callback to fetch cloud file content by storage ID */
  fetchCloudFile: (storageId: string) => Promise<string | null>
  /** Maximum file size (bytes) to attempt 3-way merge */
  maxMergeBytes?: number
  /** Max concurrent merge operations */
  concurrency?: number
}

/**
 * Compute a sync plan by comparing local and cloud file manifests.
 *
 * Algorithm:
 * 1. Build maps of files by path for both local and cloud
 * 2. For each unique path:
 *    - If both exist with same hash: no change
 *    - If both exist with different hash: determine newer (upload or download)
 *    - If only local exists: new file (upload) or deleted from cloud (delete local)
 *    - If only cloud exists: missing locally (download)
 * 3. Use lastSyncTime to detect conflicts (both modified since last sync)
 */
export function computeSyncPlan(
  local: LocalFileEntry[],
  cloud: CloudFileEntry[],
  lastSyncTime?: number,
  cloudPathsAtLastSync?: ReadonlySet<string>
): SyncPlan {
  const plan: SyncPlan = {
    downloads: [],
    uploads: [],
    localDeletes: [],
    cloudDeletes: [],
    conflicts: [],
    autoMerged: [],
    noChange: 0,
  }

  // Build maps by path
  const localByPath = new Map<string, LocalFileEntry>()
  for (const file of local) {
    localByPath.set(file.path, file)
  }

  const cloudByPath = new Map<string, CloudFileEntry>()
  for (const file of cloud) {
    cloudByPath.set(file.path, file)
  }

  // Get all unique paths
  const allPaths = new Set<string>([
    ...local.map((f) => f.path),
    ...cloud.map((f) => f.path),
  ])

  for (const path of allPaths) {
    const localFile = localByPath.get(path)
    const cloudFile = cloudByPath.get(path)

    if (localFile && cloudFile) {
      // Both exist - compare hashes
      if (localFile.hash === cloudFile.hash) {
        // Files are identical
        plan.noChange++
      } else if (!cloudFile.hash) {
        // Cloud has no checksum (legacy data) - upload to populate it
        console.log(`[SyncEngine] Cloud missing checksum for ${path}, will upload to populate`)
        const operation: SyncOperation = {
          type: "upload",
          path,
          localEntry: localFile,
          cloudEntry: cloudFile,
          reason: "Cloud checksum missing - uploading to populate",
        }
        plan.uploads.push(operation)
      } else {
        // Files differ - log the mismatch for debugging
        console.log(`[SyncEngine] Hash mismatch for ${path}:`)
        console.log(`  Local:  ${localFile.hash} (mtime: ${new Date(localFile.mtime).toISOString()})`)
        console.log(`  Cloud:  ${cloudFile.hash} (uploaded: ${new Date(cloudFile.uploadedAt).toISOString()})`)

        // Files differ - determine which to use
        const operation = resolveFileDifference(
          path,
          localFile,
          cloudFile,
          lastSyncTime
        )
        addOperation(plan, operation)
      }
    } else if (localFile && !cloudFile) {
      // Only exists locally
      const operation = resolveLocalOnly(path, localFile, lastSyncTime, cloudPathsAtLastSync)
      addOperation(plan, operation)
    } else if (!localFile && cloudFile) {
      // Only exists in cloud
      const operation = resolveCloudOnly(path, cloudFile, lastSyncTime, cloudPathsAtLastSync)
      addOperation(plan, operation)
    }
  }

  return plan
}

/**
 * Resolve what to do when both local and cloud have the file but with different content.
 */
function resolveFileDifference(
  path: string,
  localFile: LocalFileEntry,
  cloudFile: CloudFileEntry,
  lastSyncTime?: number
): SyncOperation {
  if (lastSyncTime) {
    // We have sync history - can make smarter decisions
    const localModifiedSinceSync = localFile.mtime > lastSyncTime
    const cloudModifiedSinceSync = cloudFile.uploadedAt > lastSyncTime

    if (localModifiedSinceSync && cloudModifiedSinceSync) {
      // Both modified since last sync - conflict
      return {
        type: "conflict",
        path,
        localEntry: localFile,
        cloudEntry: cloudFile,
        reason: "Both local and cloud modified since last sync",
      }
    } else if (localModifiedSinceSync) {
      // Only local modified - upload
      return {
        type: "upload",
        path,
        localEntry: localFile,
        cloudEntry: cloudFile,
        reason: "Local file modified since last sync",
      }
    } else {
      // Cloud modified (or neither, but cloud is authoritative)
      return {
        type: "download",
        path,
        localEntry: localFile,
        cloudEntry: cloudFile,
        reason: "Cloud file modified since last sync",
      }
    }
  }

  // No sync history - use modification times
  const localNewer = localFile.mtime > cloudFile.uploadedAt

  if (localNewer) {
    return {
      type: "upload",
      path,
      localEntry: localFile,
      cloudEntry: cloudFile,
      reason: "Local file is newer",
    }
  } else {
    return {
      type: "download",
      path,
      localEntry: localFile,
      cloudEntry: cloudFile,
      reason: "Cloud file is newer",
    }
  }
}

/**
 * Resolve what to do when file only exists locally.
 */
function resolveLocalOnly(
  path: string,
  localFile: LocalFileEntry,
  lastSyncTime?: number,
  cloudPathsAtLastSync?: ReadonlySet<string>
): SyncOperation {
  if (lastSyncTime && cloudPathsAtLastSync?.has(path)) {
    if (localFile.mtime < lastSyncTime) {
      // File existed before last sync but now missing from cloud
      // This means it was deleted from cloud - delete locally too
      return {
        type: "delete-local",
        path,
        localEntry: localFile,
        reason: "Deleted from cloud since last sync",
      }
    }

    // Cloud deleted the file, but local was modified after last sync.
    // Treat as a conflict (delete vs modify).
    return {
      type: "conflict",
      path,
      localEntry: localFile,
      reason: "Deleted from cloud, but modified locally since last sync",
    }
  }

  // New local file - upload to cloud
  return {
    type: "upload",
    path,
    localEntry: localFile,
    reason: "New local file",
  }
}

/**
 * Resolve what to do when a file only exists in the cloud.
 */
function resolveCloudOnly(
  path: string,
  cloudFile: CloudFileEntry,
  lastSyncTime?: number,
  cloudPathsAtLastSync?: ReadonlySet<string>
): SyncOperation {
  if (lastSyncTime && cloudPathsAtLastSync?.has(path)) {
    if (cloudFile.uploadedAt < lastSyncTime) {
      // File existed at last sync, but now missing locally.
      // This means it was deleted locally - delete from cloud too.
      return {
        type: "delete-cloud",
        path,
        cloudEntry: cloudFile,
        reason: "Deleted locally since last sync",
      }
    }

    // Local deleted the file, but cloud was modified after last sync.
    // Treat as a conflict (delete vs modify).
    return {
      type: "conflict",
      path,
      cloudEntry: cloudFile,
      reason: "Deleted locally, but modified in cloud since last sync",
    }
  }

  // New cloud file - download
  return {
    type: "download",
    path,
    cloudEntry: cloudFile,
    reason: "Missing locally",
  }
}

/**
 * Add operation to the appropriate plan array.
 */
function addOperation(plan: SyncPlan, operation: SyncOperation): void {
  switch (operation.type) {
    case "download":
      plan.downloads.push(operation)
      break
    case "upload":
      plan.uploads.push(operation)
      break
    case "delete-local":
      plan.localDeletes.push(operation)
      break
    case "delete-cloud":
      plan.cloudDeletes.push(operation)
      break
    case "conflict":
      plan.conflicts.push(operation)
      break
  }
}

/**
 * Create an empty sync plan.
 */
export function createEmptySyncPlan(): SyncPlan {
  return {
    downloads: [],
    uploads: [],
    localDeletes: [],
    cloudDeletes: [],
    conflicts: [],
    autoMerged: [],
    noChange: 0,
  }
}

/**
 * Check if a sync plan has any operations to perform.
 */
export function hasSyncOperations(plan: SyncPlan): boolean {
  return (
    plan.downloads.length > 0 ||
    plan.uploads.length > 0 ||
    plan.localDeletes.length > 0 ||
    plan.cloudDeletes.length > 0 ||
    plan.conflicts.length > 0 ||
    (plan.autoMerged?.length ?? 0) > 0
  )
}

/**
 * Compute a sync plan with 3-way merge support.
 *
 * This enhanced version attempts to auto-merge files when both local
 * and cloud have been modified since the last sync, using Git-like
 * 3-way merge with the checkpoint as the common ancestor.
 */
export async function computeSyncPlanWithMerge(
  local: LocalFileEntry[],
  cloud: CloudFileEntry[],
  lastSyncTime: number | undefined,
  cloudPathsAtLastSync: ReadonlySet<string> | undefined,
  mergeOptions: MergeOptions
): Promise<SyncPlan> {
  // Start with standard plan computation
  const plan = computeSyncPlan(local, cloud, lastSyncTime, cloudPathsAtLastSync)

  // Try to auto-merge conflicts where possible
  const remainingConflicts: SyncOperation[] = []
  const fastPathDownloads: SyncOperation[] = []
  const fastPathUploads: SyncOperation[] = []

  const checkpointMap =
    mergeOptions.checkpointMap ??
    (await syncCheckpointStore.getCheckpointMap(mergeOptions.projectId))

  const maxMergeBytes = mergeOptions.maxMergeBytes ?? 2 * 1024 * 1024
  const defaultConcurrency = (() => {
    if (mergeOptions.concurrency) return mergeOptions.concurrency
    const cores =
      typeof navigator !== "undefined" && navigator.hardwareConcurrency
        ? navigator.hardwareConcurrency
        : 4
    return Math.min(8, Math.max(2, cores))
  })()

  const mergeCandidates: SyncOperation[] = []

  for (const conflict of plan.conflicts) {
    // Skip delete-vs-modify conflicts - can't merge those
    if (!conflict.localEntry || !conflict.cloudEntry) {
      remainingConflicts.push(conflict)
      continue
    }

    // Skip binary files
    if (isBinaryPath(conflict.path)) {
      console.log(`[SyncEngine] Cannot merge binary file: ${conflict.path}`)
      remainingConflicts.push(conflict)
      continue
    }

    // Skip very large files
    if (
      conflict.localEntry.size > maxMergeBytes ||
      conflict.cloudEntry.size > maxMergeBytes
    ) {
      remainingConflicts.push(conflict)
      continue
    }

    const checkpoint = checkpointMap?.[conflict.path]
    if (checkpoint) {
      if (conflict.localEntry.hash === checkpoint.hash && conflict.cloudEntry.hash !== checkpoint.hash) {
        fastPathDownloads.push({
          type: "download",
          path: conflict.path,
          localEntry: conflict.localEntry,
          cloudEntry: conflict.cloudEntry,
          reason: "Local matches checkpoint; cloud changed",
        })
        continue
      }

      if (conflict.cloudEntry.hash === checkpoint.hash && conflict.localEntry.hash !== checkpoint.hash) {
        fastPathUploads.push({
          type: "upload",
          path: conflict.path,
          localEntry: conflict.localEntry,
          cloudEntry: conflict.cloudEntry,
          reason: "Cloud matches checkpoint; local changed",
        })
        continue
      }
    }

    mergeCandidates.push(conflict)
  }

  const mergeResults = await mapWithConcurrency(
    mergeCandidates,
    defaultConcurrency,
    async (conflict) =>
      attemptThreeWayMerge(
        conflict.path,
        conflict.localEntry!,
        conflict.cloudEntry!,
        mergeOptions,
        checkpointMap?.[conflict.path]
      )
  )

  mergeResults.forEach((result, index) => {
    if (result) {
      plan.autoMerged.push(result)
    } else {
      remainingConflicts.push(mergeCandidates[index])
    }
  })

  if (fastPathDownloads.length > 0) {
    plan.downloads.push(...fastPathDownloads)
  }

  if (fastPathUploads.length > 0) {
    plan.uploads.push(...fastPathUploads)
  }

  // Replace conflicts with remaining (non-mergeable) conflicts
  plan.conflicts = remainingConflicts

  return plan
}

/**
 * Attempt 3-way merge for a conflicting file.
 */
async function attemptThreeWayMerge(
  path: string,
  localFile: LocalFileEntry,
  cloudFile: CloudFileEntry,
  options: MergeOptions,
  checkpointOverride?: { content: string; hash: string; syncedAt: number }
): Promise<SyncOperation | null> {
  try {
    // Get checkpoint (base content) for this file
    const checkpoint =
      checkpointOverride ??
      (await syncCheckpointStore.getFileCheckpoint(options.projectId, path))

    if (!checkpoint) {
      console.log(`[SyncEngine] No checkpoint for ${path}, cannot 3-way merge`)
      return null
    }

    // Fetch current contents
    const [localContent, cloudContent] = await Promise.all([
      options.readLocalFile(path),
      options.fetchCloudFile(cloudFile.storageId as unknown as string),
    ])

    if (localContent === null) {
      console.log(`[SyncEngine] Could not read local file: ${path}`)
      return null
    }

    if (cloudContent === null) {
      console.log(`[SyncEngine] Could not fetch cloud file: ${path}`)
      return null
    }

    // Attempt 3-way merge
    const result = threeWayMerge.merge(checkpoint.content, localContent, cloudContent)

    if (result.success) {
      console.log(
        `[SyncEngine] Auto-merged ${path}: ${result.stats.localChanges} local + ${result.stats.cloudChanges} cloud changes`
      )

      return {
        type: "auto-merged",
        path,
        localEntry: localFile,
        cloudEntry: cloudFile,
        reason: `Auto-merged: ${result.stats.localChanges} local + ${result.stats.cloudChanges} cloud changes`,
        mergeDetails: {
          localChanges: result.stats.localChanges,
          cloudChanges: result.stats.cloudChanges,
          mergedContent: result.merged,
        },
      }
    }

    console.log(`[SyncEngine] Cannot auto-merge ${path}: ${result.stats.conflictCount} conflicts`)
    return null
  } catch (err) {
    console.warn(`[SyncEngine] Error during 3-way merge for ${path}:`, err)
    return null
  }
}
