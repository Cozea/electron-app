import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"

type ProjectSharingCtx = Pick<QueryCtx | MutationCtx, "db">

export function normalizeProjectInviteEmail(email: string): string {
  return email.trim().toLowerCase()
}

export async function findUserByNormalizedEmail(
  ctx: ProjectSharingCtx,
  normalizedEmail: string
) {
  return (
    (await ctx.db
      .query("users")
      .withIndex("by_normalized_email", (q) => q.eq("normalizedEmail", normalizedEmail))
      .first()) ??
    (await ctx.db
      .query("users")
      .withIndex("by_email", (q) => q.eq("email", normalizedEmail))
      .first())
  )
}

export async function getProjectMembership(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
) {
  return await ctx.db
    .query("projectMembers")
    .withIndex("by_project_and_user", (q) => q.eq("projectId", projectId).eq("userId", userId))
    .first()
}

export async function getProjectTrustedDevice(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
  deviceId: string
) {
  const trustedDevice = await ctx.db
    .query("projectTrustedDevices")
    .withIndex("by_project_and_device", (q) =>
      q.eq("projectId", projectId).eq("deviceId", deviceId)
    )
    .first()

  if (!trustedDevice || typeof trustedDevice.revokedAt === "number") {
    return null
  }

  return trustedDevice
}

export async function trustProjectDevice(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">
    deviceId: string
    deviceLabel: string
    platform?: string
    fingerprint?: string
    role: Doc<"projectMembers">["role"]
    userId?: Id<"users">
    addedByUserId?: Id<"users">
    addedByDeviceId?: string
  }
) {
  const now = Date.now()
  const existing = await ctx.db
    .query("projectTrustedDevices")
    .withIndex("by_project_and_device", (q) =>
      q.eq("projectId", args.projectId).eq("deviceId", args.deviceId)
    )
    .first()

  if (existing) {
    await ctx.db.patch(existing._id, {
      userId: args.userId ?? existing.userId,
      deviceLabel: args.deviceLabel,
      platform: args.platform ?? existing.platform,
      fingerprint: args.fingerprint ?? existing.fingerprint,
      role: args.role,
      lastSeenAt: now,
      revokedAt: undefined,
      addedByUserId: args.addedByUserId ?? existing.addedByUserId,
      addedByDeviceId: args.addedByDeviceId ?? existing.addedByDeviceId,
    })
    return existing._id
  }

  return await ctx.db.insert("projectTrustedDevices", {
    projectId: args.projectId,
    userId: args.userId,
    deviceId: args.deviceId,
    deviceLabel: args.deviceLabel,
    platform: args.platform,
    fingerprint: args.fingerprint,
    role: args.role,
    addedAt: now,
    addedByUserId: args.addedByUserId,
    addedByDeviceId: args.addedByDeviceId,
    lastSeenAt: now,
  })
}

export async function listProjectTrustedDevicesForUser(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
  userId: Id<"users">
) {
  return await ctx.db
    .query("projectTrustedDevices")
    .withIndex("by_project_and_user", (q) =>
      q.eq("projectId", projectId).eq("userId", userId)
    )
    .collect()
}

export async function syncTrustedDevicesRoleForUser(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">
    userId: Id<"users">
    role: Doc<"projectMembers">["role"]
  }
) {
  const trustedDevices = await listProjectTrustedDevicesForUser(
    ctx,
    args.projectId,
    args.userId
  )

  await Promise.all(
    trustedDevices
      .filter((device) => typeof device.revokedAt !== "number")
      .map((device) =>
        ctx.db.patch(device._id, {
          role: args.role,
        })
      )
  )
}

export async function revokeTrustedDevicesForUser(
  ctx: MutationCtx,
  args: {
    projectId: Id<"projects">
    userId: Id<"users">
  }
) {
  const trustedDevices = await listProjectTrustedDevicesForUser(
    ctx,
    args.projectId,
    args.userId
  )
  const revokedAt = Date.now()

  await Promise.all(
    trustedDevices
      .filter((device) => typeof device.revokedAt !== "number")
      .map((device) =>
        ctx.db.patch(device._id, {
          revokedAt,
        })
      )
  )
}

export async function requireProjectManagerMembership(
  ctx: MutationCtx,
  projectId: Id<"projects">,
  userId: Id<"users">,
  errorMessage = "Only project managers can manage project sharing"
) {
  const membership = await getProjectMembership(ctx, projectId, userId)
  if (!membership || membership.role !== "project_manager") {
    throw new Error(errorMessage)
  }
  return membership
}

export async function getProjectShareScope(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">
): Promise<{
  project: Doc<"projects">
}> {
  const project = await ctx.db.get(projectId)
  if (!project || project.status === "deleted") {
    throw new Error("Project not found")
  }

  return {
    project,
  }
}

export async function assertPersonalProjectShareScope(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">
) {
  return await getProjectShareScope(ctx, projectId)
}

export async function findPendingProjectInviteByEmail(
  ctx: ProjectSharingCtx,
  projectId: Id<"projects">,
  normalizedEmail: string
) {
  return await ctx.db
    .query("projectInvites")
    .withIndex("by_project", (q) => q.eq("projectId", projectId))
    .filter((q) =>
      q.and(
        q.eq(q.field("email"), normalizedEmail),
        q.eq(q.field("status"), "pending")
      )
    )
    .first()
}

export function buildPendingProjectInviteRecord(args: {
  projectId: Id<"projects">
  email: string
  role: Doc<"projectInvites">["role"]
  invitedBy: Id<"users">
  invitedAt: number
}) {
  return {
    projectId: args.projectId,
    email: args.email,
    role: args.role,
    invitedBy: args.invitedBy,
    invitedAt: args.invitedAt,
    status: "pending" as const,
  }
}
