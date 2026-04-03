import { useMemo } from 'react'

import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { getSettingsSurfaceRoute } from '@/lib/settings/settingsRegistry'

interface UseAiExecutionScopeOptions {
  route?: string
  requireProjectAccess?: boolean
}

export function useAiExecutionScope(options: UseAiExecutionScopeOptions = {}) {
  const { requireProjectAccess = false } = options
  const appContext = useScopedAppContext({ route: options.route })
  const scopeKind = appContext.workspaceScoped ? 'workspace' : 'personal'

  const canUseAi = useMemo(() => {
    if (!appContext.workspaceScoped) {
      return true
    }

    if (requireProjectAccess) {
      return appContext.capabilities.canUseProjectAi
    }

    return (
      appContext.capabilities.canUseProjectAi ||
      appContext.capabilities.canViewWorkspaceAi
    )
  }, [
    appContext.capabilities.canUseProjectAi,
    appContext.capabilities.canViewWorkspaceAi,
    appContext.workspaceScoped,
    requireProjectAccess,
  ])

  return {
    ...appContext,
    canUseAi,
    canUseTools: appContext.workspaceScoped
      ? appContext.capabilities.canUseProjectAiTools
      : true,
    canUseAgents: appContext.workspaceScoped
      ? appContext.capabilities.canUseProjectAiAgents
      : true,
    billingHref:
      getSettingsSurfaceRoute('billing', scopeKind) ?? '/settings/billing',
  }
}
