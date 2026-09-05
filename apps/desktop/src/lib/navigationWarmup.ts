import { localSettings } from '@/lib/settings/localSettings'
import { settingsModules } from '@/lib/settings/settingsModules'

const warmed = new Set<string>()
const destinations: Record<string, () => Promise<unknown>> = {
  '/projects/store': () => import('@/features/devapps/pages/AppStorePage'),
  '/projects/skills': () => import('@/features/projects/pages/AgentSkillsPage'),
  '/projects/new': () => import('@/pages/NewProject'),
  ...Object.fromEntries(Object.entries(settingsModules).map(([name, load]) => [`/projects/settings/${name}`, load])),
}

export function warmNavigationDestination(pathname: string): void {
  const load = destinations[pathname]
  if (!load || warmed.has(pathname)) return
  warmed.add(pathname)
  void load().catch(() => warmed.delete(pathname))
}

export function warmCommonNavigation(): void {
  for (const pathname of ['/projects/store', '/projects/skills', '/projects/settings/account', '/projects/settings/appearance']) {
    warmNavigationDestination(pathname)
  }
  void localSettings.ensure().catch(() => undefined)
}
