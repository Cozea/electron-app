import { type ReactNode, useEffect } from "react"
import { useLocation } from "react-router-dom"
import { AppSidebar } from "@/components/app-sidebar"
import { AssistantPanel } from "@/components/assistant/AssistantPanel"
import {
  SidebarInset,
  SidebarProvider,
  useSidebar,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader"
import { featureFlags } from "@/lib/featureFlags"
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
  const { isMobile, open, setOpen, setOpenMobile } = useSidebar()

  useEffect(() => {
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
  }, [assistantPanelMode, isMobile, open, setOpen, setOpenMobile])

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
  const location = useLocation()
  const { state } = useSidebar()
  const normalizedPath = location.pathname.replace(/\/+$/, "") || "/"
  const effectiveBreadcrumbAddon =
    normalizedPath === "/workspace/ai" ? undefined : breadcrumbAddon
  const showHeader = breadcrumbs.length > 0 || Boolean(header) || Boolean(effectiveBreadcrumbAddon)
  const contentTopInsetClassName = headerContentInsetClassName ?? "pt-16"
  const areAllSidebarsCollapsed = state === "collapsed"

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
        <AssistantPanel />
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
