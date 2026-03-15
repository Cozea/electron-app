import { v } from "convex/values"
import type { Doc, Id } from "../_generated/dataModel"
import type { MutationCtx, QueryCtx } from "../_generated/server"
import {
  BASE_ROLE_VALUES,
  PERMISSION_VALUES,
  SYSTEM_ORGANIZATION_ROLE_DEFINITIONS,
  hasPermission as hasLegacyPermission,
  type Permission,
  type Role,
} from "./permissions"

type ReadDatabaseCtx = Pick<QueryCtx | MutationCtx, "db">
type WriteDatabaseCtx = Pick<MutationCtx, "db">

export const roleBaseValidator = v.union(
  v.literal("admin"),
  v.literal("member"),
  v.literal("viewer")
)

export const organizationPermissionValidator = v.union(
  v.literal("org:read"),
  v.literal("org:update"),
  v.literal("org:delete"),
  v.literal("org:manage_billing"),
  v.literal("billing:view"),
  v.literal("billing:manage_subscription"),
  v.literal("billing:manage_seats"),
  v.literal("billing:view_invoices"),
  v.literal("billing:manage_payment_method"),
  v.literal("members:view"),
  v.literal("members:invite"),
  v.literal("members:remove"),
  v.literal("members:update_role"),
  v.literal("invitations:view"),
  v.literal("invitations:send"),
  v.literal("invitations:revoke"),
  v.literal("roles:view"),
  v.literal("roles:create"),
  v.literal("roles:update"),
  v.literal("roles:delete"),
  v.literal("roles:assign"),
  v.literal("projects:view"),
  v.literal("projects:create"),
  v.literal("projects:import"),
  v.literal("projects:archive"),
  v.literal("projects:delete"),
  v.literal("projects:share"),
  v.literal("project_ai:use"),
  v.literal("project_ai:use_tools"),
  v.literal("project_ai:use_agents"),
  v.literal("workspace_ai:view"),
  v.literal("workspace_ai:manage_settings"),
  v.literal("workspace_ai:manage_model_policy"),
  v.literal("workspace_ai:manage_provider_policy"),
  v.literal("workspace_ai:view_usage"),
  v.literal("tooling:view"),
  v.literal("tooling:manage"),
  v.literal("settings:view"),
  v.literal("settings:update"),
  v.literal("settings:manage_api_keys"),
  v.literal("integrations:view"),
  v.literal("integrations:connect"),
  v.literal("integrations:disconnect"),
  v.literal("usage:view"),
  v.literal("usage:export"),
  v.literal("audit:view")
)

export interface ResolvedOrganizationRole {
  roleId: Id<"organizationRoles"> | null
  key: string
  name: string
  description: string
  baseRole: Role
  permissions: Permission[]
  isSystem: boolean
}

export interface ResolvedOrganizationAccess extends ResolvedOrganizationRole {
  legacyRole: Role
  inheritedPermissions: Permission[]
  directGrants: Permission[]
  directDenies: Permission[]
  permissions: Permission[]
}

function uniquePermissions(
  permissions: readonly Permission[] | undefined | null
): Permission[] {
  return [...new Set((permissions ?? []).filter((permission): permission is Permission =>
    PERMISSION_VALUES.includes(permission)
  ))]
}

export function resolveEffectivePermissions(
  inheritedPermissions: readonly Permission[],
  directGrants: readonly Permission[],
  directDenies: readonly Permission[]
): Permission[] {
  const effective = new Set<Permission>(inheritedPermissions)
  for (const permission of directGrants) {
    effective.add(permission)
  }
  for (const permission of directDenies) {
    effective.delete(permission)
  }
  return [...effective]
}

function sortRoleRecords(a: Doc<"organizationRoles">, b: Doc<"organizationRoles">) {
  if (a.isSystem !== b.isSystem) return a.isSystem ? -1 : 1
  const updatedDelta = (b.updatedAt || 0) - (a.updatedAt || 0)
  if (updatedDelta !== 0) return updatedDelta
  return a.name.localeCompare(b.name)
}

export async function ensureSystemOrganizationRoles(
  ctx: WriteDatabaseCtx,
  organizationId: Id<"organizations">
): Promise<Doc<"organizationRoles">[]> {
  const now = Date.now()
  const existing = await ctx.db
    .query("organizationRoles")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect()

  const byKey = new Map(existing.map((role) => [role.key, role]))

  for (const definition of SYSTEM_ORGANIZATION_ROLE_DEFINITIONS) {
    const current = byKey.get(definition.key)
    if (current) {
      const nextPermissions = [...definition.permissions]
      const currentPermissions = [...current.permissions]
      const samePermissions =
        currentPermissions.length === nextPermissions.length &&
        currentPermissions.every((permission) => nextPermissions.includes(permission))

      if (
        current.name !== definition.name ||
        current.description !== definition.description ||
        current.baseRole !== definition.baseRole ||
        !samePermissions ||
        current.isSystem !== definition.isSystem
      ) {
        await ctx.db.patch(current._id, {
          name: definition.name,
          description: definition.description,
          baseRole: definition.baseRole,
          permissions: nextPermissions,
          isSystem: definition.isSystem,
          updatedAt: now,
        })
      }
      continue
    }

    const roleId = await ctx.db.insert("organizationRoles", {
      organizationId,
      key: definition.key,
      name: definition.name,
      description: definition.description,
      baseRole: definition.baseRole,
      permissions: [...definition.permissions],
      isSystem: definition.isSystem,
      createdAt: now,
      updatedAt: now,
    })

    const inserted = await ctx.db.get(roleId)
    if (inserted) {
      byKey.set(inserted.key, inserted)
    }
  }

  const refreshed = await ctx.db
    .query("organizationRoles")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect()

  return [...refreshed].sort(sortRoleRecords)
}

