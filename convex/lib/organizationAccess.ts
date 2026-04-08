import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import { PERMISSION_VALUES, type Permission, type Role } from "./permissions"
import {
  hasAnyOrganizationPermission,
  hasOrganizationPermission,
  resolveCompatibleOrganizationRoleIdForBaseRole,
  resolveEffectivePermissions,
  resolveMemberAccess,
} from "./organizationRoles"

export const DEFAULT_ALLOWED_PROVIDERS = ["openai", "anthropic", "google", "xai", "moonshotai"] as const
export type SupportedAiProvider = (typeof DEFAULT_ALLOWED_PROVIDERS)[number]

export const ORGANIZATION_MEMBER_READ_PERMISSIONS = [
  "members:view",
  "members:invite",
  "members:remove",
  "members:update_role",
  "invitations:view",
  "invitations:send",
  "invitations:revoke",
  "roles:view",
  "roles:create",
  "roles:update",
  "roles:delete",
  "roles:assign",
] as const satisfies readonly Permission[]

export const ORGANIZATION_ROLE_READ_PERMISSIONS = [
  "roles:view",
  "roles:create",
  "roles:update",
  "roles:delete",
  "roles:assign",
  "members:update_role",
  "members:invite",
  "invitations:send",
] as const satisfies readonly Permission[]

export const ORGANIZATION_ROLE_ASSIGN_PERMISSIONS = [
  "roles:assign",
  "members:update_role",
] as const satisfies readonly Permission[]

export const ORGANIZATION_ROLE_CREATE_PERMISSIONS = [
  "roles:create",
  "members:update_role",
] as const satisfies readonly Permission[]

export const ORGANIZATION_ROLE_UPDATE_PERMISSIONS = [
  "roles:update",
  "members:update_role",
] as const satisfies readonly Permission[]

export const ORGANIZATION_ROLE_DELETE_PERMISSIONS = [
  "roles:delete",
  "members:update_role",
] as const satisfies readonly Permission[]

export function normalizeEmail(value: string): string {
  return value.trim().toLowerCase()
}

function slugify(value: string): string {
  const base = value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
  return base || "workspace"
}

export async function resolveUniqueOrganizationRoleKey(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  organizationId: Id<"organizations">,
  desired: string,
  excludeRoleId?: Id<"organizationRoles">,
): Promise<string> {
  const base = slugify(desired).replace(/^workspace$/, "role")
  let attempt = 1
  let candidate = base

  while (attempt <= 1000) {
    const existing = await ctx.db
      .query("organizationRoles")
      .withIndex("by_organization_and_key", (q) =>
        q.eq("organizationId", organizationId).eq("key", candidate),
      )
      .first()

    if (!existing || (excludeRoleId && existing._id === excludeRoleId)) {
      return candidate
    }

    attempt += 1
    candidate = `${base}-${attempt}`
  }

  return `${base}-${Date.now()}`
}

