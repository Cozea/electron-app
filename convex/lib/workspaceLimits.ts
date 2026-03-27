// @ts-nocheck
import type { MutationCtx, QueryCtx } from "../_generated/server"
import type { Doc, Id } from "../_generated/dataModel"
import { internal } from "../_generated/api"
import { resolveOrganizationBillingSnapshot } from "./accountEntitlements"

type StorageCtx = Pick<QueryCtx, "db"> | Pick<MutationCtx, "db">
type StorageMutationCtx = Pick<MutationCtx, "db" | "scheduler">

const textEncoder = new TextEncoder()
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
      // Free is local-first and intentionally constrained on shared infra.
      return 1
    case "pro":
      // Pro
      return 5
    case "max":
      // Max
      return 20
    case "startup":
      // Startup centralized billing - limits are not enforced yet.
      return -1
    case "team":
      // Legacy alias for Startup.
      return -1
    case "enterprise":
      // Enterprise
      return -1
    default:
      return 1
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
  ctx: StorageCtx,
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

  const billingSnapshot = await resolveOrganizationBillingSnapshot(ctx, {
    organization: org,
  })
  const plan = billingSnapshot.plan
  const limit = getPlanProjectLimit(plan)

  const [draftProjects, generatingProjects, buildingProjects, activeProjects, archivedProjects] =
    await Promise.all([
      ctx.db
        .query("projects")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", orgId).eq("status", "draft")
        )
        .collect(),
      ctx.db
        .query("projects")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", orgId).eq("status", "generating")
        )
        .collect(),
      ctx.db
        .query("projects")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", orgId).eq("status", "building")
        )
        .collect(),
      ctx.db
        .query("projects")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", orgId).eq("status", "active")
        )
        .collect(),
      ctx.db
        .query("projects")
        .withIndex("by_organization_and_status", (q) =>
          q.eq("organizationId", orgId).eq("status", "archived")
        )
        .collect(),
    ])
  const current =
    draftProjects.length +
    generatingProjects.length +
    buildingProjects.length +
    activeProjects.length +
    archivedProjects.length

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
      // Free keeps cloud infra optional/minimal.
      return 1 * 1024 * 1024 * 1024 // 1 GB
    case "pro":
      // Pro
      return 5 * 1024 * 1024 * 1024 // 5 GB
    case "max":
      // Max
      return 30 * 1024 * 1024 * 1024 // 30 GB
    case "startup":
      // Startup centralized billing - limits are not enforced yet.
      return -1
    case "team":
      // Legacy alias for Startup.
      return -1
    case "enterprise":
      // Enterprise
      return -1
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
      return 5
    case "max":
      return 30
    case "startup":
      return -1
    case "team":
      return -1
    case "enterprise":
      return -1 // Unlimited
    default:
      return 1
  }
}

