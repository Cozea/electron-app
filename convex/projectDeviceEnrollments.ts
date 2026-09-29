import { ConvexError, v } from "convex/values"
import type { Id } from "./_generated/dataModel"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { isDeviceIdentityKey, normalizeDeviceIdentityKey } from "../shared/deviceIdentity"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { getProjectMembership, requireProjectManagerMembership } from "./lib/projectSharing"
import { requireProjectSeats } from "./lib/seatLimits"

const ENROLLMENT_TTL_MS = 7 * 24 * 60 * 60_000

export const create = mutation({
  args: {
    projectId: v.id("projects"),
    identityKey: v.string(),
    role: v.union(v.literal("project_manager"), v.literal("developer"), v.literal("designer"), v.literal("viewer")),
  },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedDevice(ctx)
    await requireProjectManagerMembership(ctx, args.projectId, actor._id)
    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    if (!isDeviceIdentityKey(identityKey)) throw new ConvexError("Enter a valid Cozea device ID")
    const target = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey)).unique()
    if (target && (await getProjectMembership(ctx, args.projectId, target._id))) {
      throw new ConvexError("That device already has access")
    }
    const existing = await ctx.db.query("projectDeviceEnrollments")
      .withIndex("by_target_and_status", (q) => q.eq("targetIdentityKey", identityKey).eq("status", "pending"))
      .filter((q) => q.eq(q.field("projectId"), args.projectId)).first()
    if (existing && existing.expiresAt > Date.now()) return { enrollmentId: existing._id, created: false }
    await requireProjectSeats(ctx, args.projectId)
    const now = Date.now()
    const enrollmentId = await ctx.db.insert("projectDeviceEnrollments", {
      projectId: args.projectId,
      targetIdentityKey: identityKey,
      role: args.role,
      status: "pending",
      createdBy: actor._id,
      createdAt: now,
      expiresAt: now + ENROLLMENT_TTL_MS,
    })
    return { enrollmentId, created: true }
  },
})

/**
 * Who this device can invite by name instead of by czd_ key: everyone it has
 * worked with on a project, plus everyone it shares a group with, minus the
 * project's current members and its pending invitations. A 30-character
 * identity key is unusable as a thing to type, so the invite field searches
 * this list and only falls back to a pasted key.
 */
export const listInviteCandidates = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedDevice(ctx)
    await requireProjectManagerMembership(ctx as never, args.projectId, actor._id)

    const candidates = new Map<string, {
      principalId: Id<"devicePrincipals">
      identityKey: string
      displayName: string
      avatarUrl: string | null
      knownFrom: string[]
    }>()

    // The same device usually turns up through several groups and projects; keep
    // one row and collect the names so the list can say where it is known from.
    const remember = async (principalId: Id<"devicePrincipals">, source: string | undefined) => {
      if (principalId === actor._id) return
      const key = String(principalId)
      const known = candidates.get(key)
      if (known) {
        if (source && !known.knownFrom.includes(source)) known.knownFrom.push(source)
        return
      }
      const principal = await ctx.db.get(principalId)
      if (!principal || principal.status === "revoked") return
      candidates.set(key, {
        principalId,
        identityKey: principal.identityKey,
        displayName: principal.displayName,
        avatarUrl: principal.avatarStorageId ? await ctx.storage.getUrl(principal.avatarStorageId) : null,
        knownFrom: source ? [source] : [],
      })
    }

    const myProjects = await ctx.db.query("projectMembers")
      .withIndex("by_principal", (q) => q.eq("principalId", actor._id)).collect()
    for (const mine of myProjects) {
      const project = await ctx.db.get(mine.projectId)
      if (!project || project.status === "deleted") continue
      const peers = await ctx.db.query("projectMembers")
        .withIndex("by_project", (q) => q.eq("projectId", mine.projectId)).collect()
      for (const peer of peers) await remember(peer.principalId, project.name)
    }

    const myGroups = await ctx.db.query("organizationMembers")
      .withIndex("by_principal", (q) => q.eq("principalId", actor._id)).collect()
    for (const mine of myGroups) {
      const group = await ctx.db.get(mine.organizationId)
      const peers = await ctx.db.query("organizationMembers")
        .withIndex("by_organization", (q) => q.eq("organizationId", mine.organizationId)).collect()
      for (const peer of peers) await remember(peer.principalId, group?.name)
    }

    const members = await ctx.db.query("projectMembers")
      .withIndex("by_project", (q) => q.eq("projectId", args.projectId)).collect()
    for (const member of members) candidates.delete(String(member.principalId))

    const now = Date.now()
    const pending = await ctx.db.query("projectDeviceEnrollments")
      .withIndex("by_project_and_status", (q) => q.eq("projectId", args.projectId).eq("status", "pending"))
      .collect()
    const invited = new Set(pending.filter((row) => row.expiresAt > now).map((row) => row.targetIdentityKey))

    return [...candidates.values()]
      .filter((candidate) => !invited.has(candidate.identityKey))
      .sort((left, right) => left.displayName.localeCompare(right.displayName))
  },
})

