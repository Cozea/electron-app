import { useMemo } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { useCachedQuery } from '@/stores/useQueryCache'
import {
  buildOrganizationWorkspaceRoleOptions,
  hasOrganizationWorkspacePermission,
  type OrganizationWorkspaceResolvedRole,
} from '@/lib/workspaces/organizationRoles'
import type { SettingsSurfaceId } from '@/lib/settings/settingsSurfaceTypes'

interface UseScopedWorkspacePeopleDataOptions {
  route: string
  surfaceId: Extract<SettingsSurfaceId, 'members' | 'permissions'>
  includeSeatManagement?: boolean
}

export function useScopedWorkspacePeopleData(options: UseScopedWorkspacePeopleDataOptions) {
  const { convexUserId, user, logout } = useAuth()
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: options.surfaceId,
  })
  const convexOrg = settingsPage.workspaceAccess.convexOrg
  const workspaceOrganizationId = settingsPage.resolvedScope.scopedOrganizationId
  const workspaceName =
    convexOrg?.name ??
    settingsPage.resolvedScope.scopedWorkspace?.organizationName ??
    'Workspace'

  const freshMembers = useQuery(
    api.organizations.getMembers,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip',
  )
  const members = useCachedQuery(
    `workspace-members-${options.surfaceId}-${convexOrg?._id ?? 'none'}`,
    freshMembers,
  )

  const currentUserPermissions = useMemo(
    () => settingsPage.workspaceAccess.permissions as OrganizationWorkspaceResolvedRole['permissions'] | undefined,
    [settingsPage.workspaceAccess.permissions],
  )

  const canViewInvitations = hasOrganizationWorkspacePermission(
    currentUserPermissions,
    'invitations:view',
  )

  const freshInvites = useQuery(
    api.invitations.listForOrganization,
    convexOrg?._id && canViewInvitations ? { orgId: convexOrg._id } : 'skip',
  )
  const pendingInvites = useCachedQuery(
    `workspace-invites-${options.surfaceId}-${convexOrg?._id ?? 'none'}`,
    freshInvites,
  )

  const organizationRoles = useQuery(
    api.organizations.listRoles,
    convexOrg?._id ? { orgId: convexOrg._id } : 'skip',
  )

  const seatManagement = useQuery(
    api.billing.getSeatManagement,
    options.includeSeatManagement &&
      convexOrg?._id &&
      convexUserId &&
      settingsPage.workspaceAccess.memberAccess !== undefined &&
      settingsPage.workspaceAccess.memberAccess !== null
      ? { organizationId: convexOrg._id, userId: convexUserId }
      : 'skip',
  )

  const roleOptions = useMemo(
    () =>
      organizationRoles
        ? buildOrganizationWorkspaceRoleOptions(
            organizationRoles as OrganizationWorkspaceResolvedRole[] | undefined,
          )
        : [],
    [organizationRoles],
  )
  const rolesLoaded = organizationRoles !== undefined

  const hasInvitePermission =
    hasOrganizationWorkspacePermission(currentUserPermissions, 'members:invite') ||
    hasOrganizationWorkspacePermission(currentUserPermissions, 'invitations:send')
  const canInvite = hasInvitePermission && rolesLoaded && roleOptions.length > 0
  const canRemove = hasOrganizationWorkspacePermission(currentUserPermissions, 'members:remove')
  const canUpdateRole = hasOrganizationWorkspacePermission(currentUserPermissions, 'members:update_role')
  const canRevokeInvite = hasOrganizationWorkspacePermission(currentUserPermissions, 'invitations:revoke')
  const canManageRoles =
    hasOrganizationWorkspacePermission(currentUserPermissions, 'roles:update') ||
    hasOrganizationWorkspacePermission(currentUserPermissions, 'members:update_role')
  const canAssignRoles =
    hasOrganizationWorkspacePermission(currentUserPermissions, 'roles:assign') ||
    hasOrganizationWorkspacePermission(currentUserPermissions, 'members:update_role')

  const isLoading =
    members === undefined ||
    organizationRoles === undefined ||
    settingsPage.workspaceAccess.memberAccess === undefined ||
    (canViewInvitations && pendingInvites === undefined) ||
    (options.includeSeatManagement === true && seatManagement === undefined)

  return {
    settingsPage,
    user,
    logout,
    convexUserId,
    convexOrg,
    workspaceOrganizationId,
    workspaceName,
    members,
    pendingInvites: canViewInvitations ? (pendingInvites ?? []) : [],
    organizationRoles,
    roleOptions,
    currentUserPermissions,
    canViewInvitations,
    canInvite,
    canRemove,
    canUpdateRole,
    canRevokeInvite,
    canManageRoles,
    canAssignRoles,
    rolesLoaded,
    seatManagement,
    isLoading,
  }
}
