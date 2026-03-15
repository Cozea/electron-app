import {
  getSettingsSurfaceRoute,
  resolveSettingsSurfaceFromRoute,
} from '@/lib/settings/settingsRegistry'

export function resolveScopedSettingsHref(href: string, workspaceScoped: boolean): string {
  if (!workspaceScoped) return href

  const [path, query = ''] = href.split('?')
  const resolvedSurface = resolveSettingsSurfaceFromRoute(path)

  if (!resolvedSurface) {
    return href
  }

  const workspaceRoute =
    getSettingsSurfaceRoute(resolvedSurface.surface.id, 'workspace') ?? resolvedSurface.route

  return query ? `${workspaceRoute}?${query}` : workspaceRoute
}
