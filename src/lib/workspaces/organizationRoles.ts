import { EyeIcon as Eye, ShieldCheckIcon as Shield, UsersIcon as Users } from "@heroicons/react/24/outline"

export type OrganizationWorkspaceRole = 'admin' | 'member' | 'viewer'

export type OrganizationWorkspacePermission =
  | 'org:read'
  | 'org:update'
  | 'org:delete'
  | 'org:manage_billing'
  | 'billing:view'
  | 'billing:manage_subscription'
  | 'billing:manage_seats'
  | 'billing:view_invoices'
  | 'billing:manage_payment_method'
  | 'members:view'
  | 'members:invite'
  | 'members:remove'
  | 'members:update_role'
  | 'invitations:view'
  | 'invitations:send'
  | 'invitations:revoke'
  | 'roles:view'
  | 'roles:create'
  | 'roles:update'
  | 'roles:delete'
  | 'roles:assign'
  | 'projects:view'
  | 'projects:create'
  | 'projects:import'
  | 'projects:archive'
  | 'projects:delete'
  | 'projects:share'
  | 'project_ai:use'
  | 'project_ai:use_tools'
  | 'project_ai:use_agents'
  | 'workspace_ai:view'
  | 'workspace_ai:manage_settings'
  | 'workspace_ai:manage_model_policy'
  | 'workspace_ai:manage_provider_policy'
  | 'workspace_ai:view_usage'
  | 'tooling:view'
  | 'tooling:manage'
  | 'settings:view'
  | 'settings:update'
  | 'settings:manage_api_keys'
  | 'integrations:view'
  | 'integrations:connect'
  | 'integrations:disconnect'
  | 'usage:view'
  | 'usage:export'
  | 'audit:view'

interface OrganizationWorkspaceRoleDefinition {
  id: OrganizationWorkspaceRole
  name: string
  label: string
  description: string
  badgeClassName: string
  permissions: OrganizationWorkspacePermission[]
}

interface OrganizationWorkspaceRoleOption {
  value: string
  roleId?: string | null
  label: string
  baseRole: OrganizationWorkspaceRole
  icon: typeof Shield
}

interface OrganizationWorkspacePermissionGroup {
  category: string
  label: string
  permissions: {
    key: OrganizationWorkspacePermission
    label: string
    description: string
  }[]
}

export const ORGANIZATION_WORKSPACE_ROLE_DEFINITIONS: Record<
  OrganizationWorkspaceRole,
  OrganizationWorkspaceRoleDefinition
> = {
  admin: {
    id: 'admin',
    name: 'Admin',
    label: 'Admin',
    description: 'Manage billing, members, settings, and all workspace projects.',
    badgeClassName: 'bg-primary/10 text-primary',
    permissions: [
      'org:read',
      'org:update',
      'org:delete',
      'org:manage_billing',
      'billing:view',
      'billing:manage_subscription',
      'billing:manage_seats',
      'billing:view_invoices',
      'billing:manage_payment_method',
      'members:view',
      'members:invite',
      'members:remove',
      'members:update_role',
      'invitations:view',
      'invitations:send',
      'invitations:revoke',
      'roles:view',
      'roles:create',
      'roles:update',
      'roles:delete',
      'roles:assign',
      'projects:view',
      'projects:create',
      'projects:import',
      'projects:archive',
      'projects:delete',
      'projects:share',
      'project_ai:use',
      'project_ai:use_tools',
      'project_ai:use_agents',
      'workspace_ai:view',
      'workspace_ai:manage_settings',
      'workspace_ai:manage_model_policy',
      'workspace_ai:manage_provider_policy',
      'workspace_ai:view_usage',
      'settings:view',
      'settings:update',
      'settings:manage_api_keys',
      'integrations:view',
      'integrations:connect',
      'integrations:disconnect',
      'usage:view',
      'usage:export',
      'audit:view',
    ],
  },
  member: {
    id: 'member',
    name: 'Member',
    label: 'Member',
    description: 'Collaborate on workspace projects and view workspace settings.',
    badgeClassName: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
    permissions: [
      'org:read',
      'members:view',
      'roles:view',
      'projects:view',
      'projects:create',
      'projects:import',
      'projects:share',
      'project_ai:use',
      'project_ai:use_tools',
      'settings:view',
      'workspace_ai:view',
      'workspace_ai:view_usage',
      'integrations:view',
      'usage:view',
    ],
  },
  viewer: {
    id: 'viewer',
    name: 'Viewer',
    label: 'Viewer',
    description: 'Read workspace details and access shared projects without editing controls.',
    badgeClassName: 'bg-muted text-muted-foreground',
    permissions: [
      'org:read',
      'members:view',
      'roles:view',
      'projects:view',
    ],
  },
}