export interface StorageBreakdown {
  sourceAndConfig: number // replica bundle + replica LFS (fallback: projectFiles active)
  collaborationData: number // yjsUpdates
  aiHistory: number // DEPRECATED
  buildCache: number // builderRuns metadata/logs
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

export interface LegacyFileStorageTotals {
  activeBytes: number
  supersededBytes: number
}

export interface ReplicaStorageAccountingState {
  bundleBytes: number
  hasLfsObjects: boolean
  usesReplicaAccounting: boolean
}

function sizeOfSerialized(value: unknown): number {
  return textEncoder.encode(JSON.stringify(value ?? null)).byteLength
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

function addToBreakdown(target: StorageBreakdown, source: Partial<StorageBreakdown>): StorageBreakdown {
  for (const key of STORAGE_BREAKDOWN_KEYS) {
    target[key] += Math.max(0, source[key] ?? 0)
  }
  return target
}

function createBreakdownDelta(
  previous: StorageBreakdown,
  next: StorageBreakdown
): Partial<StorageBreakdown> {
  const delta: Partial<StorageBreakdown> = {}
  for (const key of STORAGE_BREAKDOWN_KEYS) {
    const change = next[key] - previous[key]
    if (change !== 0) {
      delta[key] = change
    }
  }
  return delta
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

/**
 * Create an empty storage breakdown
 */
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

export function estimateAiConversationBytes(conversation: {
  title: string
  messages: unknown
}): number {
  return sizeOfSerialized({
    title: conversation.title,
    messages: conversation.messages,
  })
}

export function estimateBuilderRunBytes(run: {
  runId: string
  status: string
  attempt: number
  conversationId?: string
  localPath?: string
  tasks?: unknown
  progress?: number
  statusMessage?: string
  errorMessage?: string
  logs?: unknown
  createdAt: number
  updatedAt: number
  lastCheckpointAt?: number
}): number {
  return sizeOfSerialized({
    runId: run.runId,
    status: run.status,
    attempt: run.attempt,
    conversationId: run.conversationId,
    localPath: run.localPath,
    tasks: run.tasks,
    progress: run.progress,
    statusMessage: run.statusMessage,
    errorMessage: run.errorMessage,
    logs: run.logs,
    createdAt: run.createdAt,
    updatedAt: run.updatedAt,
    lastCheckpointAt: run.lastCheckpointAt,
  })
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

export async function getReplicaStorageAccountingState(
  ctx: StorageCtx,
  projectId: Id<"projects">
): Promise<ReplicaStorageAccountingState> {
  const [replica, firstLfsObject] = await Promise.all([
    ctx.db
      .query("projectReplicaGit")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first(),
    ctx.db
      .query("projectReplicaLfsObjects")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first(),
  ])

  const bundleBytes = Math.max(0, replica?.bundleSizeBytes ?? 0)
  const hasLfsObjects = Boolean(firstLfsObject)

  return {
    bundleBytes,
    hasLfsObjects,
    usesReplicaAccounting: bundleBytes > 0 || hasLfsObjects,
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
  orgId: Id<"organizations">,
  projectId: Id<"projects">,
  breakdown: Partial<StorageBreakdown>
): Promise<StorageBreakdown> {
  const existing = await getProjectStorageUsageDoc(ctx, projectId)
  const normalized = normalizeBreakdown(breakdown)
  const now = Date.now()
  const payload = {
    organizationId: orgId,
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
  orgId: Id<"organizations">,
  projectId: Id<"projects">
): Promise<StorageBreakdown> {
  const existing = await getProjectStorageUsageDoc(ctx, projectId)
  if (existing) {
    return existing.breakdown
  }

  return await writeProjectStorageUsageDoc(ctx, orgId, projectId, emptyBreakdown())
}

export async function rollupProjectStorageUsageBreakdown(
  ctx: StorageCtx,
  orgId: Id<"organizations">
): Promise<StorageBreakdown> {
  const rows = await ctx.db
    .query("projectStorageUsage")
    .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
    .collect()

  const breakdown = emptyBreakdown()
  for (const row of rows) {
    addToBreakdown(breakdown, row.breakdown)
  }

  return breakdown
}

export async function applyStorageDeltas(
  ctx: StorageMutationCtx,
  orgId: Id<"organizations">,
  deltas: Partial<StorageBreakdown>
): Promise<StorageBreakdown | null> {
  const org = await ctx.db.get(orgId)
  if (!org) {
    return null
  }

  const hasAnyDelta = STORAGE_BREAKDOWN_KEYS.some((key) => (deltas[key] ?? 0) !== 0)
  if (!hasAnyDelta) {
    return org.storageUsage?.breakdown ?? emptyBreakdown()
  }

  const base = org.storageUsage?.breakdown ?? (await rollupProjectStorageUsageBreakdown(ctx, orgId))
  const next = emptyBreakdown()

  for (const key of STORAGE_BREAKDOWN_KEYS) {
    next[key] = Math.max(0, base[key] + (deltas[key] ?? 0))
  }

  const now = Date.now()
  await ctx.db.patch(orgId, {
    storageUsage: {
      totalBytes: calculateStorageTotal(next),
      lastCalculatedAt: now,
      breakdown: next,
    },
    updatedAt: now,
  })

  return next
}

export async function applyProjectStorageDeltas(
  ctx: StorageMutationCtx,
  _orgId: Id<"organizations">,
  projectId: Id<"projects">,
  deltas: Partial<StorageBreakdown>
): Promise<StorageBreakdown | null> {
  const project = await ctx.db.get(projectId)
  if (!project) {
    return null
  }

  const resolvedOrgId = project.organizationId
  const hasAnyDelta = STORAGE_BREAKDOWN_KEYS.some((key) => (deltas[key] ?? 0) !== 0)
  const existing = await getProjectStorageUsageDoc(ctx, projectId)

  if (!existing) {
    const currentBreakdown = emptyBreakdown()
    console.warn("[StorageUsage] Missing projectStorageUsage row during hot-path update; seeding empty row and scheduling repair", {
      projectId: String(projectId),
      organizationId: String(resolvedOrgId),
    })
    await writeProjectStorageUsageDoc(ctx, resolvedOrgId, projectId, currentBreakdown)
    await ctx.scheduler.runAfter(0, internal.organizations.repairProjectStorageUsage, {
      projectId,
    })
    if (hasAnyDelta) {
      await applyStorageDeltas(ctx, resolvedOrgId, deltas)
    }
    return currentBreakdown
  }

  if (!hasAnyDelta) {
    return existing.breakdown
  }

  const next = emptyBreakdown()
  for (const key of STORAGE_BREAKDOWN_KEYS) {
    next[key] = Math.max(0, existing.breakdown[key] + (deltas[key] ?? 0))
  }

  await writeProjectStorageUsageDoc(ctx, resolvedOrgId, projectId, next)
  await applyStorageDeltas(ctx, resolvedOrgId, deltas)
  return next
}

export async function estimateProjectStorageBreakdown(
  ctx: StorageCtx,
  projectId: Id<"projects">
): Promise<StorageBreakdown> {
  const breakdown = emptyBreakdown()

  const project = await ctx.db.get(projectId)
  if (project?.status === "deleted") {
    return breakdown
  }

  if ((project?.syncMode ?? "replica") === "git") {
    breakdown.sourceAndConfig += Math.max(0, project?.gitSyncState?.repoBytes ?? 0)
  } else {
    const replica = await ctx.db
      .query("projectReplicaGit")
      .withIndex("by_project", (q) => q.eq("projectId", projectId))
      .first()

    let lfsBytes = 0
    await forEachPaginated(
      (cursor) =>
        ctx.db
          .query("projectReplicaLfsObjects")
          .withIndex("by_project", (q) => q.eq("projectId", projectId))
          .paginate({
            cursor,
            numItems: STORAGE_SCAN_PAGE_SIZE,
          }) as Promise<PaginatedResult<{ size: number }>>,
      (entry) => {
        lfsBytes += Math.max(0, entry.size)
      }
    )
    const replicaBundleBytes = Math.max(0, replica?.bundleSizeBytes ?? 0)
    const useReplicaAccounting = replicaBundleBytes > 0 || lfsBytes > 0

    if (useReplicaAccounting) {
      breakdown.sourceAndConfig += replicaBundleBytes + lfsBytes
    } else {
      const legacyTotals = await getLegacyFileStorageTotals(ctx, projectId)
      breakdown.sourceAndConfig += legacyTotals.activeBytes
      breakdown.gitHistory += legacyTotals.supersededBytes
    }
  }

  const seenAssetStorageIds = new Set<string>()
  await forEachPaginated(
    (cursor) =>
      ctx.db
        .query("projectAssets")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .paginate({
          cursor,
          numItems: STORAGE_SCAN_PAGE_SIZE,
        }) as Promise<PaginatedResult<{ _id: string; storageId?: string; size: number }>>,
    (asset) => {
      const dedupeKey = asset.storageId ? String(asset.storageId) : `record:${asset._id}`
      if (seenAssetStorageIds.has(dedupeKey)) {
        return
      }
      seenAssetStorageIds.add(dedupeKey)
      breakdown.assets += Math.max(0, asset.size)
    }
  )

  await forEachPaginated(
    (cursor) =>
      ctx.db
        .query("yjsUpdates")
        .withIndex("by_project_and_time", (q) => q.eq("projectId", projectId))
        .paginate({
          cursor,
          numItems: STORAGE_SCAN_PAGE_SIZE,
        }) as Promise<PaginatedResult<{ update?: ArrayBuffer }>>,
    (update) => {
      breakdown.collaborationData += update.update?.byteLength ?? 0
    }
  )

  await forEachPaginated(
    (cursor) =>
      ctx.db
        .query("yjsDocuments")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .paginate({
          cursor,
          numItems: STORAGE_SCAN_PAGE_SIZE,
        }) as Promise<PaginatedResult<{ byteSize?: number; snapshot?: ArrayBuffer }>>,
    (snapshot) => {
      breakdown.snapshots += Math.max(0, snapshot.byteSize ?? snapshot.snapshot?.byteLength ?? 0)
    }
  )

  await forEachPaginated(
    (cursor) =>
      ctx.db
        .query("builderRuns")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .paginate({
          cursor,
          numItems: STORAGE_SCAN_PAGE_SIZE,
        }) as Promise<
          PaginatedResult<{
            runId: string
            status: string
            attempt: number
            conversationId?: string
            localPath?: string
            tasks?: unknown
            progress?: number
            statusMessage?: string
            errorMessage?: string
            logs?: unknown
            createdAt: number
            updatedAt: number
            lastCheckpointAt?: number
          }>
        >,
    (run) => {
      breakdown.buildCache += estimateBuilderRunBytes(run)
    }
  )

  await forEachPaginated(
    (cursor) =>
      ctx.db
        .query("aiConversations")
        .withIndex("by_project", (q) => q.eq("projectId", projectId))
        .paginate({
          cursor,
          numItems: STORAGE_SCAN_PAGE_SIZE,
        }) as Promise<PaginatedResult<{ title: string; messages: unknown }>>,
    (conversation) => {
      breakdown.aiHistory += estimateAiConversationBytes({
        title: conversation.title,
        messages: conversation.messages,
      })
    }
  )

  return breakdown
}

export async function syncProjectStorageUsageFromSource(
  ctx: StorageMutationCtx,
  projectId: Id<"projects">
): Promise<StorageBreakdown | null> {
  const project = await ctx.db.get(projectId)
  if (!project) {
    return null
  }

  const nextBreakdown = await estimateProjectStorageBreakdown(ctx, projectId)
  await writeProjectStorageUsageDoc(ctx, project.organizationId, projectId, nextBreakdown)
  return nextBreakdown
}

export async function rebuildOrganizationStorageUsageFromProjectAggregates(
  ctx: StorageMutationCtx,
  orgId: Id<"organizations">
): Promise<StorageBreakdown | null> {
  const org = await ctx.db.get(orgId)
  if (!org) {
    return null
  }

  const breakdown = await rollupProjectStorageUsageBreakdown(ctx, orgId)
  const now = Date.now()
  await ctx.db.patch(orgId, {
    storageUsage: {
      totalBytes: calculateStorageTotal(breakdown),
      lastCalculatedAt: now,
      breakdown,
    },
    updatedAt: now,
  })

  return breakdown
}

export async function syncProjectStorageUsage(
  ctx: StorageMutationCtx,
  projectId: Id<"projects">,
  _previousBreakdown: StorageBreakdown
): Promise<StorageBreakdown | null> {
  const project = await ctx.db.get(projectId)
  if (!project) {
    return null
  }

  const nextBreakdown = await estimateProjectStorageBreakdown(ctx, projectId)
  const existing = await getProjectStorageUsageDoc(ctx, projectId)
  await writeProjectStorageUsageDoc(ctx, project.organizationId, projectId, nextBreakdown)
  if (existing) {
    const deltas = createBreakdownDelta(existing.breakdown, nextBreakdown)
    await applyStorageDeltas(ctx, project.organizationId, deltas)
  } else {
    await rebuildOrganizationStorageUsageFromProjectAggregates(ctx, project.organizationId)
  }
  return nextBreakdown
}

/**
 * Estimate storage breakdown by querying tables directly
 * This is expensive - use cached values from org.storageUsage when possible
 */
export async function estimateStorageBreakdown(
  ctx: StorageCtx,
  orgId: Id<"organizations">
): Promise<StorageBreakdown> {
  const breakdown = emptyBreakdown()

  const projects = await ctx.db
    .query("projects")
    .withIndex("by_organization", (q) => q.eq("organizationId", orgId))
    .collect()

  for (const project of projects) {
    addToBreakdown(breakdown, await estimateProjectStorageBreakdown(ctx, project._id))
  }

  return breakdown
}

/**
 * Check storage usage for organization
 * Uses cached storage accounting. Full estimation is reserved for maintenance flows.
 */
export async function checkStorageUsage(
  ctx: StorageCtx,
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

  const billingSnapshot = await resolveOrganizationBillingSnapshot(ctx, {
    organization: org,
  })
  const plan = billingSnapshot.plan
  const limitBytes = getPlanStorageLimit(plan)

  const breakdown = org.storageUsage?.breakdown ?? (await rollupProjectStorageUsageBreakdown(ctx, orgId))
  const currentBytes = org.storageUsage?.totalBytes ?? calculateStorageTotal(breakdown)

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

export interface StorageCapacityResult {
  allowed: boolean
  projectedBytes: number
  limitBytes: number
  isUnlimited: boolean
  message?: string
}

/**
 * Check whether an organization can consume additional storage bytes.
 * Uses cached org.storageUsage as the current source of truth for fast-path enforcement.
 */
export async function canConsumeStorage(
  ctx: StorageCtx,
  orgId: Id<"organizations">,
  additionalBytes: number
): Promise<StorageCapacityResult> {
  const storageStatus = await checkStorageUsage(ctx, orgId)
  const normalizedAdditional = Math.max(0, additionalBytes)

  if (!storageStatus.allowed && !storageStatus.isUnlimited) {
    return {
      allowed: false,
      projectedBytes: storageStatus.currentBytes,
      limitBytes: storageStatus.limitBytes,
      isUnlimited: false,
      message: storageStatus.message || "Storage limit reached.",
    }
  }

  if (storageStatus.isUnlimited) {
    return {
      allowed: true,
      projectedBytes: storageStatus.currentBytes + normalizedAdditional,
      limitBytes: -1,
      isUnlimited: true,
    }
  }

  const projectedBytes = storageStatus.currentBytes + normalizedAdditional
  if (projectedBytes > storageStatus.limitBytes) {
    const overflow = projectedBytes - storageStatus.limitBytes
    return {
      allowed: false,
      projectedBytes,
      limitBytes: storageStatus.limitBytes,
      isUnlimited: false,
      message: `Storage limit would be exceeded by ${formatBytes(overflow)}.`,
    }
  }

  return {
    allowed: true,
    projectedBytes,
    limitBytes: storageStatus.limitBytes,
    isUnlimited: false,
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