/** One shape whatever the outcome, so callers read `status` and the nullable fields. */
export type ResolvedInviteIdentity = {
  identityKey: string
  status: "ok" | "member" | "unknown" | "invalid"
  principalId: Id<"devicePrincipals"> | null
  displayName: string | null
  avatarUrl: string | null
}

/**
 * Puts a name on a pasted czd_ key so the invite field can show a person rather
 * than the key. `status` distinguishes "not a key", "no such device" and
 * "already on the project" for the caller to report.
 */
export const resolveIdentityKey = query({
  args: { projectId: v.id("projects"), identityKey: v.string() },
  handler: async (ctx, args): Promise<ResolvedInviteIdentity> => {
    const actor = await requireAuthenticatedDevice(ctx)
    await requireProjectManagerMembership(ctx as never, args.projectId, actor._id)

    const identityKey = normalizeDeviceIdentityKey(args.identityKey)
    const miss = (status: "invalid" | "unknown"): ResolvedInviteIdentity => ({
      identityKey,
      status,
      principalId: null,
      displayName: null,
      avatarUrl: null,
    })
    if (!isDeviceIdentityKey(identityKey)) return miss("invalid")

    const target = await ctx.db.query("devicePrincipals")
      .withIndex("by_identity_key", (q) => q.eq("identityKey", identityKey)).unique()
    if (!target || target.status === "revoked") return miss("unknown")

    const membership = await getProjectMembership(ctx, args.projectId, target._id)
    return {
      identityKey,
      status: membership ? "member" : "ok",
      principalId: target._id,
      displayName: target.displayName,
      avatarUrl: target.avatarStorageId ? await ctx.storage.getUrl(target.avatarStorageId) : null,
    }
  },
})

export const listForProject = query({
  args: { projectId: v.id("projects") },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedDevice(ctx)
    await requireProjectManagerMembership(ctx as never, args.projectId, actor._id)
    return await ctx.db.query("projectDeviceEnrollments")
      .withIndex("by_project_and_status", (q) => q.eq("projectId", args.projectId).eq("status", "pending"))
      .collect()
  },
})

export const listIncoming = query({
  args: {},
  handler: async (ctx) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const rows = await ctx.db.query("projectDeviceEnrollments")
      .withIndex("by_target_and_status", (q) => q.eq("targetIdentityKey", principal.identityKey).eq("status", "pending"))
      .collect()
    return await Promise.all(rows.filter((row) => row.expiresAt > Date.now()).map(async (row) => {
      const [project, inviter] = await Promise.all([ctx.db.get(row.projectId), ctx.db.get(row.createdBy)])
      return {
        ...row,
        projectName: project?.name ?? "Unknown project",
        inviterName: inviter?.displayName ?? "Unknown device",
      }
    }))
  },
})

export const resolve = mutation({
  args: { enrollmentId: v.id("projectDeviceEnrollments"), accept: v.boolean() },
  handler: async (ctx, args) => {
    const principal = await requireAuthenticatedDevice(ctx)
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment || enrollment.status !== "pending" || enrollment.targetIdentityKey !== principal.identityKey) {
      throw new ConvexError("Enrollment is not available to this device")
    }
    const now = Date.now()
    if (enrollment.expiresAt <= now) {
      await ctx.db.patch(enrollment._id, { status: "expired", resolvedAt: now })
      throw new ConvexError("Enrollment has expired")
    }
    if (!args.accept) {
      await ctx.db.patch(enrollment._id, { status: "rejected", resolvedAt: now })
      return { accepted: false }
    }
    const existing = await getProjectMembership(ctx, enrollment.projectId, principal._id)
    if (!existing) {
      // The invitation held a seat; release it first so this check sees the truth.
      await ctx.db.patch(enrollment._id, { status: "accepted", resolvedAt: now })
      await requireProjectSeats(ctx, enrollment.projectId)
      await ctx.db.insert("projectMembers", {
        projectId: enrollment.projectId,
        principalId: principal._id,
        role: enrollment.role,
        addedAt: now,
        addedBy: enrollment.createdBy,
      })
    }
    await ctx.db.patch(enrollment._id, { status: "accepted", resolvedAt: now })
    return { accepted: true, projectId: enrollment.projectId }
  },
})

export const cancel = mutation({
  args: { enrollmentId: v.id("projectDeviceEnrollments") },
  handler: async (ctx, args) => {
    const actor = await requireAuthenticatedDevice(ctx)
    const enrollment = await ctx.db.get(args.enrollmentId)
    if (!enrollment || enrollment.status !== "pending") throw new ConvexError("Enrollment not found")
    await requireProjectManagerMembership(ctx, enrollment.projectId, actor._id)
    await ctx.db.patch(enrollment._id, { status: "cancelled", resolvedAt: Date.now() })
    return { cancelled: true }
  },
})
