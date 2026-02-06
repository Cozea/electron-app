import { type ReactNode } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { AssistantPanel } from "@/components/assistant/AssistantPanel"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import { UnifiedHeader } from "@/components/layouts/UnifiedHeader"

interface DashboardLayoutProps {
  children: ReactNode
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  footer?: ReactNode
  breadcrumbs?: { label: string; href?: string }[]
  contentMode?: 'scroll' | 'fixed'
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
  onLogout?: () => void
}

const DEFAULT_BREADCRUMBS = [{ label: "Projects" }];

export function DashboardLayout({
  children,
  header,
  breadcrumbAddon,
  footer,
  breadcrumbs: _breadcrumbs = DEFAULT_BREADCRUMBS,
  contentMode = 'scroll',
  user,
  onLogout,
}: DashboardLayoutProps) {
  const showHeader = _breadcrumbs.length > 0 || Boolean(header) || Boolean(breadcrumbAddon)

  return (
    <SidebarProvider>
      <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
        {/* Main Content with Sidebar */}
        <div className="flex flex-1 overflow-hidden relative">
          <AppSidebar user={user} onLogout={onLogout} />
          <SidebarInset>
            <div className="flex flex-1 flex-col overflow-hidden relative">
              <UnifiedHeader
                breadcrumbs={_breadcrumbs}
                header={header}
                breadcrumbAddon={breadcrumbAddon}
              />
              {contentMode === 'fixed' ? (
                <div className={cn("flex flex-1 min-h-0 flex-col overflow-hidden", showHeader && "pt-16")}>
                  {children}
                </div>
              ) : (
                <ScrollArea className="flex-1">
                  <div className={cn("flex flex-col gap-4 p-4 min-h-full", showHeader && "pt-16")}>
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
    </SidebarProvider>
  )
}
