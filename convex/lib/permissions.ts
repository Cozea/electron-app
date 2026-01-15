/**
 * Centralized permission system for role-based access control
 *
 * Roles hierarchy (highest to lowest):
 *   admin > member > viewer
 *
 * WorkOS Role Mapping:
 *   WorkOS "admin"  → Convex "admin"
 *   WorkOS "member" → Convex "member"
 *   WorkOS "viewer" → Convex "viewer"
 */

export type Role = "admin" | "member" | "viewer"

export type Permission =
  // Organization
  | "org:read"
  | "org:update"
  | "org:delete"
  | "org:manage_billing"
  // Members
  | "members:view"
  | "members:invite"
  | "members:remove"
  | "members:update_role"
  // Invitations
  | "invitations:view"
  | "invitations:send"
  | "invitations:revoke"
  // Settings
  | "settings:view"
  | "settings:update"
  | "settings:manage_api_keys"
  // Integrations
  | "integrations:view"
  | "integrations:connect"
  | "integrations:disconnect"
  // Usage & Analytics
  | "usage:view"
  | "usage:export"

/**
 * Permission matrix: maps each permission to the roles that have it
 */
const PERMISSION_MATRIX: Record<Permission, Role[]> = {
  // Organization
  "org:read": ["admin", "member", "viewer"],
  "org:update": ["admin"],
  "org:delete": ["admin"],
  "org:manage_billing": ["admin"],

  // Members
  "members:view": ["admin", "member", "viewer"],
  "members:invite": ["admin"],
  "members:remove": ["admin"],
  "members:update_role": ["admin"],

  // Invitations
  "invitations:view": ["admin"],
  "invitations:send": ["admin"],
  "invitations:revoke": ["admin"],

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
}

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
