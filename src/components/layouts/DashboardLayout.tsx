import { type ReactNode, useEffect, useState } from "react"
import { Link, useLocation, useNavigate } from "react-router-dom"
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
  useOptionalSidebar,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader"
import { featureFlags } from "@/lib/featureFlags"
import { useWindowsCaptionControlsWidth } from "@/hooks/useWindowsCaptionControlsWidth"
import { useAssistantPanelStore } from "@/stores/useAssistantPanelStore"

interface DashboardLayoutProps {
  children: ReactNode
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  footer?: ReactNode
  breadcrumbs?: { label: string; href?: string }[]
  contentMode?: 'scroll' | 'fixed'
  headerContentInsetClassName?: string
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
  onLogout?: () => void
}

const DEFAULT_BREADCRUMBS = [{ label: "Projects" }];
const FULLSCREEN_SIDEBAR_COLLAPSE_DELAY_MS = 70
const SETTINGS_WINDOW_ITEMS = [
  { href: '/settings/account', label: 'Account' },
  { href: '/settings/billing', label: 'Billing' },
  { href: '/settings/ai', label: 'AI' },
  { href: '/settings/appearance', label: 'Appearance' },
  { href: '/settings/storage', label: 'Storage' },
  { href: '/settings/tooling', label: 'Tooling' },
] as const

interface DashboardLayoutContentProps {
  children: ReactNode
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  footer?: ReactNode
  breadcrumbs: { label: string; href?: string }[]
  contentMode: 'scroll' | 'fixed'
  headerContentInsetClassName?: string
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
  onLogout?: () => void
}

function SidebarFullscreenSync() {
  const assistantPanelMode = useAssistantPanelStore((state) => state.mode)
  const sidebar = useOptionalSidebar()

  useEffect(() => {
    if (!sidebar) return

    const { isMobile, open, setOpen, setOpenMobile } = sidebar

    if (assistantPanelMode !== 'fullscreen') return

    if (isMobile) {
      setOpenMobile(false)
      return
    }

    if (!open) return

    const collapseTimer = window.setTimeout(() => {
      setOpen(false)
    }, FULLSCREEN_SIDEBAR_COLLAPSE_DELAY_MS)

    return () => {
      window.clearTimeout(collapseTimer)
    }
  }, [assistantPanelMode, sidebar])

  return null
}

