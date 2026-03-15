import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { getSettingsSurfaceRoute } from '@/lib/settings/settingsRegistry'

interface UseScopedPoliciesDataOptions {
  route?: string
}

const WORKSPACE_POLICIES_ROUTE =
  getSettingsSurfaceRoute('policies', 'workspace') ?? '/workspace/policies'

export function useScopedPoliciesData(options: UseScopedPoliciesDataOptions = {}) {
  const settingsPage = useScopedSettingsPage({
    route: options.route ?? WORKSPACE_POLICIES_ROUTE,
    surfaceId: 'policies',
  })
  const { user, logout } = useAuth()
  const workspaceName =
    settingsPage.workspaceAccess.convexOrg?.name ??
    settingsPage.resolvedScope.scopedWorkspace?.organizationName ??
    'Workspace'

  return {
    settingsPage,
    user,
    logout,
    workspaceName,
  }
}
