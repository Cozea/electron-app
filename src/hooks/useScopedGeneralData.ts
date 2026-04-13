import { useMemo } from 'react'

import { useAuth } from '@/contexts/AuthContext'
import { useOrganization } from '@/contexts/OrganizationContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
interface UseScopedGeneralDataOptions {
  route?: string
}

export function useScopedGeneralData(options: UseScopedGeneralDataOptions = {}) {
  const { user, logout, convexUserId } = useAuth()
  const {
    updateOrganization: updateWorkosOrganization,
    deleteOrganization: deleteWorkosOrganization,
  } = useOrganization()
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: 'general',
  })
  const convexOrg = settingsPage.workspaceAccess.convexOrg
  const workspaceOrganizationId = settingsPage.resolvedScope.scopedOrganizationId
  const workspaceName = useMemo(
    () =>
      convexOrg?.name ??
      settingsPage.resolvedScope.scopedWorkspace?.organizationName ??
      'Workspace',
    [convexOrg?.name, settingsPage.resolvedScope.scopedWorkspace?.organizationName],
  )
  const canManageGeneral = useMemo(() => {
    if (!settingsPage.workspaceScoped) {
      return true
    }

    return settingsPage.workspaceAccess.permissions.includes('org:update')
  }, [settingsPage.workspaceAccess.permissions, settingsPage.workspaceScoped])

  return {
    settingsPage,
    user,
    logout,
    convexUserId,
    convexOrg,
    workspaceOrganizationId,
    workspaceName,
    canManageGeneral,
    updateWorkosOrganization,
    deleteWorkosOrganization,
    isLoading: convexOrg === undefined && !settingsPage.hasResolvedContext,
    isRefreshing: settingsPage.isContextRefreshing,
  }
}
