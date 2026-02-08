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
  | "auto-merged"

/**
 * Details about an auto-merged file.
 */
export interface MergeDetails {
  /** Number of changes from local version */
  localChanges: number
  /** Number of changes from cloud version */
  cloudChanges: number
  /** The merged content to write */
  mergedContent: string
  /** Merge engine used */
  engine?: "git-merge-file"
  /** Base hash used for merge */
  baseHash?: string
  /** Local hash used for merge */
  localHash?: string
  /** Cloud hash used for merge */
  cloudHash?: string
  /** Whether merged output came from cache */
  cacheHit?: boolean
  /** Number of conflicting regions found by merge engine */
  conflictCount?: number
  /** Git runtime version used for merge */
  gitVersion?: string
}

export interface SyncOperation {
  type: SyncOperationType
  path: string
  localEntry?: LocalFileEntry
  cloudEntry?: CloudFileEntry
  reason: string
  /** Merge details for auto-merged files */
  mergeDetails?: MergeDetails
}

export type SyncOpSource = "monaco" | "agent" | "watcher" | "remote"
export type SyncActorType = "user" | "agent" | "system"
export type SyncOpKind = "upsert" | "delete" | "rename" | "chmod" | "yjs_update"

export interface SyncOp {
  opId: string
  idempotencyKey: string
  projectId: Id<"projects">
  actorId: string
  actorType: SyncActorType
  source: SyncOpSource
  kind: SyncOpKind
  path: string
  baseHash?: string
  newHash?: string
  isBinary: boolean
  size: number
  timestamp: number
}

export interface ReplicaState {
  projectId: Id<"projects">
  replicaHead: number
  pendingOps: number
  lastAckedAt: number | null
  ackedOps: number
  pathHeads: Record<string, string>
  lastStateVector: number
  lastPersistedAt: number | null
}

// Sync plan - computed from comparing local and cloud manifests
export interface SyncPlan {
  downloads: SyncOperation[] // Files to download from cloud
  uploads: SyncOperation[] // Files to upload to cloud
  localDeletes: SyncOperation[] // Files to delete locally
  cloudDeletes: SyncOperation[] // Files to delete from cloud
  conflicts: SyncOperation[] // Files with conflicts requiring resolution
  autoMerged: SyncOperation[] // Files that were auto-merged (3-way merge)
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
  autoMerged: number
  noChange: number
}

export function getSyncPlanSummary(plan: SyncPlan): SyncPlanSummary {
  const downloads = plan.downloads.length
  const uploads = plan.uploads.length
  const deletes = plan.localDeletes.length + plan.cloudDeletes.length
  const conflicts = plan.conflicts.length
  const autoMerged = plan.autoMerged?.length ?? 0

  return {
    totalChanges: downloads + uploads + deletes + conflicts + autoMerged,
    downloads,
    uploads,
    deletes,
    conflicts,
    autoMerged,
    noChange: plan.noChange,
  }
}
