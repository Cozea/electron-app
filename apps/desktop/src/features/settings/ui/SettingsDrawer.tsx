
import { useCallback, useMemo, useRef } from 'react'

import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { WindowChromeTopInset } from '@/components/window-chrome/WindowChromeTopInset'
import { Account } from '@/features/settings/Account'
import { Appearance } from '@/features/settings/Appearance'
import { DevAppSettings } from '@/features/settings/DevAppSettings'
import { Organizations } from '@/features/settings/Organizations'
import { Tooling } from '@/features/settings/Tooling'
import {
  resolveSettingsSurfaceFromRoute,
} from '@/lib/settings/settingsRegistry'
import { resolveSettingsNavigationSections } from '@/lib/settings/settingsNavigation'
import {
  useSettingsDrawerStore,
  type SettingsDrawerSection,
} from '@/features/settings/model/settingsDrawerStore'
import {
  SETTINGS_DRAWER_NAV_ROW_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
} from '@/features/projects/ui/sidebar/projectSidebarShared'

import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDoubleCloseIcon as __ChevronLeftHugeIcon } from '@hugeicons/core-free-icons'
import { useTranslation } from '@/lib/i18n'

function SettingsDrawerBody({ section, route }: { section: SettingsDrawerSection; route: string }) {
  if (section === 'account') {
    return <Account surface="drawer" route={route} />
  }

  if (section === 'appearance') {
    return <Appearance surface="drawer" route={route} />
  }

  if (section === 'devapps') {
    return <DevAppSettings surface="drawer" route={route} />
  }

  if (section === 'organizations') {
    return <Organizations surface="drawer" route={route} />
  }

  return <Tooling surface="drawer" route={route} />
}

export function SettingsDrawer() {
  const { t, language } = useTranslation()
  const isOpen = useSettingsDrawerStore((state) => state.isOpen)
  const section = useSettingsDrawerStore((state) => state.section)
  const route = useSettingsDrawerStore((state) => state.route)
  const close = useSettingsDrawerStore((state) => state.close)
  const openFromRoute = useSettingsDrawerStore((state) => state.openFromRoute)
  const preloadedRoutesRef = useRef<Set<string>>(new Set())
  const routePath = route.split('?')[0] || route
  const resolvedDrawerSurface = resolveSettingsSurfaceFromRoute(routePath, {
    placement: 'drawer',
  })
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const navSections = useMemo(() => resolveSettingsNavigationSections('drawer'), [language])

  const preloadSurface = useCallback((route: string, preload?: () => Promise<unknown>) => {
    if (!preload) return
    if (preloadedRoutesRef.current.has(route)) return
    preloadedRoutesRef.current.add(route)
    void preload().catch(() => {
      preloadedRoutesRef.current.delete(route)
    })
  }, [])

  return (
    <Sheet open={isOpen} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <SheetContent
        side="right"
        disableAnimation
        className="inset-0 flex h-screen w-screen max-w-none flex-col gap-0 p-0 sm:max-w-none"
        closeClassName="hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>{t('settings.drawer.title')}</SheetTitle>
          <SheetDescription>
            {t('settings.drawer.description')}
          </SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside
            className="relative flex w-56 shrink-0 flex-col bdry-r bdry-sidebar bg-sidebar text-sidebar-foreground"
            style={{
              '--sidebar': 'var(--left-sidebar-surface)',
              '--sidebar-surface': 'var(--left-sidebar-surface)',
              '--sidebar-accent': 'var(--left-sidebar-accent)',
              '--sidebar-border': 'var(--left-sidebar-border)',
            } as React.CSSProperties}
          >
            <WindowChromeTopInset />
            <div className="relative min-h-0 flex-1">
              <div
                className="scroll-fade-y h-full overflow-y-auto scrollbar-hide px-2 py-3"
              >
                {navSections.map((navSection, index) => (
                  <div key={navSection.id} className={cn(index > 0 && 'mt-3')}>
                    <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">
                      {navSection.label}
                    </div>
                    <div className="space-y-1">
                      {navSection.items.map((item) => {
                        const Icon = item.surface.icon
                        const isActive =
                          resolvedDrawerSurface?.surface.id === item.surface.id ||
                          section === item.surface.id

                        return (
                          <button
                            key={item.route}
                            type="button"
                            onClick={() => openFromRoute(item.route)}
                            onMouseEnter={() => preloadSurface(item.route, item.surface.preload)}
                            onFocus={() => preloadSurface(item.route, item.surface.preload)}
                            onPointerDown={() => preloadSurface(item.route, item.surface.preload)}
                            className={cn(
                              SETTINGS_DRAWER_NAV_ROW_CLASS,
                              isActive && SIDEBAR_PILL_ACTIVE_CLASS,
                            )}
                          >
                            <Icon />
                            <span>{item.label}</span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
            <div className="mt-auto p-2 pb-3">
              <button type="button" onClick={close} className={SETTINGS_DRAWER_NAV_ROW_CLASS}>
                <HugeiconsIcon icon={__ChevronLeftHugeIcon} className="h-4 w-4" />
                <span>{t('common.back')}</span>
              </button>
            </div>
          </aside>

          <div className="relative min-w-0 flex-1">
            <div className={cn("h-full overflow-y-auto scrollbar-hide", section !== 'devapps' && "scroll-fade-y")}>
              <SettingsDrawerBody section={section} route={route} />
            </div>
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
