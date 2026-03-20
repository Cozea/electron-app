import { type ReactNode, useEffect } from "react"
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
import { StatusBar } from "@/components/StatusBar"
import { featureFlags } from "@/lib/featureFlags"
import {
  getSettingsSurfaceRoute,
  listSettingsSurfaces,
} from "@/lib/settings/settingsRegistry"
import { useWindowChrome } from "@/hooks/useWindowChrome"
import { useWindowsCaptionControlsWidth } from "@/hooks/useWindowsCaptionControlsWidth"
import { useAssistantPanelStore } from "@/stores/useAssistantPanelStore"
import { useResolvedScope } from "@/hooks/useResolvedScope"
import { Building2, Layers3, UserRound } from "lucide-react"

interface DashboardLayoutProps {
  children: ReactNode
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  footer?: ReactNode
  breadcrumbs?: { label: string; href?: string }[]
  contentMode?: 'scroll' | 'fixed'
  headerContentInsetClassName?: string
  hideInbox?: boolean
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
const PERSONAL_ACCOUNT_ROUTE = getSettingsSurfaceRoute('account', 'personal') ?? '/settings/account'
const PERSONAL_AI_ROUTE = getSettingsSurfaceRoute('ai', 'personal') ?? '/settings/ai'
const WORKSPACE_AI_ROUTE = getSettingsSurfaceRoute('ai', 'workspace') ?? '/workspace/ai'
const SETTINGS_WINDOW_ITEMS = listSettingsSurfaces({
  scopeKind: 'personal',
  placement: 'settingsWindow',
}).map((surface) => ({
  href: surface.routes.personal!,
  label: surface.label,
}))

interface DashboardLayoutContentProps {
  children: ReactNode
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  footer?: ReactNode
  breadcrumbs: { label: string; href?: string }[]
  contentMode: 'scroll' | 'fixed'
  headerContentInsetClassName?: string
  hideInbox?: boolean
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
  hideInbox,
  user,
  onLogout,
}: DashboardLayoutContentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const closeAssistantPanel = useAssistantPanelStore((state) => state.close)
  const windowChrome = useWindowChrome()
  const windowsCaptionControlsWidth = useWindowsCaptionControlsWidth()
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/"
  const { activeWorkspace, activeScopeKind } = useResolvedScope({ ignoreLocation: true })
  const isSettingsWindow = windowChrome.windowContext === 'settings'
  const isMacClient = windowChrome.isMac
  const isWindowsClient = windowChrome.isWindows
  const effectiveBreadcrumbAddon =
    normalizedPath === PERSONAL_AI_ROUTE || normalizedPath === WORKSPACE_AI_ROUTE
      ? undefined
      : breadcrumbAddon
  const showHeader = breadcrumbs.length > 0 || Boolean(header) || Boolean(effectiveBreadcrumbAddon)
  const contentTopInsetClassName = headerContentInsetClassName ?? "pt-16"
  const activeLabel = breadcrumbs[breadcrumbs.length - 1]?.label ?? 'Projects'
  const workspaceLabel = activeWorkspace?.organizationName ?? 'Workspace'
  const workspaceIcon = activeScopeKind === 'personal' ? UserRound : Building2
  const statusBar = (
    <StatusBar
      leftItems={[{ icon: Layers3, label: activeLabel }]}
      rightItems={[
        { icon: workspaceIcon, label: workspaceLabel },
        { label: 'Cozea' },
      ]}
    />
  )
  useEffect(() => {
    // Assistant panel is project-scoped and should never be visible in dashboard layout routes.
    closeAssistantPanel()
  }, [closeAssistantPanel])

  useEffect(() => {
    if (!isSettingsWindow) return
    if (normalizedPath.startsWith('/settings/')) return
    navigate(PERSONAL_ACCOUNT_ROUTE, { replace: true })
  }, [isSettingsWindow, navigate, normalizedPath])

  if (isSettingsWindow) {
    const activeSettingsPath = SETTINGS_WINDOW_ITEMS.some((item) => item.href === normalizedPath)
      ? normalizedPath
      : PERSONAL_ACCOUNT_ROUTE
    const leftInset = isMacClient ? windowChrome.wideLeftInset : 12
    const rightInset = isWindowsClient ? windowsCaptionControlsWidth : 12

    return (
      <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
        <header className="titlebar-drag-region bdry-b bg-background/85 backdrop-blur supports-[backdrop-filter]:bg-background/70">
          <div
            className="flex h-11 items-center gap-3 transition-[padding] duration-200 ease-out"
            style={{ paddingLeft: leftInset, paddingRight: rightInset }}
          >
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
        {statusBar}
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
              leftWindowControlsInset
              hideInbox={hideInbox}
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
            {statusBar}
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
  hideInbox,
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
        hideInbox={hideInbox}
        user={user}
        onLogout={onLogout}
      />
    </SidebarProvider>
  )
}
