import {
  getSettingsSurfaceRoute,
  resolveSettingsSurfaceFromRoute,
} from '@/lib/settings/settingsRegistry'

/**
 * Where settings nav should focus: org workspace admin vs user-only vs personal workspace (all user UX).
 * Used so “Workspace settings” and “User settings” never show the other’s items in the same sidebar.
 */
export type SettingsNavChrome =
  | 'personalUnified'
  | 'orgWorkspaceAdmin'
  | 'userSettings'
  | 'mixed'

export function resolveSettingsNavChrome(
  pathname: string,
  workspaceScoped: boolean,
): SettingsNavChrome {
  const p = pathname.replace(/\/+$/, '') || '/'
  if (!workspaceScoped) {
    return 'personalUnified'
  }
  if (
    p.startsWith('/projects/workspace/') ||
    p === '/projects/teams' ||
    p.startsWith('/projects/teams/')
  ) {
    return 'orgWorkspaceAdmin'
  }
  if (p.startsWith('/projects/settings/')) {
    return 'userSettings'
  }
  return 'mixed'
}

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
