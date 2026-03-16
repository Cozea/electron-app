/**
 * Centralized legacy role and permission system.
 *
 * This remains the fallback permission model while persisted organization
 * roles are rolled out. Persisted roles reuse the same permission keys and
 * base-role hierarchy, but store explicit role records per organization.
 */

export const BASE_ROLE_VALUES = ["admin", "member", "viewer"] as const

export type Role = (typeof BASE_ROLE_VALUES)[number]

export const PERMISSION_VALUES = [
  // Organization
  "org:read",
  "org:update",
  "org:delete",
  "org:manage_billing",
  // Billing
  "billing:view",
  "billing:manage_subscription",
  "billing:manage_seats",
  "billing:view_invoices",
  "billing:manage_payment_method",
  // Members
  "members:view",
  "members:invite",
  "members:remove",
  "members:update_role",
  // Invitations
  "invitations:view",
  "invitations:send",
  "invitations:revoke",
  // Roles / IAM
  "roles:view",
  "roles:create",
  "roles:update",
  "roles:delete",
  "roles:assign",
  // Projects
  "projects:view",
  "projects:create",
  "projects:import",
  "projects:edit",
  "projects:manage",
  "projects:archive",
  "projects:delete",
  "projects:share",
  // Project AI
  "project_ai:use",
  "project_ai:use_tools",
  "project_ai:use_agents",
  // Workspace AI
  "workspace_ai:view",
  "workspace_ai:manage_settings",
  "workspace_ai:manage_model_policy",
  "workspace_ai:manage_provider_policy",
  "workspace_ai:view_usage",
  // Tooling
  "tooling:view",
  "tooling:manage",
  // Settings
  "settings:view",
  "settings:update",
  "settings:manage_api_keys",
  // Integrations
  "integrations:view",
  "integrations:connect",
  "integrations:disconnect",
  // Usage & Analytics
  "usage:view",
  "usage:export",
  "audit:view",
] as const

export type Permission = (typeof PERMISSION_VALUES)[number]

/**
 * Permission matrix: maps each permission to the roles that have it
 */
const PERMISSION_MATRIX: Record<Permission, Role[]> = {
  // Organization
  "org:read": ["admin", "member", "viewer"],
  "org:update": ["admin"],
  "org:delete": ["admin"],
  "org:manage_billing": ["admin"],
  "billing:view": ["admin"],
  "billing:manage_subscription": ["admin"],
  "billing:manage_seats": ["admin"],
  "billing:view_invoices": ["admin"],
  "billing:manage_payment_method": ["admin"],

  // Members
  "members:view": ["admin", "member", "viewer"],
  "members:invite": ["admin"],
  "members:remove": ["admin"],
  "members:update_role": ["admin"],

  // Invitations
  "invitations:view": ["admin"],
  "invitations:send": ["admin"],
  "invitations:revoke": ["admin"],

  // Roles / IAM
  "roles:view": ["admin", "member", "viewer"],
  "roles:create": ["admin"],
  "roles:update": ["admin"],
  "roles:delete": ["admin"],
  "roles:assign": ["admin"],

  // Projects
  "projects:view": ["admin", "member", "viewer"],
  "projects:create": ["admin", "member"],
  "projects:import": ["admin", "member"],
  "projects:edit": ["admin"],
  "projects:manage": ["admin"],
  "projects:archive": ["admin"],
  "projects:delete": ["admin"],
  "projects:share": ["admin", "member"],

  // Project AI
  "project_ai:use": ["admin", "member"],
  "project_ai:use_tools": ["admin", "member"],
  "project_ai:use_agents": ["admin"],

  // Workspace AI
  "workspace_ai:view": ["admin", "member"],
  "workspace_ai:manage_settings": ["admin"],
  "workspace_ai:manage_model_policy": ["admin"],
  "workspace_ai:manage_provider_policy": ["admin"],
  "workspace_ai:view_usage": ["admin", "member"],

  // Tooling
  "tooling:view": ["admin", "member"],
  "tooling:manage": ["admin"],

  // Settings
  "settings:view": ["admin", "member"],
  "settings:update": ["admin"],
  "settings:manage_api_keys": ["admin"],

  // Integrations
  "integrations:view": ["admin", "member"],
  "integrations:connect": ["admin"],
  "integrations:disconnect": ["admin"],

  // Usage
  "usage:view": ["admin", "member"],
  "usage:export": ["admin"],
  "audit:view": ["admin"],
}

