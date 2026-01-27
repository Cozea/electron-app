import type { LocalFileEntry, CloudFileEntry, SyncPlan, SyncOperation } from "./types"

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
  lastSyncTime?: number
): SyncPlan {
  const plan: SyncPlan = {
    downloads: [],
    uploads: [],
    localDeletes: [],
    cloudDeletes: [],
    conflicts: [],
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
      const operation = resolveLocalOnly(path, localFile, lastSyncTime)
      addOperation(plan, operation)
    } else if (!localFile && cloudFile) {
      // Only exists in cloud
      const operation: SyncOperation = {
        type: "download",
        path,
        cloudEntry: cloudFile,
        reason: "Missing locally",
      }
      plan.downloads.push(operation)
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
  lastSyncTime?: number
): SyncOperation {
  if (lastSyncTime && localFile.mtime < lastSyncTime) {
    // File existed before last sync but now missing from cloud
    // This means it was deleted from cloud - delete locally too
    return {
      type: "delete-local",
      path,
      localEntry: localFile,
      reason: "Deleted from cloud since last sync",
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
    plan.conflicts.length > 0
  )
}
