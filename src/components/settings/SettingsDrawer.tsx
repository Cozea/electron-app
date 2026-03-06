import { Bot, ChevronLeft, CreditCard, HardDrive, Palette, SlidersHorizontal, Terminal, UserCircle2 } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'

import { cn } from '@/lib/utils'
import { Sheet, SheetContent } from '@/components/ui/sheet'
import { Account } from '@/pages/settings/Account'
import { Appearance } from '@/pages/settings/Appearance'
import { Storage } from '@/pages/settings/Storage'
import { Tooling } from '@/pages/settings/Tooling'
import { ModelSelection } from '@/pages/settings/ModelSelection'
import { Billing } from '@/pages/workspace/Billing'
import { AI } from '@/pages/workspace/AI'
import {
  useSettingsDrawerStore,
  type SettingsDrawerSection,
} from '@/stores/useSettingsDrawerStore'

interface SettingsDrawerItem {
  section: SettingsDrawerSection
  label: string
  icon: typeof UserCircle2
  route: string
  isActive?: (routePath: string) => boolean
}

const SETTINGS_DRAWER_ITEMS: SettingsDrawerItem[] = [
  { section: 'account', label: 'Account', icon: UserCircle2, route: '/settings/account' },
  { section: 'billing', label: 'Billing', icon: CreditCard, route: '/settings/billing' },
  {
    section: 'ai',
    label: 'AI',
    icon: Bot,
    route: '/settings/ai',
    isActive: (routePath) => routePath === '/settings/ai' || routePath === '/workspace/ai',
  },
  {
    section: 'ai',
    label: 'Model Selection',
    icon: SlidersHorizontal,
    route: '/settings/ai/model-selection',
    isActive: (routePath) =>
      routePath.startsWith('/settings/ai/model-selection') ||
      routePath.startsWith('/workspace/ai/model-selection'),
  },
  { section: 'appearance', label: 'Appearance', icon: Palette, route: '/settings/appearance' },
  { section: 'storage', label: 'Storage', icon: HardDrive, route: '/settings/storage' },
  { section: 'tooling', label: 'Tooling', icon: Terminal, route: '/settings/tooling' },
]

function SettingsDrawerBody({ section, route }: { section: SettingsDrawerSection; route: string }) {
  const routePath = route.split('?')[0] || route

  if (section === 'account') {
    return <Account surface="drawer" />
  }

  if (section === 'billing') {
    return <Billing surface="drawer" route={route} />
  }

  if (section === 'ai') {
    if (routePath.startsWith('/settings/ai/model-selection')) {
      return <ModelSelection surface="drawer" />
    }
    return <AI surface="drawer" />
  }

  if (section === 'appearance') {
    return <Appearance surface="drawer" />
  }

  if (section === 'storage') {
    return <Storage surface="drawer" />
  }

  return <Tooling surface="drawer" />
}

export function SettingsDrawer() {
  const isOpen = useSettingsDrawerStore((state) => state.isOpen)
  const section = useSettingsDrawerStore((state) => state.section)
  const route = useSettingsDrawerStore((state) => state.route)
  const close = useSettingsDrawerStore((state) => state.close)
  const openFromRoute = useSettingsDrawerStore((state) => state.openFromRoute)
  const isMacClient = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  const sidebarScrollRef = useRef<HTMLDivElement | null>(null)
  const contentScrollRef = useRef<HTMLDivElement | null>(null)
  const [showSidebarTopFade, setShowSidebarTopFade] = useState(false)
  const [showSidebarBottomFade, setShowSidebarBottomFade] = useState(false)
  const [showContentTopFade, setShowContentTopFade] = useState(false)
  const [showContentBottomFade, setShowContentBottomFade] = useState(false)
  const routePath = route.split('?')[0] || route

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
        className="inset-0 flex h-screen w-screen max-w-none flex-col gap-0 p-0 sm:max-w-none"
        closeClassName="hidden"
      >
        <div className="flex min-h-0 flex-1 overflow-hidden">
          <aside className="relative flex w-56 shrink-0 flex-col bdry-r bdry-sidebar [--sidebar:var(--left-sidebar-surface)] bg-sidebar text-sidebar-foreground">
            <div className="relative min-h-0 flex-1">
              <div
                ref={sidebarScrollRef}
                className={cn(
                  'h-full overflow-y-auto scrollbar-hide px-2 py-3',
                  isMacClient && 'pt-9'
                )}
              >
                <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">Settings</div>
                <div className="space-y-1">
                  {SETTINGS_DRAWER_ITEMS.map((item) => {
                    const Icon = item.icon
                    const isActive = item.isActive
                      ? item.isActive(routePath)
                      : routePath === item.route || section === item.section

                    return (
                      <button
                        key={item.route}
                        type="button"
                        data-active={isActive}
                        onClick={() => openFromRoute(item.route)}
                        className={cn(
                          'flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-foreground/10 hover:text-sidebar-foreground focus-visible:ring-2 active:bg-foreground/14 active:text-sidebar-foreground data-[active=true]:bg-foreground/14 data-[active=true]:font-medium data-[active=true]:text-sidebar-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0'
                        )}
                      >
                        <Icon className="opacity-60" />
                        <span>{item.label}</span>
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
                className="flex h-8 w-full items-center gap-2 rounded-md px-2 text-left text-sm transition-colors hover:bg-foreground/10 hover:text-sidebar-foreground"
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
