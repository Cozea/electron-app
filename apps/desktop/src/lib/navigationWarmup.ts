import { localSettings } from '@/lib/settings/localSettings'
import {
  prewarmDestination,
  warmCommonDestinations,
} from '@/app/navigation/destinations'

export function warmNavigationDestination(pathname: string): void {
  void prewarmDestination(pathname.startsWith('/workbench') ? 'workbench' : pathname)
}

export function warmCommonNavigation(): void {
  warmCommonDestinations()
  void localSettings.ensure().catch(() => undefined)
}
