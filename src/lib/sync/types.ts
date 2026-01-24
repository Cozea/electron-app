import type { Id } from "../../../convex/_generated/dataModel"

// Local file entry from Electron IPC
export interface LocalFileEntry {
  path: string
  hash: string
  size: number
  mtime: number
}

// Cloud file entry from Convex
export interface CloudFileEntry {
  _id: Id<"projectFiles">
  path: string
  hash: string
  size: number
  version: number
  storageId: Id<"_storage">
  uploadedAt: number
}

// Sync operation types
export type SyncOperationType =
  | "download"
  | "upload"
  | "delete-local"
  | "delete-cloud"
  | "conflict"

export interface SyncOperation {
  type: SyncOperationType
  path: string
  localEntry?: LocalFileEntry
  cloudEntry?: CloudFileEntry
  reason: string
}

// Sync plan - computed from comparing local and cloud manifests
export interface SyncPlan {
  downloads: SyncOperation[] // Files to download from cloud
  uploads: SyncOperation[] // Files to upload to cloud
  localDeletes: SyncOperation[] // Files to delete locally
  cloudDeletes: SyncOperation[] // Files to delete from cloud
  conflicts: SyncOperation[] // Files with conflicts requiring resolution
  noChange: number // Count of files already in sync
}

// Sync status for UI
export type SyncStatus =
  | "idle"
  | "checking"
  | "planning"
  | "syncing"
  | "complete"
  | "error"

// Progress tracking for UI
export interface SyncProgress {
  status: SyncStatus
  message: string
  current: number
  total: number
  logs: string[]
}

// Plan summary for display
export interface SyncPlanSummary {
  totalChanges: number
  downloads: number
  uploads: number
  deletes: number
  conflicts: number
  noChange: number
}

export function getSyncPlanSummary(plan: SyncPlan): SyncPlanSummary {
  const downloads = plan.downloads.length
  const uploads = plan.uploads.length
  const deletes = plan.localDeletes.length + plan.cloudDeletes.length
  const conflicts = plan.conflicts.length

  return {
    totalChanges: downloads + uploads + deletes + conflicts,
    downloads,
    uploads,
    deletes,
    conflicts,
    noChange: plan.noChange,
  }
}