export interface SystemOrganizationRoleDefinition {
  key: string
  name: string
  description: string
  baseRole: Role
  permissions: Permission[]
  isSystem: boolean
}

export const SYSTEM_ORGANIZATION_ROLE_DEFINITIONS: SystemOrganizationRoleDefinition[] = [
  {
    key: "admin",
    name: "Admin",
    description: "Manage billing, members, invitations, integrations, and workspace settings.",
    baseRole: "admin",
    permissions: getPermissionsForRole("admin"),
    isSystem: true,
  },
  {
    key: "member",
    name: "Member",
    description: "Access projects, use workspace AI defaults, and collaborate across shared resources.",
    baseRole: "member",
    permissions: getPermissionsForRole("member"),
    isSystem: true,
  },
  {
    key: "viewer",
    name: "Viewer",
    description: "Read-only access to the workspace and shared resources.",
    baseRole: "viewer",
    permissions: getPermissionsForRole("viewer"),
    isSystem: true,
  },
]

/**
 * Check if a role has a specific permission
 */
export function hasPermission(role: Role, permission: Permission): boolean {
  const allowedRoles = PERMISSION_MATRIX[permission]
  return allowedRoles?.includes(role) ?? false
}

/**
 * Check if a role has ALL of the specified permissions
 */
export function hasAllPermissions(role: Role, permissions: Permission[]): boolean {
  return permissions.every((p) => hasPermission(role, p))
}

/**
 * Check if a role has ANY of the specified permissions
 */
export function hasAnyPermission(role: Role, permissions: Permission[]): boolean {
  return permissions.some((p) => hasPermission(role, p))
}

/**
 * Get all permissions for a role
 */
export function getPermissionsForRole(role: Role): Permission[] {
  return (Object.entries(PERMISSION_MATRIX) as [Permission, Role[]][])
    .filter(([_, roles]) => roles.includes(role))
    .map(([permission]) => permission)
}

/**
 * Map WorkOS role slug to our internal role
 * WorkOS roles: admin, member, viewer
 */
export function mapWorkOSRole(workosRoleSlug: string): Role {
  const roleMap: Record<string, Role> = {
    admin: "admin",
    member: "member",
    viewer: "viewer",
  }
  return roleMap[workosRoleSlug] || "member"
}

/**
 * Role hierarchy level (higher = more permissions)
 */
const ROLE_HIERARCHY: Record<Role, number> = {
  admin: 3,
  member: 2,
  viewer: 1,
}

/**
 * Check if roleA is higher or equal to roleB in the hierarchy
 */
export function isRoleAtLeast(roleA: Role, roleB: Role): boolean {
  return ROLE_HIERARCHY[roleA] >= ROLE_HIERARCHY[roleB]
}

/**
 * Check if a user can modify another user's role
 * Rules:
 * - Can only modify roles lower than your own
 * - Cannot set a role higher than your own
 */
export function canModifyRole(
  actorRole: Role,
  targetCurrentRole: Role,
  targetNewRole: Role
): boolean {
  // Must be admin or owner to modify roles
  if (!hasPermission(actorRole, "members:update_role")) {
    return false
  }

  // Cannot modify someone with equal or higher role
  if (ROLE_HIERARCHY[targetCurrentRole] >= ROLE_HIERARCHY[actorRole]) {
    return false
  }

  // Cannot promote to equal or higher than your own role
  if (ROLE_HIERARCHY[targetNewRole] >= ROLE_HIERARCHY[actorRole]) {
    return false
  }

  return true
}
