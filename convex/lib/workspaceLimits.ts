// @ts-nocheck
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type StorageCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">
type StorageMutationCtx = Pick<MutationCtx, "db">

const STORAGE_SCAN_PAGE_SIZE = 128
const STORAGE_BREAKDOWN_KEYS: Array<keyof StorageBreakdown> = [
  "sourceAndConfig",
  "collaborationData",
  "aiHistory",
  "buildCache",
  "snapshots",
  "gitHistory",
  "databaseBackups",
  "assets",
]

export interface StorageBreakdown {
  sourceAndConfig: number
  collaborationData: number
  aiHistory: number
  buildCache: number
  snapshots: number
  gitHistory: number
  databaseBackups: number
  assets: number
}

export interface LegacyFileStorageTotals {
  activeBytes: number
  supersededBytes: number
}

export interface ProjectStorageAccountingState {
  repoBytes: number
  usesGitRepoAccounting: boolean
}

interface PaginatedResult<T> {
  page: T[]
  isDone: boolean
  continueCursor: string
}

async function forEachPaginated<T>(
  fetchPage: (cursor: string | null) => Promise<PaginatedResult<T>>,
  handler: (item: T) => void
): Promise<void> {
  let cursor: string | null = null

  while (true) {
    const result = await fetchPage(cursor)
    for (const item of result.page) {
      handler(item)
    }
    if (result.isDone) {
      break
    }
    cursor = result.continueCursor
  }
}

function normalizeBreakdown(source: Partial<StorageBreakdown>): StorageBreakdown {
  const normalized = emptyBreakdown()
  for (const key of STORAGE_BREAKDOWN_KEYS) {
    normalized[key] = Math.max(0, source[key] ?? 0)
  }
  return normalized
}

export function calculateStorageTotal(breakdown: StorageBreakdown): number {
  return STORAGE_BREAKDOWN_KEYS.reduce((sum, key) => sum + Math.max(0, breakdown[key]), 0)
}

export function emptyBreakdown(): StorageBreakdown {
  return {
    sourceAndConfig: 0,
    collaborationData: 0,
    aiHistory: 0,
    buildCache: 0,
    snapshots: 0,
    gitHistory: 0,
    databaseBackups: 0,
    assets: 0,
  }
}

export async function getLegacyFileStorageTotals(
  ctx: StorageCtx,
  projectId: Id<"projects">
): Promise<LegacyFileStorageTotals> {
  let activeBytes = 0
  let supersededBytes = 0

  await forEachPaginated(
    (cursor) =>
      ctx.db
        .query("projectFiles")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .paginate({
          cursor,
          numItems: STORAGE_SCAN_PAGE_SIZE,
        }) as Promise<PaginatedResult<{ sizeBytes: number; status: string }>>,
    (file) => {
      const sizeBytes = Math.max(0, file.sizeBytes)
      if (file.status === "active") {
        activeBytes += sizeBytes
      } else if (file.status === "superseded") {
        supersededBytes += sizeBytes
      }
    }
  )

  return {
    activeBytes,
    supersededBytes,
  }
}

export async function getProjectStorageAccountingState(
  ctx: StorageCtx,
  projectId: Id<"projects">
): Promise<ProjectStorageAccountingState> {
  const project = await ctx.db.get(projectId)
  const syncState = await ctx.db
    .query("projectSyncState")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first()
  const repoBytes = Math.max(
    0,
    syncState?.gitSyncState?.repoBytes ?? project?.gitSyncState?.repoBytes ?? 0,
  )

  return {
    repoBytes,
    usesGitRepoAccounting: repoBytes > 0,
  }
}

async function getProjectStorageUsageDoc(
  ctx: StorageCtx,
  projectId: Id<"projects">
): Promise<Doc<"projectStorageUsage"> | null> {
  return await ctx.db
    .query("projectStorageUsage")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .first()
}

async function writeProjectStorageUsageDoc(
  ctx: StorageMutationCtx,
  projectId: Id<"projects">,
  breakdown: Partial<StorageBreakdown>
): Promise<StorageBreakdown> {
  const existing = await getProjectStorageUsageDoc(ctx, projectId)
  const normalized = normalizeBreakdown(breakdown)
  const now = Date.now()
  const payload = {
    projectId,
    totalBytes: calculateStorageTotal(normalized),
    lastCalculatedAt: now,
    breakdown: normalized,
    updatedAt: now,
  }

  if (existing) {
    await ctx.db.patch(existing._id, payload)
    return normalized
  }

  await ctx.db.insert("projectStorageUsage", {
    ...payload,
    createdAt: now,
  })
  return normalized
}

export async function ensureProjectStorageUsage(
  ctx: StorageMutationCtx,
  projectId: Id<"projects">
): Promise<StorageBreakdown> {
  const existing = await getProjectStorageUsageDoc(ctx, projectId)
  if (existing) {
    return existing.breakdown
  }

  return await writeProjectStorageUsageDoc(ctx, projectId, emptyBreakdown())
}

export async function applyProjectStorageDeltas(
  ctx: StorageMutationCtx,
  projectId: Id<"projects">,
  deltas: Partial<StorageBreakdown>
): Promise<StorageBreakdown | null> {
  const project = await ctx.db.get(projectId)
  if (!project) {
    return null
  }

  const hasAnyDelta = STORAGE_BREAKDOWN_KEYS.some((key) => (deltas[key] ?? 0) !== 0)
  const existing = await getProjectStorageUsageDoc(ctx, projectId)

  if (!existing) {
    const currentBreakdown = emptyBreakdown()
    await writeProjectStorageUsageDoc(ctx, projectId, currentBreakdown)
    return hasAnyDelta ? await applyProjectStorageDeltas(ctx, projectId, deltas) : currentBreakdown
  }

  if (!hasAnyDelta) {
    return existing.breakdown
  }

  const next = emptyBreakdown()
  for (const key of STORAGE_BREAKDOWN_KEYS) {
    next[key] = Math.max(0, existing.breakdown[key] + (deltas[key] ?? 0))
  }

  await writeProjectStorageUsageDoc(ctx, projectId, next)
  return next
}

export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  if (bytes < 0) return "Unlimited"

  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}