export function pickCanonicalOrganization(items: Doc<"organizations">[]): Doc<"organizations"> | null {
  if (items.length === 0) return null
  return [...items].sort((a, b) => {
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const createdDelta = b.createdAt - a.createdAt
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

export function pickCanonicalUser(items: Doc<"users">[]): Doc<"users"> | null {
  if (items.length === 0) return null
  return [...items].sort((a, b) => {
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const createdDelta = b.createdAt - a.createdAt
    if (createdDelta !== 0) return createdDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

export function rolePriority(role: Doc<"members">["role"]): number {
  switch (role) {
    case "admin":
      return 3
    case "member":
      return 2
    default:
      return 1
  }
}

export function sanitizePermissionOverrides(
  grants: Permission[] | undefined,
  denies: Permission[] | undefined,
) {
  const normalizedGrants = [...new Set((grants ?? []).filter((permission) => PERMISSION_VALUES.includes(permission)))]
  const normalizedDenies = [...new Set((denies ?? []).filter((permission) => PERMISSION_VALUES.includes(permission)))]

  for (const permission of normalizedGrants) {
    if (normalizedDenies.includes(permission)) {
      throw new Error(`Permission ${permission} cannot be both granted and denied`)
    }
  }

  return {
    permissionGrants: normalizedGrants,
    permissionDenies: normalizedDenies,
  }
}

export function hasAdministrativeWorkspaceAccess(
  permissions: readonly Permission[] | null | undefined,
) {
  if (!permissions) return false
  return (
    permissions.includes("members:update_role") ||
    permissions.includes("roles:assign") ||
    permissions.includes("billing:manage_subscription") ||
    permissions.includes("org:delete")
  )
}

export function pickCanonicalMembership(items: Doc<"members">[]): Doc<"members"> | null {
  if (items.length === 0) return null
  return [...items].sort((a, b) => {
    const roleDelta = rolePriority(b.role) - rolePriority(a.role)
    if (roleDelta !== 0) return roleDelta
    const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
    if (updatedDelta !== 0) return updatedDelta
    const joinedDelta = (b.joinedAt || 0) - (a.joinedAt || 0)
    if (joinedDelta !== 0) return joinedDelta
    return String(a._id).localeCompare(String(b._id))
  })[0]
}

export async function resolveUniqueSlug(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  desired: string,
  excludeOrgId?: Id<"organizations">,
): Promise<string> {
  const base = slugify(desired)
  let attempt = 1
  let candidate = base
  while (attempt <= 1000) {
    const existing = await ctx.db
      .query("organizations")
      .withIndex("by_slug", (q) => q.eq("slug", candidate))
      .first()
    if (!existing || (excludeOrgId && existing._id === excludeOrgId)) {
      return candidate
    }
    attempt += 1
    candidate = `${base}-${attempt}`
  }
  return `${base}-${Date.now()}`
}

export async function getCanonicalOrgMembership(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
): Promise<Doc<"members"> | null> {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_organization_and_user", (q) =>
      q.eq("organizationId", organizationId).eq("userId", userId),
    )
    .collect()
  return pickCanonicalMembership(memberships)
}

export function resolveViewerUserId(args: {
  viewerUserId?: Id<"users">
  userId?: Id<"users">
}): Id<"users"> | null {
  return args.viewerUserId ?? args.userId ?? null
}

export async function applyAcceptedInvitationRoleToMembership(
  ctx: Pick<MutationCtx, "db">,
  organizationId: Id<"organizations">,
  user: Doc<"users">,
  membershipId: Id<"members">,
) {
  const pendingInvitations = await ctx.db
    .query("invitations")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .filter((q) => q.eq(q.field("status"), "pending"))
    .collect()

  const matchingPendingInvitations = pendingInvitations
    .filter((invitation) => normalizeEmail(invitation.email) === normalizeEmail(user.email))
    .sort((left, right) => (right.createdAt || 0) - (left.createdAt || 0))

  if (matchingPendingInvitations.length === 0) {
    return
  }

  const latestInvitation = matchingPendingInvitations[0]
  await ctx.db.patch(membershipId, {
    role: latestInvitation.role,
    roleId: latestInvitation.roleId,
    permissionGrants: latestInvitation.permissionGrants,
    permissionDenies: latestInvitation.permissionDenies,
    updatedAt: Date.now(),
  })

  for (const pendingInvitation of matchingPendingInvitations) {
    await ctx.db.patch(pendingInvitation._id, { status: "accepted" })
  }
}

export async function requireOrganizationPermission(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
  permission: Permission,
) {
  const membership = await getCanonicalOrgMembership(ctx, organizationId, userId)
  const allowed = await hasOrganizationPermission(ctx, membership, permission)
  return { membership, allowed }
}

export async function requireAnyOrganizationPermission(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  organizationId: Id<"organizations">,
  userId: Id<"users">,
  permissions: readonly Permission[],
) {
  const membership = await getCanonicalOrgMembership(ctx, organizationId, userId)
  const allowed = await hasAnyOrganizationPermission(ctx, membership, permissions)
  return { membership, allowed }
}

export function normalizePermissionList(
  permissions: readonly Permission[] | undefined | null,
): Permission[] {
  return [...new Set((permissions ?? []).filter((permission): permission is Permission =>
    PERMISSION_VALUES.includes(permission),
  ))]
}

export function buildEffectiveOrganizationPermissions(
  inheritedPermissions: readonly Permission[],
  permissionGrants: readonly Permission[] | undefined | null,
  permissionDenies: readonly Permission[] | undefined | null,
): Permission[] {
  return resolveEffectivePermissions(
    normalizePermissionList(inheritedPermissions),
    normalizePermissionList(permissionGrants),
    normalizePermissionList(permissionDenies),
  )
}

export async function ensureAdministrativeWorkspaceAccessAfterMembershipChange(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  organizationId: Id<"organizations">,
  targetMembership: Doc<"members">,
  currentPermissions: readonly Permission[] | null | undefined,
  nextPermissions: readonly Permission[] | null | undefined,
) {
  if (
    !hasAdministrativeWorkspaceAccess(currentPermissions) ||
    hasAdministrativeWorkspaceAccess(nextPermissions)
  ) {
    return
  }

  const memberships = await ctx.db
    .query("members")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect()

  for (const candidate of memberships) {
    if (candidate._id === targetMembership._id) continue
    const candidateAccess = await resolveMemberAccess(ctx, candidate)
    if (hasAdministrativeWorkspaceAccess(candidateAccess?.permissions)) {
      return
    }
  }

  throw new Error("Cannot remove the last admin-equivalent access")
}

export async function ensureAdministrativeWorkspaceAccessAfterRoleUpdate(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  organizationId: Id<"organizations">,
  roleId: Id<"organizationRoles">,
  nextRolePermissions: readonly Permission[],
) {
  const memberships = await ctx.db
    .query("members")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect()

  let currentAdministrativeCount = 0
  let nextAdministrativeCount = 0

  for (const membership of memberships) {
    const currentAccess = await resolveMemberAccess(ctx, membership)
    const currentPermissions = currentAccess?.permissions ?? []

    if (hasAdministrativeWorkspaceAccess(currentPermissions)) {
      currentAdministrativeCount += 1
    }

    const projectedPermissions =
      membership.roleId === roleId
        ? buildEffectiveOrganizationPermissions(
            nextRolePermissions,
            membership.permissionGrants,
            membership.permissionDenies,
          )
        : currentPermissions

    if (hasAdministrativeWorkspaceAccess(projectedPermissions)) {
      nextAdministrativeCount += 1
    }
  }

  if (currentAdministrativeCount > 0 && nextAdministrativeCount === 0) {
    throw new Error("Cannot remove the last admin-equivalent access")
  }
}

export async function getCompatibleRoleIdForBaseRole(
  ctx: Pick<MutationCtx | QueryCtx, "db">,
  organizationId: Id<"organizations">,
  role: Role,
  currentRoleId?: Id<"organizationRoles"> | null,
) {
  return await resolveCompatibleOrganizationRoleIdForBaseRole(
    ctx,
    organizationId,
    role,
    currentRoleId,
  )
}

export function sanitizeAllowedProviders(
  providers: Array<"anthropic" | "openai" | "google" | "xai" | "moonshotai"> | undefined,
): SupportedAiProvider[] {
  const input = providers ?? [...DEFAULT_ALLOWED_PROVIDERS]
  const sanitized: SupportedAiProvider[] = []
  const seen = new Set<SupportedAiProvider>()
  for (const provider of input) {
    if (
      provider !== "openai" &&
      provider !== "anthropic" &&
      provider !== "google" &&
      provider !== "xai" &&
      provider !== "moonshotai"
    ) {
      continue
    }
    if (seen.has(provider)) continue
    seen.add(provider)
    sanitized.push(provider)
  }
  return sanitized.length > 0 ? sanitized : [...DEFAULT_ALLOWED_PROVIDERS]
}

export function estimateSnapshotBytes(snapshot: {
  byteSize?: number
  snapshot?: ArrayBuffer
}): number {
  return Math.max(0, snapshot.byteSize ?? snapshot.snapshot?.byteLength ?? 0)
}
