import type { WorkspaceSurfaceAccessState } from '@/lib/settings/settingsSurfaceTypes'
import type { OrganizationWorkspacePermission } from '@/lib/workspaces/organizationRoles'

export interface WorkspaceCapabilities extends WorkspaceSurfaceAccessState {
  canCreateProjects: boolean
  canImportProjects: boolean
  canUseProjectAi: boolean
  canUseProjectAiAgents: boolean
  canUseProjectAiTools: boolean
  canManageWorkspaceAi: boolean
  canManageWorkspaceAiModelPolicy: boolean
  canManageWorkspaceIntegrations: boolean
  canManageWorkspaceMembers: boolean
  canManageWorkspaceRoles: boolean
  canManageWorkspaceSettings: boolean
}

interface ResolveWorkspaceCapabilitiesInput {
  organizationScoped: boolean
  permissions: OrganizationWorkspacePermission[]
}

function hasAnyPermission(
  permissions: readonly OrganizationWorkspacePermission[],
  required: readonly OrganizationWorkspacePermission[]
): boolean {
  return required.some((permission) => permissions.includes(permission))
}

export function resolveWorkspaceCapabilities(
  input: ResolveWorkspaceCapabilitiesInput
): WorkspaceCapabilities {
  const { organizationScoped, permissions } = input

  if (!organizationScoped) {
    return {
      canCreateProjects: true,
      canImportProjects: true,
      canUseProjectAi: true,
      canUseProjectAiAgents: true,
      canUseProjectAiTools: true,
      canViewWorkspaceGeneral: true,
      canViewWorkspaceSettings: true,
      canManageWorkspaceSettings: true,
      canViewWorkspaceAi: true,
      canManageWorkspaceAi: true,
      canManageWorkspaceAiModelPolicy: true,
      canViewWorkspaceUsage: true,
      canManageWorkspaceBilling: true,
      canViewWorkspaceIntegrations: true,
      canManageWorkspaceIntegrations: true,
      canViewWorkspaceMembers: true,
      canManageWorkspaceMembers: true,
      canViewWorkspaceRoles: true,
      canManageWorkspaceRoles: true,
    }
  }

  const canViewWorkspaceGeneral = hasAnyPermission(permissions, ['org:read', 'org:update'])
  const canCreateProjects = hasAnyPermission(permissions, ['projects:create'])
  const canImportProjects = hasAnyPermission(permissions, ['projects:import'])
  const canUseProjectAi = hasAnyPermission(permissions, ['project_ai:use'])
  const canUseProjectAiTools = hasAnyPermission(permissions, ['project_ai:use_tools'])
  const canUseProjectAiAgents = hasAnyPermission(permissions, ['project_ai:use_agents'])
  const canViewWorkspaceSettings = hasAnyPermission(permissions, [
    'settings:view',
    'settings:update',
    'workspace_ai:view',
    'workspace_ai:manage_settings',
    'workspace_ai:manage_model_policy',
    'workspace_ai:manage_provider_policy',
  ])
  const canManageWorkspaceSettings = hasAnyPermission(permissions, ['settings:update'])
  const canViewWorkspaceAi = hasAnyPermission(permissions, [
    'workspace_ai:view',
    'workspace_ai:manage_settings',
    'workspace_ai:manage_model_policy',
    'workspace_ai:manage_provider_policy',
    'workspace_ai:view_usage',
    'settings:view',
    'settings:update',
  ])
  const canManageWorkspaceAi = hasAnyPermission(permissions, [
    'workspace_ai:manage_settings',
    'workspace_ai:manage_model_policy',
    'workspace_ai:manage_provider_policy',
    'settings:update',
  ])
  const canManageWorkspaceAiModelPolicy = hasAnyPermission(permissions, [
    'workspace_ai:manage_model_policy',
    'settings:update',
  ])
  const canViewWorkspaceUsage = hasAnyPermission(permissions, [
    'usage:view',
    'billing:view',
    'workspace_ai:view_usage',
    'org:manage_billing',
  ])
  const canManageWorkspaceBilling = hasAnyPermission(permissions, [
    'org:manage_billing',
    'billing:manage_subscription',
    'billing:manage_seats',
    'billing:manage_payment_method',
  ])
  const canViewWorkspaceIntegrations = hasAnyPermission(permissions, [
    'integrations:view',
    'integrations:connect',
    'integrations:disconnect',
  ])
  const canManageWorkspaceIntegrations = hasAnyPermission(permissions, [
    'integrations:connect',
    'integrations:disconnect',
  ])
  const canViewWorkspaceMembers = hasAnyPermission(permissions, [
    'members:view',
    'members:invite',
    'members:remove',
    'members:update_role',
    'invitations:send',
    'invitations:view',
    'invitations:revoke',
  ])
  const canManageWorkspaceMembers = hasAnyPermission(permissions, [
    'members:invite',
    'invitations:send',
    'members:remove',
    'members:update_role',
    'invitations:revoke',
  ])
  const canViewWorkspaceRoles = hasAnyPermission(permissions, [
    'roles:view',
    'roles:create',
    'roles:update',
    'roles:delete',
    'roles:assign',
    'members:view',
    'members:update_role',
  ])
  const canManageWorkspaceRoles = hasAnyPermission(permissions, [
    'roles:create',
    'roles:update',
    'roles:delete',
    'roles:assign',
    'members:update_role',
  ])

  return {
    canCreateProjects,
    canImportProjects,
    canUseProjectAi,
    canUseProjectAiAgents,
    canUseProjectAiTools,
    canViewWorkspaceGeneral,
    canViewWorkspaceSettings,
    canManageWorkspaceSettings,
    canViewWorkspaceAi,
    canManageWorkspaceAi,
    canManageWorkspaceAiModelPolicy,
    canViewWorkspaceUsage,
    canManageWorkspaceBilling,
    canViewWorkspaceIntegrations,
    canManageWorkspaceIntegrations,
    canViewWorkspaceMembers,
    canManageWorkspaceMembers,
    canViewWorkspaceRoles,
    canManageWorkspaceRoles,
  }
}

export function toWorkspaceSurfaceAccessState(
  capabilities: WorkspaceCapabilities
): WorkspaceSurfaceAccessState {
  return {
    canManageWorkspaceBilling: capabilities.canManageWorkspaceBilling,
    canViewWorkspaceAi: capabilities.canViewWorkspaceAi,
    canViewWorkspaceGeneral: capabilities.canViewWorkspaceGeneral,
    canViewWorkspaceIntegrations: capabilities.canViewWorkspaceIntegrations,
    canViewWorkspaceMembers: capabilities.canViewWorkspaceMembers,
    canViewWorkspaceRoles: capabilities.canViewWorkspaceRoles,
    canViewWorkspaceSettings: capabilities.canViewWorkspaceSettings,
    canViewWorkspaceUsage: capabilities.canViewWorkspaceUsage,
  }
}
