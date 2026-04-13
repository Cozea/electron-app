import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useHydrateWorkspaceMembers } from '@/hooks/useHydrateWorkspaceMembers'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import {
  getSeatManagementCacheKey,
} from '@/lib/queryCacheKeys'
import { getSettingsSurfaceRoute } from '@/lib/settings/settingsRegistry'
import { useCachedQueryState } from '@/stores/useQueryCache'

interface UseScopedBillingDataOptions {
  route?: string
}

const WORKSPACE_BILLING_ROUTE =
  getSettingsSurfaceRoute('billing', 'workspace') ?? '/workspace/billing'
const PERSONAL_BILLING_ROUTE =
  getSettingsSurfaceRoute('billing', 'personal') ?? '/settings/billing'

export function useScopedBillingData(options: UseScopedBillingDataOptions = {}) {
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: 'billing',
  })
  const {
    user,
    logout,
    convexUserId,
    accessToken,
  } = useAuth()
  const {
    convexOrg,
    canManageWorkspaceBilling,
  } = settingsPage.workspaceAccess
  const scopedWorkspace = settingsPage.resolvedScope.scopedWorkspace
  const workspaceScoped = settingsPage.workspaceScoped
  const billingOrganizationId = scopedWorkspace?.organizationId ?? null
  const canLoadWorkspaceBillingData = !settingsPage.isWorkspaceAccessDenied
  const canViewWorkspaceMembers = settingsPage.workspaceAccess.permissions.includes('members:view')
  const billingRoute =
    settingsPage.surface?.routes[settingsPage.scopeKind] ??
    (workspaceScoped ? WORKSPACE_BILLING_ROUTE : PERSONAL_BILLING_ROUTE)

  const membersQuery = useQuery<any>(
    api.organizations.getMembers,
    convexOrg?._id &&
    convexUserId &&
    canLoadWorkspaceBillingData &&
    canViewWorkspaceMembers
      ? { orgId: convexOrg._id, viewerUserId: convexUserId }
      : 'skip',
  )
  const membersState = useCachedQueryState(
    `billing-members-${convexOrg?._id ?? 'none'}-${convexUserId ?? 'none'}`,
    membersQuery,
  )
  const members = canViewWorkspaceMembers ? (membersState.data ?? []) : []
  const memberAccessResolved = settingsPage.workspaceAccess.memberAccess !== undefined
  const canLoadPersonalBillingData =
    !workspaceScoped &&
    Boolean(convexOrg?._id) &&
    Boolean(convexUserId) &&
    canLoadWorkspaceBillingData
  const canLoadWorkspaceViewerBillingData =
    workspaceScoped &&
    Boolean(convexOrg?._id) &&
    Boolean(convexUserId) &&
    canLoadWorkspaceBillingData &&
    memberAccessResolved &&
    settingsPage.workspaceAccess.memberAccess !== null

  const billingViewerArgs =
    (canLoadPersonalBillingData || canLoadWorkspaceViewerBillingData) &&
    convexOrg?._id &&
    convexUserId
      ? { organizationId: convexOrg._id, userId: convexUserId }
      : 'skip'

  useHydrateWorkspaceMembers({
    workspaceOrganizationId: billingOrganizationId,
    enabled:
      workspaceScoped &&
      canLoadWorkspaceBillingData &&
      memberAccessResolved &&
      canViewWorkspaceMembers,
  })

  const freshSeatManagement = useQuery<any>(
    api.billing.getSeatManagement,
    billingViewerArgs,
  )
  const seatManagementState = useCachedQueryState(
    getSeatManagementCacheKey(convexOrg?._id, convexUserId),
    freshSeatManagement,
  )
  const seatManagement = seatManagementState.data

  return {
    settingsPage,
    user,
    logout,
    convexUserId,
    accessToken,
    convexOrg,
    scopedWorkspace,
    workspaceScoped,
    canManageWorkspaceBilling,
    billingOrganizationId,
    canLoadWorkspaceBillingData,
    billingRoute,
    members,
    seatManagement,
    hasResolvedMembers:
      !canViewWorkspaceMembers ||
      membersState.data !== undefined ||
      membersState.hasResolved,
    isRefreshingMembers: membersState.isRefreshing,
    hasResolvedSeatManagement:
      seatManagementState.data !== undefined || seatManagementState.hasResolved,
    isRefreshingSeatManagement: seatManagementState.isRefreshing,
  }
}
