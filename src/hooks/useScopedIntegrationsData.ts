import { useAuth } from '@/contexts/AuthContext'
import { useScopedSettingsPage } from '@/hooks/useScopedSettingsPage'
import { useIntegrations } from '@/hooks/useIntegrations'

interface UseScopedIntegrationsDataOptions {
  route?: string
}

export function useScopedIntegrationsData(options: UseScopedIntegrationsDataOptions = {}) {
  const settingsPage = useScopedSettingsPage({
    route: options.route,
    surfaceId: 'cliTools',
  })
  const { user, logout } = useAuth()
  const integrationsState = useIntegrations({
    route: settingsPage.routePath,
    enabled: !settingsPage.isWorkspaceAccessDenied,
  })

  return {
    settingsPage,
    user,
    logout,
    ...integrationsState,
  }
}