export const ORGANIZATION_WORKSPACE_ROLE_OPTIONS: OrganizationWorkspaceRoleOption[] = [
  { value: 'admin', label: 'Admin', baseRole: 'admin', icon: Shield },
  { value: 'member', label: 'Member', baseRole: 'member', icon: Users },
  { value: 'viewer', label: 'Viewer', baseRole: 'viewer', icon: Eye },
]

export const ORGANIZATION_WORKSPACE_PERMISSION_GROUPS: OrganizationWorkspacePermissionGroup[] = [
  {
    label: 'Workspace',
    category: 'Workspace',
    permissions: [
      {
        key: 'org:read',
        label: 'View workspace',
        description: 'Open the workspace and view its pages.',
      },
      {
        key: 'org:update',
        label: 'Update workspace',
        description: 'Edit workspace details and settings.',
      },
      {
        key: 'org:delete',
        label: 'Delete workspace',
        description: 'Delete the workspace and its managed settings.',
      },
    ],
  },
  {
    label: 'Billing',
    category: 'Billing',
    permissions: [
      {
        key: 'billing:view',
        label: 'View billing',
        description: 'Open workspace billing and subscription details.',
      },
      {
        key: 'org:manage_billing',
        label: 'Manage billing',
        description: 'Change subscription, seats, and payment settings.',
      },
      {
        key: 'billing:manage_subscription',
        label: 'Manage subscription',
        description: 'Change plan and billing cycle.',
      },
      {
        key: 'billing:manage_seats',
        label: 'Manage seats',
        description: 'Adjust seat count and seat assignments.',
      },
      {
        key: 'billing:view_invoices',
        label: 'View invoices',
        description: 'Open invoice and payment history.',
      },
      {
        key: 'billing:manage_payment_method',
        label: 'Manage payment method',
        description: 'Update payment methods and billing profile.',
      },
    ],
  },
  {
    label: 'Roles & access',
    category: 'Roles & access',
    permissions: [
      {
        key: 'roles:view',
        label: 'View permissions',
        description: 'Open the workspace permissions page.',
      },
      {
        key: 'roles:create',
        label: 'Create roles',
        description: 'Create custom workspace roles.',
      },
      {
        key: 'roles:update',
        label: 'Update roles',
        description: 'Edit existing workspace roles.',
      },
      {
        key: 'roles:delete',
        label: 'Delete roles',
        description: 'Delete custom workspace roles.',
      },
      {
        key: 'roles:assign',
        label: 'Assign roles',
        description: 'Assign roles to members and invites.',
      },
    ],
  },
  {
    label: 'Projects',
    category: 'Projects',
    permissions: [
      {
        key: 'projects:view',
        label: 'View projects',
        description: 'Open workspace projects.',
      },
      {
        key: 'projects:create',
        label: 'Create projects',
        description: 'Create new workspace projects.',
      },
      {
        key: 'projects:import',
        label: 'Import projects',
        description: 'Import existing repos or local projects into the workspace.',
      },
      {
        key: 'projects:archive',
        label: 'Archive projects',
        description: 'Archive workspace projects.',
      },
      {
        key: 'projects:delete',
        label: 'Delete projects',
        description: 'Delete workspace projects.',
      },
      {
        key: 'projects:share',
        label: 'Share projects',
        description: 'Share projects with other members or invitees.',
      },
    ],
  },
  {
    label: 'Project AI',
    category: 'Project AI',
    permissions: [
      {
        key: 'project_ai:use',
        label: 'Use AI',
        description: 'Use AI features inside projects.',
      },
      {
        key: 'project_ai:use_tools',
        label: 'Use AI tools',
        description: 'Allow AI to use project tools and integrations.',
      },
      {
        key: 'project_ai:use_agents',
        label: 'Use AI agents',
        description: 'Run autonomous or multi-step agents inside projects.',
      },
    ],
  },
  {
    label: 'Workspace AI',
    category: 'Workspace AI',
    permissions: [
      {
        key: 'workspace_ai:view',
        label: 'View AI settings',
        description: 'Open workspace AI settings.',
      },
      {
        key: 'workspace_ai:manage_settings',
        label: 'Manage AI settings',
        description: 'Change workspace AI behavior and defaults.',
      },
      {
        key: 'workspace_ai:manage_model_policy',
        label: 'Manage model policy',
        description: 'Control which models are available in the workspace.',
      },
      {
        key: 'workspace_ai:manage_provider_policy',
        label: 'Manage provider policy',
        description: 'Control which providers and provider methods are available.',
      },
      {
        key: 'workspace_ai:view_usage',
        label: 'View AI usage',
        description: 'View workspace AI usage and consumption.',
      },
    ],
  },
  {
    label: 'Usage & audit',
    category: 'Usage & audit',
    permissions: [
      {
        key: 'usage:view',
        label: 'View usage',
        description: 'Review workspace AI and storage usage.',
      },
      {
        key: 'usage:export',
        label: 'Export usage',
        description: 'Export billing and usage data.',
      },
      {
        key: 'audit:view',
        label: 'View audit logs',
        description: 'Review workspace access and change history.',
      },
    ],
  },
  {
    label: 'Members',
    category: 'Members',
    permissions: [
      {
        key: 'members:view',
        label: 'View members',
        description: 'Open members, roles, and invitations.',
      },
      {
        key: 'members:invite',
        label: 'Invite members',
        description: 'Invite new members into the workspace.',
      },
      {
        key: 'invitations:view',
        label: 'View invites',
        description: 'Open pending workspace invitations.',
      },
      {
        key: 'invitations:send',
        label: 'Send invites',
        description: 'Create new workspace invitations.',
      },
      {
        key: 'members:update_role',
        label: 'Manage member roles',
        description: 'Change workspace role assignments for other members.',
      },
      {
        key: 'members:remove',
        label: 'Remove members',
        description: 'Remove members from the workspace.',
      },
      {
        key: 'invitations:revoke',
        label: 'Revoke invites',
        description: 'Cancel pending workspace invitations.',
      },
    ],
  },
  {
    label: 'Settings & integrations',
    category: 'Settings & integrations',
    permissions: [
      {
        key: 'settings:view',
        label: 'View settings',
        description: 'Open workspace AI and general settings.',
      },
      {
        key: 'settings:update',
        label: 'Manage settings',
        description: 'Change workspace AI and general settings.',
      },
      {
        key: 'settings:manage_api_keys',
        label: 'Manage API keys',
        description: 'Create and rotate workspace API keys.',
      },
      {
        key: 'integrations:view',
        label: 'View integrations',
        description: 'See connected integrations and providers.',
      },
      {
        key: 'integrations:connect',
        label: 'Connect integrations',
        description: 'Connect new integrations and providers.',
      },
      {
        key: 'integrations:disconnect',
        label: 'Disconnect integrations',
        description: 'Disconnect existing integrations and providers.',
      },
    ],
  },
]

