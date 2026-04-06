import { type ReactNode, useEffect } from "react"
import { Link, useLocation, useNavigate } from '@/lib/router'
import { AppSidebar } from "@/components/app-sidebar"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader"
import { featureFlags } from "@/lib/featureFlags"
import {
  getSettingsSurfaceRoute,
  listSettingsSurfaces,
} from "@/lib/settings/settingsRegistry"
import { useWindowChrome } from "@/hooks/useWindowChrome"
import { useWindowsCaptionControlsWidth } from "@/hooks/useWindowsCaptionControlsWidth"

interface AppShellLayoutProps {
  children: ReactNode
  header?: ReactNode
  breadcrumbAddon?: ReactNode
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
  headerAbsolute?: boolean
}

const DEFAULT_BREADCRUMBS = [{ label: "Projects" }]
const PERSONAL_ACCOUNT_ROUTE = getSettingsSurfaceRoute('account', 'personal') ?? '/settings/account'
const SETTINGS_WINDOW_ITEMS = listSettingsSurfaces({
  scopeKind: 'personal',
  placement: 'settingsWindow',
}).map((surface) => ({
  href: surface.routes.personal!,
  label: surface.label,
}))

interface AppShellLayoutContentProps {
  children: ReactNode
  header?: ReactNode
  breadcrumbAddon?: ReactNode
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
  headerAbsolute?: boolean
}

function AppShellLayoutContent({
  children,
  header,
  breadcrumbAddon,
  breadcrumbs,
  contentMode,
  headerContentInsetClassName,
  hideInbox,
  user,
  onLogout,
  headerAbsolute,
}: AppShellLayoutContentProps) {
  const navigate = useNavigate()
  const location = useLocation()
  const windowChrome = useWindowChrome()
  const windowsCaptionControlsWidth = useWindowsCaptionControlsWidth()
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/"
  const isSettingsWindow = windowChrome.windowContext === 'settings'
  const isMacClient = windowChrome.isMac
  const isWindowsClient = windowChrome.isWindows
  const effectiveBreadcrumbAddon = breadcrumbAddon
  const showHeader = breadcrumbs.length > 0 || Boolean(header) || Boolean(effectiveBreadcrumbAddon)
  const contentTopInsetClassName = headerContentInsetClassName ?? "pt-16"

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

      </div>
    )
  }

  return (
    <div className="h-screen w-screen bg-transparent flex flex-col overflow-hidden">
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
              className={headerAbsolute ? 'absolute inset-x-0 top-0 z-40' : undefined}
            />
            {contentMode === 'fixed' ? (
              <div
                className={cn(
                  'flex flex-1 min-h-0 flex-col overflow-hidden',
                  featureFlags.contentVisibility && 'perf-contain-card',
                  !headerAbsolute && showHeader && contentTopInsetClassName
                )}
              >
                {children}
              </div>
            ) : (
              <ScrollArea className={cn('flex-1', featureFlags.contentVisibility && 'perf-contain-auto')}>
                <div
                  className={cn(
                    'flex min-h-full flex-col gap-4 p-4',
                    headerAbsolute && showHeader ? 'pt-[72px]' : '',
                    featureFlags.contentVisibility && 'perf-contain-card',
                    !headerAbsolute && showHeader && contentTopInsetClassName
                  )}
                >
                  {children}
                </div>
              </ScrollArea>
            )}
          </div>
        </SidebarInset>
      </div>
    </div>
  )
}

export function AppShellLayout({
  children,
  header,
  breadcrumbAddon,
  breadcrumbs = DEFAULT_BREADCRUMBS,
  contentMode = 'scroll',
  headerContentInsetClassName,
  hideInbox,
  user,
  onLogout,
  headerAbsolute,
}: AppShellLayoutProps) {
  return (
    <SidebarProvider>
      <AppShellLayoutContent
        children={children}
        header={header}
        breadcrumbAddon={breadcrumbAddon}
        breadcrumbs={breadcrumbs}
        contentMode={contentMode}
        headerContentInsetClassName={headerContentInsetClassName}
        hideInbox={hideInbox}
        user={user}
        onLogout={onLogout}
        headerAbsolute={headerAbsolute}
      />
    </SidebarProvider>
  )
}
