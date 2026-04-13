import { useMemo } from 'react'

import { useScopedAppContext } from '@/hooks/useScopedAppContext'
import { useScopedSettingsSurface } from '@/hooks/useScopedSettingsSurface'
import {
  canAccessWorkspaceSurface,
  getSettingsSurface,
  getSettingsSurfaceBreadcrumbs,
} from '@/lib/settings/settingsRegistry'
import type { SettingsSurfaceId } from '@/lib/settings/settingsSurfaceTypes'

interface UseScopedSettingsPageOptions {
  route?: string
  surfaceId: SettingsSurfaceId
}

export function useScopedSettingsPage(options: UseScopedSettingsPageOptions) {
  const { route, surfaceId } = options
  const appContext = useScopedAppContext({ route })
  const scopedSettingsSurface = useScopedSettingsSurface({
    route,
    fallbackSurfaceId: surfaceId,
  })
  const workspaceAccess = useMemo(
    () => ({
      organizationScoped: scopedSettingsSurface.workspaceScoped,
      workspaceScoped: scopedSettingsSurface.workspaceScoped,
      scopedOrganizationId: appContext.resolvedScope.scopedOrganizationId,
      convexOrg: appContext.convexOrg,
      memberAccess: appContext.memberAccess,
      permissions: appContext.permissions,
      surfaceAccess: appContext.surfaceAccess,
      ...appContext.capabilities,
    }),
    [
      appContext.capabilities,
      appContext.convexOrg,
      appContext.memberAccess,
      appContext.permissions,
      appContext.resolvedScope.scopedOrganizationId,
      appContext.surfaceAccess,
      scopedSettingsSurface.workspaceScoped,
    ],
  )

  const surface = getSettingsSurface(surfaceId)
  const breadcrumbs = useMemo(
    () => getSettingsSurfaceBreadcrumbs(surfaceId, scopedSettingsSurface.scopeKind),
    [scopedSettingsSurface.scopeKind, surfaceId],
  )
  const isWorkspaceAccessDenied = useMemo(() => {
    if (!scopedSettingsSurface.workspaceScoped || !surface) {
      return false
    }

    if (!appContext.hasResolvedWorkspaceAccess) {
      return false
    }

    return !canAccessWorkspaceSurface(surface, workspaceAccess.surfaceAccess)
  }, [
    appContext.hasResolvedWorkspaceAccess,
    scopedSettingsSurface.workspaceScoped,
    surface,
    workspaceAccess.surfaceAccess,
  ])

  return {
    ...scopedSettingsSurface,
    resolvedScope: appContext.resolvedScope,
    workspaceAccess,
    breadcrumbs,
    isWorkspaceAccessDenied,
    hasResolvedContext: appContext.hasResolvedContext,
    isContextRefreshing: appContext.isContextRefreshing,
    hasResolvedWorkspaceAccess: appContext.hasResolvedWorkspaceAccess,
  }
}
