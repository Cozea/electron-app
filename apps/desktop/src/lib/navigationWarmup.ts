import { localSettings } from '@/lib/settings/localSettings'
import {
  prewarmDestination,
  warmCommonDestinations,
} from '@/app/navigation/destinations'

export function resolveNavigationWarmDestination(pathname: string): string {
  const pathOnly = pathname.split(/[?#]/, 1)[0] ?? pathname
  if (
    pathOnly === '/workbench' ||
    /^\/projects\/(?:p\/)?[^/]+\/workbench(?:\/|$)/.test(pathOnly)
  ) {
    return 'workbench'
  }
  return pathname
}

export function warmNavigationDestination(pathname: string): void {
  void prewarmDestination(resolveNavigationWarmDestination(pathname))
}

export function warmCommonNavigation(): void {
  warmCommonDestinations()
  void localSettings.ensure().catch(() => undefined)
}
