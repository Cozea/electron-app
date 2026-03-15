import { useMemo } from 'react'
import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useResolvedScope } from '@/hooks/useResolvedScope'
import { useScopedOrganizationData } from '@/hooks/useScopedOrganizationData'
import type { WorkspaceSurfaceAccessState } from '@/lib/settings/settingsSurfaceTypes'
import { useCachedQuery } from '@/stores/useQueryCache'
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

  const { convexOrg } = useScopedOrganizationData({
    route: options.route,
    forceOrganizationScope: workspaceScoped,
  })

  const freshMemberAccess = useQuery(
    api.organizations.getCurrentMemberAccess,
    workspaceScoped && convexOrg?._id && convexUserId
      ? { orgId: convexOrg._id, userId: convexUserId }
      : 'skip',
  )
  const memberAccess = useCachedQuery(
    `app-context-member-access-${convexOrg?._id ?? 'none'}-${convexUserId ?? 'none'}`,
    freshMemberAccess,
  )

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
    permissions,
    capabilities,
    surfaceAccess,
  }
}
