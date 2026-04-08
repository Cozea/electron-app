import { ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { WindowChromeTopInset } from '@/components/window-chrome/WindowChromeTopInset'
import { Account } from '@/pages/settings/Account'
import { Appearance } from '@/pages/settings/Appearance'
import { Storage } from '@/pages/settings/Storage'
import { Tooling } from '@/pages/settings/Tooling'
import { General } from '@/pages/workspace/General'
import { Integrations } from '@/pages/workspace/Integrations'
import { SourceControl } from '@/pages/workspace/SourceControl'
import { Policies } from '@/pages/workspace/Policies'
import { Members } from '@/pages/teams/Members'
import { MemberDetailsContent } from '@/pages/teams/MemberDetails'
import { Roles } from '@/pages/teams/Roles'
import { Billing } from '@/pages/workspace/Billing'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'

import {
  canAccessWorkspaceSurface,
  comparePersonalContextUnifiedSettingsSidebar,
  comparePersonalDeviceSidebarSurfaces,
  compareWorkspaceScopedSidebarSurfaces,
  getSettingsSurfaceDisplayLabel,
  listSettingsSurfaces,
  resolveSettingsSurfaceFromRoute,
} from '@/lib/settings/settingsRegistry'
import { resolveSettingsNavChrome } from '@/lib/workspaces/settingsRoutes'
import {
  useSettingsDrawerStore,
  type SettingsDrawerSection,
} from '@/stores/useSettingsDrawerStore'
import {
  SETTINGS_DRAWER_NAV_ROW_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
} from '@/features/projects/components/sidebar/projectSidebarShared'

function SettingsDrawerBody({ section, route }: { section: SettingsDrawerSection; route: string }) {
  if (section === 'account') {
    return <Account surface="drawer" route={route} />
  }

  if (section === 'billing') {
    return <Billing surface="drawer" route={route} />
  }

  if (section === 'general') {
    return <General surface="drawer" route={route} />
  }

  if (section === 'appearance') {
    return <Appearance surface="drawer" route={route} />
  }

  if (section === 'storage') {
    return <Storage surface="drawer" route={route} />
  }

  if (section === 'cliTools') {
    return <Integrations surface="drawer" route={route} />
  }

  if (section === 'sourceControl') {
    return <SourceControl surface="drawer" route={route} />
  }

  if (section === 'policies') {
    return <Policies surface="drawer" route={route} />
  }

  if (section === 'members') {
    if (route.startsWith('/teams/members/')) {
      return <MemberDetailsContent surface="drawer" route={route} />
    }
    return <Members surface="drawer" route={route} />
  }

  if (section === 'permissions') {
    return <Roles surface="drawer" route={route} />
  }

  return <Tooling surface="drawer" route={route} />
}

function getDrawerSurfaceLabel(
  surface: ReturnType<typeof listSettingsSurfaces>[number],
  scopeKind: 'personal' | 'workspace',
) {
  if (surface.id === 'cliTools') {
    return scopeKind === 'workspace' ? 'Integrations' : 'CLI Tools'
  }

  return getSettingsSurfaceDisplayLabel(surface, scopeKind)
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
  const {
    workspaceScoped,
    personalScoped,
    surfaceAccess,
  } = useScopedAppContext({
    route: routePath || '/settings/account',
  })
  const workspaceDrawerSurfaces = useMemo(() => {
    if (!workspaceScoped) return []
    return listSettingsSurfaces({
      scopeKind: 'workspace',
      placement: 'drawer',
    })
      .filter((surface) => canAccessWorkspaceSurface(surface, surfaceAccess))
      .sort(compareWorkspaceScopedSidebarSurfaces)
  }, [surfaceAccess, workspaceScoped])

  const personalDeviceDrawerSurfaces = useMemo(
    () =>
      [...listSettingsSurfaces({
        scopeKind: 'personal',
        placement: 'drawer',
        sidebarGroup: 'personalDevice',
      })].sort(comparePersonalDeviceSidebarSurfaces),
    [],
  )

  const personalContextUnifiedDrawerSurfaces = useMemo(() => {
    if (workspaceScoped) return []
    const hub = listSettingsSurfaces({
      scopeKind: 'personal',
      placement: 'drawer',
      sidebarGroup: 'personalWorkspace',
    })
    const device = listSettingsSurfaces({
      scopeKind: 'personal',
      placement: 'drawer',
      sidebarGroup: 'personalDevice',
    })
    const seen = new Set<string>()
    const merged: (typeof hub)[number][] = []
    for (const surface of [...hub, ...device]) {
      if (seen.has(surface.id)) continue
      seen.add(surface.id)
      merged.push(surface)
    }
    merged.sort(comparePersonalContextUnifiedSettingsSidebar)
    return merged
  }, [workspaceScoped])

  const drawerPathnameForChrome = useMemo(() => {
    const raw = (routePath.split('?')[0] || '').trim()
    const normalized = raw.startsWith('/') ? raw : `/${raw}`
    if (normalized.startsWith('/projects/')) {
      return normalized.replace(/\/+$/, '') || '/'
    }
    return (`/projects${normalized}`).replace(/\/+$/, '') || '/'
  }, [routePath])

  const settingsNavChrome = resolveSettingsNavChrome(drawerPathnameForChrome, workspaceScoped)

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
        disableAnimation={personalScoped}
        className="inset-0 flex h-screen w-screen max-w-none flex-col gap-0 p-0 sm:max-w-none"
        closeClassName="hidden"
      >
        <SheetHeader className="sr-only">
          <SheetTitle>Settings</SheetTitle>
          <SheetDescription>
            Browse and update account, workspace, billing, integrations, storage, members, and permissions settings.
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
                {settingsNavChrome === 'personalUnified' ? (
                  <>
                    <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">
                      Settings
                    </div>
                    <div className="space-y-1">
                      {personalContextUnifiedDrawerSurfaces.map((item) => {
                        const Icon = item.icon
                        const itemRoute = item.routes.personal
                        if (!itemRoute) {
                          return null
                        }
                        const isActive =
                          resolvedDrawerSurface?.surface.id === item.id || section === item.id

                        return (
                          <button
                            key={itemRoute}
                            type="button"
                            onClick={() => openFromRoute(itemRoute)}
                            onMouseEnter={() => preloadSurface(itemRoute, item.preload)}
                            onFocus={() => preloadSurface(itemRoute, item.preload)}
                            onPointerDown={() => preloadSurface(itemRoute, item.preload)}
                            className={cn(
                              SETTINGS_DRAWER_NAV_ROW_CLASS,
                              isActive && SIDEBAR_PILL_ACTIVE_CLASS,
                            )}
                          >
                            <Icon />
                            <span>{getDrawerSurfaceLabel(item, 'personal')}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : null}
                {settingsNavChrome === 'orgWorkspaceAdmin' ? (
                  <>
                    <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">
                      Workspace
                    </div>
                    <div className="space-y-1">
                      {workspaceDrawerSurfaces.map((item) => {
                        const Icon = item.icon
                        const itemRoute = item.routes.workspace
                        if (!itemRoute) {
                          return null
                        }
                        const isActive =
                          resolvedDrawerSurface?.surface.id === item.id || section === item.id

                        return (
                          <button
                            key={itemRoute}
                            type="button"
                            onClick={() => openFromRoute(itemRoute)}
                            onMouseEnter={() => preloadSurface(itemRoute, item.preload)}
                            onFocus={() => preloadSurface(itemRoute, item.preload)}
                            onPointerDown={() => preloadSurface(itemRoute, item.preload)}
                            className={cn(
                              SETTINGS_DRAWER_NAV_ROW_CLASS,
                              isActive && SIDEBAR_PILL_ACTIVE_CLASS,
                            )}
                          >
                            <Icon />
                            <span>{getDrawerSurfaceLabel(item, 'workspace')}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : null}
                {settingsNavChrome === 'userSettings' && personalDeviceDrawerSurfaces.length > 0 ? (
                  <>
                    <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">
                      User settings
                    </div>
                    <div className="space-y-1">
                      {personalDeviceDrawerSurfaces.map((item) => {
                        const Icon = item.icon
                        const itemRoute = item.routes.personal
                        if (!itemRoute) {
                          return null
                        }
                        const isActive =
                          resolvedDrawerSurface?.surface.id === item.id || section === item.id

                        return (
                          <button
                            key={itemRoute}
                            type="button"
                            onClick={() => openFromRoute(itemRoute)}
                            onMouseEnter={() => preloadSurface(itemRoute, item.preload)}
                            onFocus={() => preloadSurface(itemRoute, item.preload)}
                            onPointerDown={() => preloadSurface(itemRoute, item.preload)}
                            className={cn(
                              SETTINGS_DRAWER_NAV_ROW_CLASS,
                              isActive && SIDEBAR_PILL_ACTIVE_CLASS,
                            )}
                          >
                            <Icon />
                            <span>{getDrawerSurfaceLabel(item, 'personal')}</span>
                          </button>
                        )
                      })}
                    </div>
                  </>
                ) : null}
                {settingsNavChrome === 'mixed' ? (
                  <>
                    <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">
                      Workspace
                    </div>
                    <div className="space-y-1">
                      {workspaceDrawerSurfaces.map((item) => {
                        const Icon = item.icon
                        const itemRoute = item.routes.workspace
                        if (!itemRoute) {
                          return null
                        }
                        const isActive =
                          resolvedDrawerSurface?.surface.id === item.id || section === item.id

                        return (
                          <button
                            key={itemRoute}
                            type="button"
                            onClick={() => openFromRoute(itemRoute)}
                            onMouseEnter={() => preloadSurface(itemRoute, item.preload)}
                            onFocus={() => preloadSurface(itemRoute, item.preload)}
                            onPointerDown={() => preloadSurface(itemRoute, item.preload)}
                            className={cn(
                              SETTINGS_DRAWER_NAV_ROW_CLASS,
                              isActive && SIDEBAR_PILL_ACTIVE_CLASS,
                            )}
                          >
                            <Icon />
                            <span>{getDrawerSurfaceLabel(item, 'workspace')}</span>
                          </button>
                        )
                      })}
                    </div>
                    {personalDeviceDrawerSurfaces.length > 0 ? (
                      <>
                        <div className="mt-3 px-2 py-1 text-xs font-medium text-sidebar-foreground/70">
                          User settings
                        </div>
                        <div className="space-y-1">
                          {personalDeviceDrawerSurfaces.map((item) => {
                            const Icon = item.icon
                            const itemRoute = item.routes.personal
                            if (!itemRoute) {
                              return null
                            }
                            const isActive =
                              resolvedDrawerSurface?.surface.id === item.id || section === item.id

                            return (
                              <button
                                key={itemRoute}
                                type="button"
                                onClick={() => openFromRoute(itemRoute)}
                                onMouseEnter={() => preloadSurface(itemRoute, item.preload)}
                                onFocus={() => preloadSurface(itemRoute, item.preload)}
                                onPointerDown={() => preloadSurface(itemRoute, item.preload)}
                                className={cn(
                                  SETTINGS_DRAWER_NAV_ROW_CLASS,
                                  isActive && SIDEBAR_PILL_ACTIVE_CLASS,
                                )}
                              >
                                <Icon />
                                <span>{getDrawerSurfaceLabel(item, 'personal')}</span>
                              </button>
                            )
                          })}
                        </div>
                      </>
                    ) : null}
                  </>
                ) : null}
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
                <ChevronLeft className="h-4 w-4" />
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
