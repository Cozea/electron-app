import { useMemo } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useResolvedScope } from '@/hooks/useResolvedScope'
import { useScopedOrganizationData } from '@/hooks/useScopedOrganizationData'
import type { WorkspaceSurfaceAccessState } from '@/lib/settings/settingsSurfaceTypes'
import { useCachedQueryState } from '@/stores/useQueryCache'
import type { OrganizationWorkspacePermission } from '@/lib/workspaces/organizationRoles'
import {
  resolveWorkspaceCapabilities,
  toWorkspaceSurfaceAccessState,
} from '@/lib/workspaces/capabilities'

interface UseScopedAppContextOptions {
  route?: string
}

export function useScopedAppContext(options: UseScopedAppContextOptions = {}) {
  const { convexUserId } = useAuth()
  const resolvedScope = useResolvedScope({ route: options.route })
  const effectiveScopeKind =
    resolvedScope.scopedScopeKind ?? resolvedScope.activeScopeKind ?? null
  const workspaceScoped = effectiveScopeKind === 'workspace'
  const personalScoped = effectiveScopeKind === 'personal'
  const organizationId =
    resolvedScope.scopedOrganizationId ?? resolvedScope.activeOrganizationId ?? null
  const preferredConvexOrganizationId =
    resolvedScope.scopedConvexOrganizationId ??
    resolvedScope.activeConvexOrganizationId ??
    undefined

  const {
    convexOrg,
    hasResolvedOrganization,
    isRefreshingOrganization,
  } = useScopedOrganizationData({
    route: options.route,
    forceOrganizationScope: workspaceScoped,
  })
  const shouldResolveMemberAccess = workspaceScoped && Boolean(convexOrg?._id && convexUserId)

  const freshMemberAccess = useQuery(
    api.organizations.getCurrentMemberAccess,
    shouldResolveMemberAccess && convexOrg?._id && convexUserId
      ? { orgId: convexOrg._id, viewerUserId: convexUserId }
      : 'skip',
  )
  const memberAccessState = useCachedQueryState(
    `app-context-member-access-${convexOrg?._id ?? 'none'}-${convexUserId ?? 'none'}`,
    freshMemberAccess,
  )
  const memberAccess = memberAccessState.data
  const hasResolvedMemberAccess =
    !shouldResolveMemberAccess ||
    memberAccessState.data !== undefined ||
    memberAccessState.hasResolved
  const isRefreshingMemberAccess =
    shouldResolveMemberAccess && memberAccessState.isRefreshing

  const permissions = useMemo(
    () => (memberAccess?.permissions ?? []) as OrganizationWorkspacePermission[],
    [memberAccess?.permissions],
  )
  const capabilities = useMemo(
    () =>
      resolveWorkspaceCapabilities({
        organizationScoped: workspaceScoped,
        permissions,
      }),
    [permissions, workspaceScoped],
  )
  const surfaceAccess = useMemo<WorkspaceSurfaceAccessState>(
    () => toWorkspaceSurfaceAccessState(capabilities),
    [capabilities],
  )
  const workspaceName =
    convexOrg?.name ??
    resolvedScope.scopedWorkspace?.organizationName ??
    resolvedScope.activeWorkspace?.organizationName ??
    'Workspace'
  const hasResolvedWorkspaceAccess =
    !workspaceScoped || hasResolvedMemberAccess
  const hasResolvedContext =
    !workspaceScoped || (hasResolvedOrganization && hasResolvedWorkspaceAccess)
  const isContextRefreshing =
    isRefreshingOrganization || isRefreshingMemberAccess

  return {
    resolvedScope,
    scopeKind: effectiveScopeKind,
    workspaceScoped,
    personalScoped,
    organizationId,
    convexOrganizationId: convexOrg?._id ?? preferredConvexOrganizationId,
    preferredConvexOrganizationId,
    convexOrg,
    workspaceName,
    memberAccess,
    hasResolvedMemberAccess,
    isRefreshingMemberAccess,
    permissions,
    capabilities,
    surfaceAccess,
    hasResolvedWorkspaceAccess,
    hasResolvedContext,
    isContextRefreshing,
  }
}
