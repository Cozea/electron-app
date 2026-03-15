import { useQuery } from 'convex/react'

import { api } from '../../convex/_generated/api'
import { useAuth } from '@/contexts/AuthContext'
import { useHydrateWorkspaceMembers } from '@/hooks/useHydrateWorkspaceMembers'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { getSettingsSurfaceRoute } from '@/lib/settings/settingsRegistry'

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

  const membersQuery = useQuery(
    api.organizations.getMembers,
    convexOrg?._id &&
    convexUserId &&
    canLoadWorkspaceBillingData &&
    canViewWorkspaceMembers
      ? { orgId: convexOrg._id, viewerUserId: convexUserId }
      : 'skip',
  )
  const members = canViewWorkspaceMembers ? membersQuery : []
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

  const seatManagement = useQuery(
    api.billing.getSeatManagement,
    billingViewerArgs,
  )

  const walletSummary = useQuery(
    api.aiWallets.getWalletForViewer,
    billingViewerArgs,
  )

  const seatWallets = useQuery(
    api.aiWallets.getSeatWalletsForViewer,
    workspaceScoped ? billingViewerArgs : 'skip',
  )

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
    walletSummary,
    seatWallets,
  }
}
