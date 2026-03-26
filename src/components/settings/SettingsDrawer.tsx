import { ChevronLeft } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { WindowChromeTopInset } from '@/components/window-chrome/WindowChromeTopInset'
import { Account } from '@/pages/settings/Account'
import { Appearance } from '@/pages/settings/Appearance'
import { Storage } from '@/pages/settings/Storage'
import { Tooling } from '@/pages/settings/Tooling'
import { Integrations } from '@/pages/workspace/Integrations'
import { SourceControl } from '@/pages/workspace/SourceControl'
import ModelSelection from "@/pages/settings/ModelSelection"
import { Billing } from '@/pages/workspace/Billing'
import AI from "@/pages/workspace/AI"
import { useAuth } from '@/contexts/AuthContext'
import { useScopedAppContext } from '@/hooks/useScopedAppContext'

import { prewarmCloudStorageData } from '@/hooks/useScopedCloudStorageData'
import {
  canAccessWorkspaceSurface,
  getSettingsSurfaceDisplayLabel,
  listSettingsSurfaces,
  resolveSettingsSurfaceFromRoute,
} from '@/lib/settings/settingsRegistry'
import {
  useSettingsDrawerStore,
  type SettingsDrawerSection,
} from '@/stores/useSettingsDrawerStore'

function SettingsDrawerBody({ section, route }: { section: SettingsDrawerSection; route: string }) {
  if (section === 'account') {
    return <Account surface="drawer" />
  }

  if (section === 'billing') {
    return <Billing surface="drawer" route={route} />
  }

  if (section === 'ai') {
    return <AI />
  }

  if (section === 'modelSelection') {
    return <ModelSelection />
  }

  if (section === 'appearance') {
    return <Appearance surface="drawer" />
  }

  if (section === 'storage') {
    return <Storage surface="drawer" />
  }

  if (section === 'cliTools') {
    return <Integrations surface="drawer" route={route} />
  }

  if (section === 'sourceControl') {
    return <SourceControl surface="drawer" route={route} />
  }

  return <Tooling surface="drawer" route={route} />
}

export function SettingsDrawer() {
  const { convexUserId } = useAuth()
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
    convexOrganizationId,
    surfaceAccess,
  } = useScopedAppContext({
    route: routePath || '/settings/account',
  })
  const settingsDrawerItems = listSettingsSurfaces({
    scopeKind: workspaceScoped ? 'workspace' : 'personal',
    placement: 'drawer',
  }).filter((surface) => {
    if (!workspaceScoped) return true
    return canAccessWorkspaceSurface(surface, surfaceAccess)
  })

  const preloadSurface = useCallback((route: string, preload?: () => Promise<unknown>) => {
    if (!preload) return
    if (preloadedRoutesRef.current.has(route)) return
    preloadedRoutesRef.current.add(route)
    void preload().catch(() => {
      preloadedRoutesRef.current.delete(route)
    })
  }, [])

  const getSurfacePreload = useCallback(
    (
      surface: ReturnType<typeof listSettingsSurfaces>[number]
    ): (() => Promise<unknown>) | undefined => {
      if (surface.id === 'cloudStorage') {
        return async () => {
          await Promise.all([
            surface.preload?.(),
            prewarmCloudStorageData(convexOrganizationId ?? null),
          ])
        }
      }

      if (surface.id === 'ai') {
        return async () => {
          await Promise.all([
            surface.preload?.(),
            Promise.resolve({
              organizationId: convexOrganizationId ?? null,
              userId: convexUserId ?? null,
              range: '30d',
            }),
          ])
        }
      }

      return surface.preload
    },
    [convexOrganizationId, convexUserId]
  )

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
          <SheetDescription>Browse and update account, billing, AI, appearance, storage, CLI tools, and tooling settings.</SheetDescription>
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
                <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">Settings</div>
                <div className="space-y-1">
                  {settingsDrawerItems.map((item) => {
                    const Icon = item.icon
                    const itemRoute = item.routes[workspaceScoped ? 'workspace' : 'personal']
                    if (!itemRoute) {
                      return null
                    }
                    const isActive =
                      resolvedDrawerSurface?.surface.id === item.id || section === item.id

                    return (
                      <button
                        key={itemRoute}
                        type="button"
                        data-active={isActive}
                        onClick={() => openFromRoute(itemRoute)}
                        onMouseEnter={() => preloadSurface(itemRoute, getSurfacePreload(item))}
                        onFocus={() => preloadSurface(itemRoute, getSurfacePreload(item))}
                        onPointerDown={() => preloadSurface(itemRoute, getSurfacePreload(item))}
                        className={cn(
                          'flex h-8 w-full items-center gap-2 overflow-hidden rounded-xl p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0'
                        )}
                      >
                        <Icon className="opacity-60" />
                        <span>{getSettingsSurfaceDisplayLabel(item, workspaceScoped ? 'workspace' : 'personal')}</span>
                      </button>
                    )
                  })}
                </div>
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
              <button
                type="button"
                onClick={close}
                className="flex h-8 w-full items-center gap-2 rounded-xl px-2 text-left text-sm transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground active:bg-sidebar-accent active:text-sidebar-accent-foreground"
              >
                <ChevronLeft className="h-4 w-4 opacity-60" />
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
