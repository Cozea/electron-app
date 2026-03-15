import { useMemo } from 'react'

import { useResolvedScope } from '@/hooks/useResolvedScope'
import {
  getSettingsSurface,
  resolveSettingsSurfaceFromRoute,
} from '@/lib/settings/settingsRegistry'
import type {
  SettingsScopeKind,
  SettingsStorageMode,
  SettingsSurfaceDefinition,
  SettingsSurfaceId,
} from '@/lib/settings/settingsSurfaceTypes'

interface UseScopedSettingsSurfaceOptions {
  route?: string
  fallbackSurfaceId?: SettingsSurfaceId
}

export interface ScopedSettingsSurface {
  routePath: string
  scopeKind: SettingsScopeKind
  surface: SettingsSurfaceDefinition | null
  storageMode: SettingsStorageMode | null
  workspaceScoped: boolean
  personalScoped: boolean
  storageScopeKey: string
}

export function useScopedSettingsSurface(
  options: UseScopedSettingsSurfaceOptions = {}
): ScopedSettingsSurface {
  const resolvedScope = useResolvedScope({ route: options.route })

  return useMemo(() => {
    const resolvedRouteSurface =
      resolveSettingsSurfaceFromRoute(resolvedScope.routePath) ??
      (options.fallbackSurfaceId
        ? {
            route: getSettingsSurface(options.fallbackSurfaceId)?.routes[
              resolvedScope.workspaceScoped ? 'workspace' : 'personal'
            ] ?? resolvedScope.routePath,
            scopeKind: (resolvedScope.workspaceScoped ? 'workspace' : 'personal') as SettingsScopeKind,
            surface: getSettingsSurface(options.fallbackSurfaceId)!,
          }
        : null)

    const scopeKind = resolvedRouteSurface?.scopeKind ?? (resolvedScope.workspaceScoped ? 'workspace' : 'personal')
    const surface = resolvedRouteSurface?.surface ?? null
    const storageMode = surface?.storageMode[scopeKind] ?? null

    return {
      routePath: resolvedScope.routePath,
      scopeKind,
      surface,
      storageMode,
      workspaceScoped: scopeKind === 'workspace',
      personalScoped: scopeKind === 'personal',
      storageScopeKey: resolvedScope.scopedOrganizationId ?? 'global',
    }
  }, [
    options.fallbackSurfaceId,
    resolvedScope.routePath,
    resolvedScope.scopedOrganizationId,
    resolvedScope.workspaceScoped,
  ])
}
