import { ConvexError, v } from "convex/values"
import { authenticatedMutation as mutation, authenticatedQuery as query } from "./lib/authenticatedFunctions"
import { isDeviceIdentityKey, normalizeDeviceIdentityKey } from "../shared/deviceIdentity"
import { requireAuthenticatedDevice } from "./lib/deviceAuth"
import { getProjectMembership, requireProjectManagerMembership } from "./lib/projectSharing"

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
    if (!target || target.status !== "active") throw new ConvexError("That device has not initialized Cozea")
    if (await getProjectMembership(ctx, args.projectId, target._id)) throw new ConvexError("That device already has access")
    const existing = await ctx.db.query("projectDeviceEnrollments")
      .withIndex("by_target_and_status", (q) => q.eq("targetIdentityKey", identityKey).eq("status", "pending"))
      .filter((q) => q.eq(q.field("projectId"), args.projectId)).first()
    if (existing && existing.expiresAt > Date.now()) return { enrollmentId: existing._id, created: false }
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
      await ctx.db.insert("projectMembers", {
        projectId: enrollment.projectId,
        userId: principal._id,
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
