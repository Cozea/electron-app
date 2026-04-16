
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { WindowChromeTopInset } from '@/components/window-chrome/WindowChromeTopInset'
import { Account } from '@/pages/settings/Account'
import { Appearance } from '@/pages/settings/Appearance'
import { Tooling } from '@/pages/settings/Tooling'
import {

  resolveSettingsSurfaceFromRoute,
} from '@/lib/settings/settingsRegistry'
import { resolveSettingsNavigationSections } from '@/lib/settings/settingsNavigation'
import {
  useSettingsDrawerStore,
  type SettingsDrawerSection,
} from '@/stores/useSettingsDrawerStore'
import {
  SETTINGS_DRAWER_NAV_ROW_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
} from '@/features/projects/components/sidebar/projectSidebarShared'

import { HugeiconsIcon } from '@hugeicons/react'
import { ChevronDoubleCloseIcon as __ChevronLeftHugeIcon } from '@hugeicons/core-free-icons'

function SettingsDrawerBody({ section, route }: { section: SettingsDrawerSection; route: string }) {
  if (section === 'account') {
    return <Account surface="drawer" route={route} />
  }

  if (section === 'appearance') {
    return <Appearance surface="drawer" route={route} />
  }


  return <Tooling surface="drawer" route={route} />
}

export function SettingsDrawer() {
  const isOpen = useSettingsDrawerStore((state) => state.isOpen)
  const section = useSettingsDrawerStore((state) => state.section)
  const route = useSettingsDrawerStore((state) => state.route)
  const close = useSettingsDrawerStore((state) => state.close)
  const openFromRoute = useSettingsDrawerStore((state) => state.openFromRoute)
  const preloadedRoutesRef = useRef<Set<string>>(new Set())
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const [showSidebarTopFade, setShowSidebarTopFade] = useState(false)
  const [showSidebarBottomFade, setShowSidebarBottomFade] = useState(false)
  const [showContentTopFade, setShowContentTopFade] = useState(false)
  const [showContentBottomFade, setShowContentBottomFade] = useState(false)
  const routePath = route.split('?')[0] || route
  const resolvedDrawerSurface = resolveSettingsSurfaceFromRoute(routePath, {
    placement: 'drawer',
  })
  const navSections = useMemo(() => resolveSettingsNavigationSections('drawer'), [])

  const preloadSurface = useCallback((route: string, preload?: () => Promise<unknown>) => {
    if (!preload) return
    if (preloadedRoutesRef.current.has(route)) return
    preloadedRoutesRef.current.add(route)
    void preload().catch(() => {
      preloadedRoutesRef.current.delete(route)
    })
  }, [])

  useEffect(() => {
    const updateFades = (
      element: HTMLDivElement | null,
      setTop: (value: boolean) => void,
      setBottom: (value: boolean) => void
    ) => {
      if (!element) {
        setTop(false)
        setBottom(false)
        return
      }

      const { scrollTop, scrollHeight, clientHeight } = element
      const canScroll = scrollHeight - clientHeight > 1

      setTop(canScroll && scrollTop > 2)
      setBottom(canScroll && scrollTop + clientHeight < scrollHeight - 2)
    }

    const sidebarElement = sidebarScrollRef.current
    const contentElement = contentScrollRef.current

    const handleSidebarScroll = () => {
      updateFades(sidebarElement, setShowSidebarTopFade, setShowSidebarBottomFade)
    }
    const handleContentScroll = () => {
      updateFades(contentElement, setShowContentTopFade, setShowContentBottomFade)
    }

    handleSidebarScroll()
    handleContentScroll()

    sidebarElement?.addEventListener('scroll', handleSidebarScroll, { passive: true })
    contentElement?.addEventListener('scroll', handleContentScroll, { passive: true })

    const resizeObserver =
      typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            handleSidebarScroll()
            handleContentScroll()
          })
        : null

    if (resizeObserver) {
      if (sidebarElement) resizeObserver.observe(sidebarElement)
      if (contentElement) resizeObserver.observe(contentElement)
    }

    return () => {
      sidebarElement?.removeEventListener('scroll', handleSidebarScroll)
      contentElement?.removeEventListener('scroll', handleContentScroll)
      resizeObserver?.disconnect()
    }
  }, [isOpen, section, route])

  return (
    <Sheet open={isOpen} onOpenChange={(nextOpen) => !nextOpen && close()}>
      <SheetContent
        side="right"
        disableAnimation
        className="inset-0 flex h-screen w-screen max-w-none flex-col gap-0 p-0 sm:max-w-none"
        closeClassName="hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Browse and update device, appearance, storage, and tooling settings.
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
                ref={sidebarScrollRef}
                className="h-full overflow-y-auto scrollbar-hide px-2 py-3"
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
              <div
                className={cn(
                  'pointer-events-none absolute left-0 right-0 top-0 h-8 bg-gradient-to-b from-sidebar to-transparent transition-opacity duration-150',
                  showSidebarTopFade ? 'opacity-100' : 'opacity-0'
                )}
              />
              <div
                className={cn(
                  'pointer-events-none absolute left-0 right-0 bottom-0 h-8 bg-gradient-to-t from-sidebar to-transparent transition-opacity duration-150',
                  showSidebarBottomFade ? 'opacity-100' : 'opacity-0'
                )}
              />
            </div>
            <div className="mt-auto p-2 pb-3">
              <button type="button" onClick={close} className={SETTINGS_DRAWER_NAV_ROW_CLASS}>
                <HugeiconsIcon icon={__ChevronLeftHugeIcon} className="h-4 w-4" />
                <span>Back</span>
              </button>
            </div>
          </aside>

          <div className="relative min-w-0 flex-1">
            <div ref={contentScrollRef} className="h-full overflow-y-auto scrollbar-hide">
              <SettingsDrawerBody section={section} route={route} />
            </div>
            <div
              className={cn(
                'pointer-events-none absolute left-0 right-0 top-0 h-8 bg-gradient-to-b from-background to-transparent transition-opacity duration-150',
                showContentTopFade ? 'opacity-100' : 'opacity-0'
              )}
            />
            <div
              className={cn(
                'pointer-events-none absolute left-0 right-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent transition-opacity duration-150',
                showContentBottomFade ? 'opacity-100' : 'opacity-0'
              )}
            />
          </div>
        </div>
      </SheetContent>
    </Sheet>
  )
}
