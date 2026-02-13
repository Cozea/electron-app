import type { QueryCtx } from "../_generated/server"
import type { Id } from "../_generated/dataModel"

// ============================================
// PROJECT LIMITS
// ============================================

/**
 * Get the project limit for a given plan
 * Returns -1 for unlimited (enterprise plan)
 */
export function getPlanProjectLimit(plan: string): number {
  switch (plan) {
    case "free":
      return 5
    case "pro":
      return 10
    case "max":
      return 20
    case "team":
      return 20
    case "enterprise":
      return -1 // Unlimited
    default:
      return 5
  }
}

export interface ProjectLimitStatus {
  allowed: boolean
  current: number
  limit: number
  overLimit: boolean
  isUnlimited: boolean
  message?: string
}

/**
 * Check if an organization can create more projects based on their subscription
 */
export async function checkProjectLimit(
  ctx: QueryCtx,
  orgId: Id<"organizations">
): Promise<ProjectLimitStatus> {
  const org = await ctx.db.get(orgId)
  if (!org) {
    return {
      allowed: false,
      current: 0,
      limit: 0,
      overLimit: false,
      isUnlimited: false,
      message: "Organization not found",
    }
  }

  const plan = org.subscription.plan
  const limit = getPlanProjectLimit(plan)

  // Count non-deleted projects
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
    .collect()
  const activeProjects = projects.filter((p) => p.status !== "deleted")
  const current = activeProjects.length

  // Enterprise has unlimited projects
  if (limit === -1) {
    return {
      allowed: true,
      current,
      limit: -1,
      overLimit: false,
      isUnlimited: true,
    }
  }

  const overLimit = current > limit

  return {
    allowed: current < limit,
    current,
    limit,
    overLimit,
    isUnlimited: false,
    message: overLimit
      ? `Over limit (${current}/${limit}). Delete projects or upgrade to create more.`
      : current >= limit
        ? `Project limit reached (${current}/${limit}). Upgrade your plan to create more.`
        : undefined,
  }
}

// ============================================
// STORAGE LIMITS
// ============================================

/**
 * Get the storage limit for a given plan (in bytes)
 * Returns -1 for unlimited (enterprise plan)
 */
export function getPlanStorageLimit(plan: string): number {
  switch (plan) {
    case "free":
      return 1 * 1024 * 1024 * 1024 // 1 GB
    case "pro":
      return 10 * 1024 * 1024 * 1024 // 10 GB
    case "max":
      return 20 * 1024 * 1024 * 1024 // 20 GB
    case "team":
      return 30 * 1024 * 1024 * 1024 // 30 GB
    case "enterprise":
      return -1 // Unlimited
    default:
      return 1 * 1024 * 1024 * 1024 // 1 GB
  }
}

/**
 * Get the storage limit for a given plan (in GB for display)
 * Returns -1 for unlimited
 */
export function getPlanStorageLimitGB(plan: string): number {
  switch (plan) {
    case "free":
      return 1
    case "pro":
      return 10
    case "max":
      return 20
    case "team":
      return 30
    case "enterprise":
      return -1 // Unlimited
    default:
      return 1
  }
}

export interface StorageBreakdown {
  sourceAndConfig: number // replica bundle + replica LFS (fallback: projectFiles active)
  collaborationData: number // yjsUpdates
  aiHistory: number // aiConversations
  buildCache: number // builderRuns logs
  snapshots: number // yjsDocuments
  gitHistory: number // legacy projectFiles (superseded)
  databaseBackups: number // reserved
  assets: number // projectAssets
}

export interface StorageUsageStatus {
  allowed: boolean
  currentBytes: number
  limitBytes: number
  overLimit: boolean
  isUnlimited: boolean
  usagePercent: number
  breakdown: StorageBreakdown
  message?: string
}

/**
 * Create an empty storage breakdown
 */