export async function listOrganizationRoles(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">
): Promise<Doc<"organizationRoles">[]> {
  const roles = await ctx.db
    .query("organizationRoles")
    .withIndex("by_organization", (q) => q.eq("organizationId", organizationId))
    .collect()

  return [...roles].sort(sortRoleRecords)
}

export async function getOrganizationRoleById(
  ctx: ReadDatabaseCtx,
  roleId: Id<"organizationRoles"> | null | undefined
): Promise<Doc<"organizationRoles"> | null> {
  if (!roleId) return null
  const role = await ctx.db.get(roleId)
  return role ?? null
}

export async function getDefaultOrganizationRoleForBaseRole(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  baseRole: Role
): Promise<Doc<"organizationRoles"> | null> {
  const roles = await listOrganizationRoles(ctx, organizationId)
  return roles.find((role) => role.key === baseRole) ?? null
}

export async function resolveCompatibleOrganizationRoleIdForBaseRole(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  baseRole: Role,
  currentRoleId?: Id<"organizationRoles"> | null
): Promise<Id<"organizationRoles"> | null> {
  const currentRole = await getOrganizationRoleById(ctx, currentRoleId)
  if (
    currentRole &&
    currentRole.organizationId === organizationId &&
    currentRole.baseRole === baseRole
  ) {
    return currentRole._id
  }

  const defaultRole = await getDefaultOrganizationRoleForBaseRole(
    ctx,
    organizationId,
    baseRole
  )

  return defaultRole?._id ?? null
}

export async function resolveOrganizationRole(
  ctx: ReadDatabaseCtx,
  organizationId: Id<"organizations">,
  fallbackBaseRole: Role,
  roleId?: Id<"organizationRoles"> | null
): Promise<ResolvedOrganizationRole> {
  const roleRecord = await getOrganizationRoleById(ctx, roleId)
  if (roleRecord && roleRecord.organizationId === organizationId) {
    return {
      roleId: roleRecord._id,
      key: roleRecord.key,
      name: roleRecord.name,
      description: roleRecord.description,
      baseRole: roleRecord.baseRole,
      permissions: [...roleRecord.permissions],
      isSystem: roleRecord.isSystem,
    }
  }

  const defaultRole = await getDefaultOrganizationRoleForBaseRole(
    ctx,
    organizationId,
    fallbackBaseRole
  )

  if (defaultRole) {
    return {
      roleId: defaultRole._id,
      key: defaultRole.key,
      name: defaultRole.name,
      description: defaultRole.description,
      baseRole: defaultRole.baseRole,
      permissions: [...defaultRole.permissions],
      isSystem: defaultRole.isSystem,
    }
  }

  return {
    roleId: null,
    key: fallbackBaseRole,
    name: fallbackBaseRole.charAt(0).toUpperCase() + fallbackBaseRole.slice(1),
    description: "",
    baseRole: fallbackBaseRole,
    permissions: PERMISSION_VALUES.filter((permission) =>
      hasLegacyPermission(fallbackBaseRole, permission)
    ),
    isSystem: true,
  }
}

export async function hasOrganizationPermission(
  ctx: ReadDatabaseCtx,
  membership: Doc<"members"> | null,
  permission: Permission
): Promise<boolean> {
  if (!membership) return false
  const access = await resolveMemberAccess(ctx, membership)
  return access?.permissions.includes(permission) ?? false
}

export async function hasAnyOrganizationPermission(
  ctx: ReadDatabaseCtx,
  membership: Doc<"members"> | null,
  permissions: readonly Permission[]
): Promise<boolean> {
  if (!membership) return false
  const access = await resolveMemberAccess(ctx, membership)
  if (!access) return false
  return permissions.some((permission) => access.permissions.includes(permission))
}

export async function resolveMemberAccess(
  ctx: ReadDatabaseCtx,
  membership: Doc<"members"> | null
): Promise<ResolvedOrganizationAccess | null> {
  if (!membership) return null
  const resolved = await resolveOrganizationRole(
    ctx,
    membership.organizationId,
    membership.role,
    membership.roleId
  )
  const inheritedPermissions = uniquePermissions(resolved.permissions)
  const directGrants = uniquePermissions(membership.permissionGrants)
  const directDenies = uniquePermissions(membership.permissionDenies)
  return {
    ...resolved,
    legacyRole: membership.role,
    inheritedPermissions,
    directGrants,
    directDenies,
    permissions: resolveEffectivePermissions(
      inheritedPermissions,
      directGrants,
      directDenies
    ),
  }
}

export async function resolveInvitationAccess(
  ctx: ReadDatabaseCtx,
  invitation: Doc<"invitations"> | null
): Promise<ResolvedOrganizationAccess | null> {
  if (!invitation) return null
  const resolved = await resolveOrganizationRole(
    ctx,
    invitation.organizationId,
    invitation.role,
    invitation.roleId
  )
  const inheritedPermissions = uniquePermissions(resolved.permissions)
  const directGrants = uniquePermissions(invitation.permissionGrants)
  const directDenies = uniquePermissions(invitation.permissionDenies)
  return {
    ...resolved,
    legacyRole: invitation.role,
    inheritedPermissions,
    directGrants,
    directDenies,
    permissions: resolveEffectivePermissions(
      inheritedPermissions,
      directGrants,
      directDenies
    ),
  }
}

export function isBaseRole(value: string): value is Role {
  return BASE_ROLE_VALUES.includes(value as Role)
}