function DashboardLayoutContent({
  children,
  header,
  breadcrumbAddon,
  footer,
  breadcrumbs,
  contentMode,
  headerContentInsetClassName,
  user,
  onLogout,
}: DashboardLayoutContentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const sidebar = useOptionalSidebar()
  const closeAssistantPanel = useAssistantPanelStore((state) => state.close)
  const windowsCaptionControlsWidth = useWindowsCaptionControlsWidth()
  const [isFullScreen, setIsFullScreen] = useState(false)
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/"
  const isSettingsWindow =
    typeof window !== 'undefined' && window.electronAPI?.windowContext === 'settings'
  const isMacClient = typeof window !== 'undefined' && window.electronAPI?.platform === 'darwin'
  const isWindowsClient = typeof window !== 'undefined' && window.electronAPI?.platform === 'win32'
  const effectiveBreadcrumbAddon =
    normalizedPath === '/settings/ai' || normalizedPath === '/workspace/ai' ? undefined : breadcrumbAddon
  const showHeader = breadcrumbs.length > 0 || Boolean(header) || Boolean(effectiveBreadcrumbAddon)
  const contentTopInsetClassName = headerContentInsetClassName ?? "pt-16"
  const areAllSidebarsCollapsed = sidebar?.state === "collapsed"

  useEffect(() => {
    // Assistant panel is project-scoped and should never be visible in dashboard layout routes.
    closeAssistantPanel()
  }, [closeAssistantPanel])

  useEffect(() => {
    if (!isSettingsWindow || !isMacClient) return

    let isMounted = true

    void window.electronAPI?.window?.isFullScreen?.()
      .then((fullscreen) => {
        if (isMounted) setIsFullScreen(Boolean(fullscreen))
      })
      .catch(() => {
        if (isMounted) setIsFullScreen(false)
      })

    const cleanup = window.electronAPI?.window?.onFullScreenChange?.((fullscreen) => {
      if (isMounted) setIsFullScreen(Boolean(fullscreen))
    })

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [isMacClient, isSettingsWindow])

  useEffect(() => {
    if (!isSettingsWindow) return
    if (normalizedPath.startsWith('/settings/')) return
    navigate('/settings/account', { replace: true })
  }, [isSettingsWindow, navigate, normalizedPath])

  if (isSettingsWindow) {
    const activeSettingsPath = SETTINGS_WINDOW_ITEMS.some((item) => item.href === normalizedPath)
      ? normalizedPath
      : '/settings/account'
    const leftInset = isMacClient ? (isFullScreen ? 8 : 74) : 12
    const rightInset = isWindowsClient ? windowsCaptionControlsWidth : 12

    return (
      <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
        <header className="titlebar-drag-region bdry-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div className="flex h-11 items-center gap-3" style={{ paddingLeft: leftInset, paddingRight: rightInset }}>
            <p className="titlebar-no-drag shrink-0 text-sm font-semibold tracking-tight">
              Settings
            </p>
            <nav className="titlebar-no-drag flex min-w-0 items-center gap-1 rounded-lg bg-muted/70 p-1">
              {SETTINGS_WINDOW_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  to={item.href}
                  className={cn(
                    'rounded-md px-3 py-1 text-xs font-medium transition-colors',
                    activeSettingsPath === item.href
                      ? 'bg-background text-foreground shadow-sm'
                      : 'text-muted-foreground hover:bg-background/70 hover:text-foreground'
                  )}
                >
                  {item.label}
                </Link>
              ))}
            </nav>
          </div>
        </header>

        {contentMode === 'fixed' ? (
          <div
            className={cn(
              'flex flex-1 min-h-0 flex-col overflow-hidden',
              featureFlags.contentVisibility && 'perf-contain-card'
            )}
          >
            {children}
          </div>
        ) : (
          <ScrollArea className={cn('flex-1 app-scroll-area', featureFlags.contentVisibility && 'perf-contain-auto')}>
            <div className={cn('flex min-h-full flex-col', featureFlags.contentVisibility && 'perf-contain-card')}>
              {children}
            </div>
          </ScrollArea>
        )}

        {footer && (
          <div className="flex-none bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
            {footer}
          </div>
        )}
      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
      <SidebarFullscreenSync />
      {/* Main Content with Sidebar */}
      <div className="flex flex-1 overflow-hidden relative">
        <AppSidebar user={user} onLogout={onLogout} />
        <SidebarInset>
          <div className="flex flex-1 flex-col overflow-hidden relative">
            <UnifiedHeader
              breadcrumbs={breadcrumbs}
              header={header}
              breadcrumbAddon={effectiveBreadcrumbAddon}
              leftWindowControlsInset={areAllSidebarsCollapsed}
            />
            {contentMode === 'fixed' ? (
              <div
                className={cn(
                  'flex flex-1 min-h-0 flex-col overflow-hidden',
                  featureFlags.contentVisibility && 'perf-contain-card',
                  showHeader && contentTopInsetClassName
                )}
              >
                {children}
              </div>
            ) : (
              <ScrollArea className={cn('flex-1', featureFlags.contentVisibility && 'perf-contain-auto')}>
                <div
                  className={cn(
                    'flex min-h-full flex-col gap-4 p-4',
                    featureFlags.contentVisibility && 'perf-contain-card',
                    showHeader && contentTopInsetClassName
                  )}
                >
                  {children}
                </div>
              </ScrollArea>
            )}
            {footer && (
              <div className="flex-none bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                {footer}
              </div>
            )}
          </div>
        </SidebarInset>
      </div>
    </div>
  )
}

export function DashboardLayout({
  children,
  header,
  breadcrumbAddon,
  footer,
  breadcrumbs = DEFAULT_BREADCRUMBS,
  contentMode = 'scroll',
  headerContentInsetClassName,
  user,
  onLogout,
}: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <DashboardLayoutContent
        children={children}
        header={header}
        breadcrumbAddon={breadcrumbAddon}
        footer={footer}
        breadcrumbs={breadcrumbs}
        contentMode={contentMode}
        headerContentInsetClassName={headerContentInsetClassName}
        user={user}
        onLogout={onLogout}
      />
    </SidebarProvider>
  )
}