function emptyBreakdown(): StorageBreakdown {
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

/**
 * Estimate storage breakdown by querying tables directly
 * This is expensive - use cached values from org.storageUsage when possible
 */
export async function estimateStorageBreakdown(
  ctx: QueryCtx,
  orgId: Id<"organizations">
): Promise<StorageBreakdown> {
  const breakdown = emptyBreakdown()

  // Get all projects for this org
  const projects = await ctx.db
    .query("projects")
    .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
    .collect()

  const projectIds = projects.map((p) => p._id)

  for (const projectId of projectIds) {
    const replica = await ctx.db
      .query("projectReplicaGit")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first()

    const lfsObjects = await ctx.db
      .query("projectReplicaLfsObjects")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()

    const lfsBytes = lfsObjects.reduce((sum, entry) => sum + Math.max(0, entry.size), 0)
    const replicaBundleBytes = Math.max(0, replica?.bundleSizeBytes ?? 0)
    const useReplicaAccounting = replicaBundleBytes > 0 || lfsBytes > 0

    if (useReplicaAccounting) {
      breakdown.sourceAndConfig += replicaBundleBytes + lfsBytes
    } else {
      // Fallback for projects that have not written replica bundle size yet.
      const activeFiles = await ctx.db
        .query("projectFiles")
        .withIndex("by_project_and_status", (q) =>
          q.eq("projectId", projectId).eq("status", "active")
        )
        .collect()
      breakdown.sourceAndConfig += activeFiles.reduce((sum, f) => sum + f.sizeBytes, 0)

      const supersededFiles = await ctx.db
        .query("projectFiles")
        .withIndex("by_project_and_status", (q) =>
          q.eq("projectId", projectId).eq("status", "superseded")
        )
        .collect()
      breakdown.gitHistory += supersededFiles.reduce((sum, f) => sum + f.sizeBytes, 0)
    }

    // Assets: sum of projectAssets.size
    const assets = await ctx.db
      .query("projectAssets")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
    breakdown.assets += assets.reduce((sum, a) => sum + a.size, 0)

    // Collaboration Data: yjsUpdates
    const updates = await ctx.db
      .query("yjsUpdates")
      .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
      .collect()
    breakdown.collaborationData += updates.reduce(
      (sum, u) => sum + (u.update?.byteLength ?? 0),
      0
    )

    // Snapshots: yjsDocuments
    const snapshots = await ctx.db
      .query("yjsDocuments")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .collect()
    breakdown.snapshots += snapshots.reduce(
      (sum, s) => sum + (s.snapshot?.byteLength ?? 0),
      0
    )

    // AI History: query conversations for this project
    // Use filter since there's no by_project-only index
    const conversations = await ctx.db
      .query("aiConversations")
      .filter((q) => q.eq(q.field("projectId"), projectId))
      .collect()
    // Estimate ~5KB average per conversation
    breakdown.aiHistory += conversations.length * 5 * 1024
  }

  return breakdown
}

/**
 * Check storage usage for organization
 * Returns cached breakdown if available, otherwise returns zeros
 * The cron job will populate the cache periodically
 */
export async function checkStorageUsage(
  ctx: QueryCtx,
  orgId: Id<"organizations">
): Promise<StorageUsageStatus> {
  const org = await ctx.db.get(orgId)
  if (!org) {
    return {
      allowed: false,
      currentBytes: 0,
      limitBytes: 0,
      overLimit: false,
      isUnlimited: false,
      usagePercent: 0,
      breakdown: emptyBreakdown(),
      message: "Organization not found",
    }
  }

  const plan = org.subscription.plan
  const limitBytes = getPlanStorageLimit(plan)

  // Use cached breakdown if available, otherwise return zeros
  // The cron job will populate this data
  const cachedUsage = org.storageUsage
  const breakdown = cachedUsage?.breakdown ?? emptyBreakdown()
  const currentBytes = cachedUsage?.totalBytes ?? 0

  // Enterprise has unlimited storage
  if (limitBytes === -1) {
    return {
      allowed: true,
      currentBytes,
      limitBytes: -1,
      overLimit: false,
      isUnlimited: true,
      usagePercent: 0,
      breakdown,
    }
  }

  const overLimit = currentBytes > limitBytes
  const usagePercent = limitBytes > 0 ? Math.min(100, (currentBytes / limitBytes) * 100) : 0

  return {
    allowed: currentBytes < limitBytes,
    currentBytes,
    limitBytes,
    overLimit,
    isUnlimited: false,
    usagePercent,
    breakdown,
    message: overLimit
      ? `Storage over limit. Clear data or upgrade your plan.`
      : usagePercent >= 90
        ? `Storage almost full (${usagePercent.toFixed(0)}%). Consider upgrading.`
        : undefined,
  }
}

// ============================================
// FORMATTING HELPERS
// ============================================

/**
 * Format bytes to human readable string
 */
export function formatBytes(bytes: number): string {
  if (bytes === 0) return "0 B"
  if (bytes < 0) return "Unlimited"

  const k = 1024
  const sizes = ["B", "KB", "MB", "GB", "TB"]
  const i = Math.floor(Math.log(bytes) / Math.log(k))

  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + " " + sizes[i]
}

/**
 * Format GB to human readable string
 */
export function formatGB(gb: number): string {
  if (gb < 0) return "Unlimited"
  if (gb >= 1) return `${gb.toFixed(1)} GB`
  return `${Math.round(gb * 1024)} MB`
}