export function isOrganizationWorkspaceRole(
  value: string,
): value is OrganizationWorkspaceRole {
  return value === 'admin' || value === 'member' || value === 'viewer'
}

export function hasOrganizationWorkspacePermission(
  roleOrPermissions: OrganizationWorkspaceRole | OrganizationWorkspacePermission[] | null | undefined,
  permission: OrganizationWorkspacePermission,
): boolean {
  if (!roleOrPermissions) return false
  if (Array.isArray(roleOrPermissions)) {
    return roleOrPermissions.includes(permission)
  }
  return ORGANIZATION_WORKSPACE_ROLE_DEFINITIONS[roleOrPermissions].permissions.includes(permission)
}

export function formatOrganizationWorkspaceRole(
  role: string | null | undefined,
  roleName?: string | null,
): string {
  if (roleName) return roleName
  if (!role) return 'Unknown'
  if (!isOrganizationWorkspaceRole(role)) {
    return role.charAt(0).toUpperCase() + role.slice(1)
  }
  return ORGANIZATION_WORKSPACE_ROLE_DEFINITIONS[role].label
}

export interface OrganizationWorkspaceResolvedRole {
  _id?: string
  key: string
  name: string
  description: string
  baseRole: OrganizationWorkspaceRole
  permissions: OrganizationWorkspacePermission[]
  isSystem?: boolean
}

