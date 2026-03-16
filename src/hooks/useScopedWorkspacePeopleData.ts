import { useMemo } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useHydrateWorkspaceMembers } from '@/hooks/useHydrateWorkspaceMembers'
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

function hasAnyWorkspacePermission(
  permissions: OrganizationWorkspaceResolvedRole['permissions'] | undefined,
  required: readonly OrganizationWorkspaceResolvedRole['permissions'][number][],
) {
  return required.some((permission) =>
    hasOrganizationWorkspacePermission(permissions, permission),
  )
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
  const memberAccessResolved = settingsPage.workspaceAccess.memberAccess !== undefined
  const currentUserPermissions = useMemo(
    () => settingsPage.workspaceAccess.permissions as OrganizationWorkspaceResolvedRole['permissions'] | undefined,
    [settingsPage.workspaceAccess.permissions],
  )

  const canReadMembers = hasAnyWorkspacePermission(currentUserPermissions, [
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
  ])
  const canReadRoles = hasAnyWorkspacePermission(currentUserPermissions, [
    'roles:view',
    'roles:create',
    'roles:update',
    'roles:delete',
    'roles:assign',
    'members:update_role',
    'members:invite',
    'invitations:send',
  ])

  const freshMembers = useQuery(
    api.organizations.getMembers,
    convexOrg?._id && convexUserId && canReadMembers
      ? { orgId: convexOrg._id, viewerUserId: convexUserId }
      : 'skip',
  )
  const membersQuery = useCachedQuery(
    `workspace-members-${options.surfaceId}-${convexOrg?._id ?? 'none'}`,
    freshMembers,
  )
  const members = canReadMembers ? membersQuery : []

  const canViewInvitations = hasAnyWorkspacePermission(currentUserPermissions, [
    'invitations:view',
    'invitations:send',
    'invitations:revoke',
    'members:invite',
    'roles:assign',
    'members:update_role',
  ])

  const freshInvites = useQuery(
    api.invitations.listForOrganization,
    convexOrg?._id && convexUserId && canViewInvitations
      ? { orgId: convexOrg._id, viewerUserId: convexUserId }
      : 'skip',
  )
  const pendingInvitesQuery = useCachedQuery(
    `workspace-invites-${options.surfaceId}-${convexOrg?._id ?? 'none'}`,
    freshInvites,
  )
  const pendingInvites = canViewInvitations ? (pendingInvitesQuery ?? []) : []

  const organizationRolesQuery = useQuery(
    api.organizations.listRoles,
    convexOrg?._id && convexUserId && canReadRoles
      ? { orgId: convexOrg._id, viewerUserId: convexUserId }
      : 'skip',
  )
  const organizationRoles = useMemo(() => canReadRoles ? (organizationRolesQuery ?? []) : [], [canReadRoles, organizationRolesQuery])

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
      canReadRoles
        ? buildOrganizationWorkspaceRoleOptions(
            organizationRoles as OrganizationWorkspaceResolvedRole[] | undefined,
          )
        : [],
    [canReadRoles, organizationRoles],
  )
  const rolesLoaded = !canReadRoles || organizationRolesQuery !== undefined

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

  useHydrateWorkspaceMembers({
    workspaceOrganizationId,
    enabled: Boolean(convexOrg?._id) && memberAccessResolved && canReadMembers,
  })

  const isLoading =
    !memberAccessResolved ||
    (canReadMembers && membersQuery === undefined) ||
    (canReadRoles && organizationRolesQuery === undefined) ||
    (canViewInvitations && pendingInvitesQuery === undefined) ||
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
    pendingInvites,
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