export function getOrganizationWorkspaceRoleAppearance(baseRole: OrganizationWorkspaceRole) {
  const definition = ORGANIZATION_WORKSPACE_ROLE_DEFINITIONS[baseRole]
  const icon = baseRole === 'admin' ? Shield : baseRole === 'member' ? Users : Eye
  return {
    icon,
    badgeClassName: definition.badgeClassName,
    label: definition.label,
  }
}

export function buildOrganizationWorkspaceRoleOptions(
  roles: OrganizationWorkspaceResolvedRole[] | null | undefined,
): OrganizationWorkspaceRoleOption[] {
  if (!roles || roles.length === 0) {
    return ORGANIZATION_WORKSPACE_ROLE_OPTIONS
  }
  return roles.map((role) => ({
    value: role.key,
    roleId: role._id ?? null,
    label: role.name,
    baseRole: role.baseRole,
    icon: getOrganizationWorkspaceRoleAppearance(role.baseRole).icon,
  }))
}

export function summarizeOrganizationWorkspaceAccess(
  permissions: OrganizationWorkspacePermission[] | null | undefined,
): string[] {
  if (!permissions || permissions.length === 0) return []

  const summaries: Array<[string, OrganizationWorkspacePermission[]]> = [
    ['Billing', ['billing:view', 'org:manage_billing', 'billing:manage_subscription', 'billing:manage_seats']],
    ['Members', ['members:view', 'members:invite', 'members:remove', 'invitations:view', 'invitations:send', 'invitations:revoke']],
    ['Permissions', ['roles:view', 'roles:create', 'roles:update', 'roles:delete', 'roles:assign', 'members:update_role']],
    ['Projects', ['projects:view', 'projects:create', 'projects:import', 'projects:archive', 'projects:delete', 'projects:share']],
    ['Project AI', ['project_ai:use', 'project_ai:use_tools', 'project_ai:use_agents']],
    ['Workspace AI', ['workspace_ai:view', 'workspace_ai:manage_settings', 'workspace_ai:manage_model_policy', 'workspace_ai:manage_provider_policy', 'workspace_ai:view_usage']],
    ['Integrations', ['integrations:view', 'integrations:connect', 'integrations:disconnect']],
    ['Usage', ['usage:view', 'usage:export', 'audit:view']],
  ]

  return summaries
    .filter(([, groupPermissions]) => groupPermissions.some((permission) => permissions.includes(permission)))
    .map(([label]) => label)
}
