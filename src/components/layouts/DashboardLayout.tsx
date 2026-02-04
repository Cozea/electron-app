import { type ReactNode } from "react"
import { AppSidebar } from "@/components/app-sidebar"
import { AssistantPanel } from "@/components/assistant/AssistantPanel"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import { CommandSearch } from "@/components/CommandSearch"
import { AssistantToggleButton } from "@/components/assistant/AssistantToggleButton"

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

export function DashboardLayout({
  children,
  header,
  breadcrumbAddon,
  footer,
  breadcrumbs: _breadcrumbs = [{ label: "Projects" }],
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
	              {showHeader && (
	                <div className="absolute top-0 left-0 right-0 z-40 h-12 flex items-center px-4 bg-background/50 backdrop-blur-md titlebar-drag-region">
	                  <div className="flex items-center w-full gap-3">
                    <div className="flex items-center min-w-0 titlebar-no-drag">
                      <Breadcrumb>
                        <BreadcrumbList>
                          {_breadcrumbs.map((crumb, index) => (
                            <span key={`${crumb.label}-${index}`} className="contents">
	                              <BreadcrumbItem>
	                                {crumb.href && index < _breadcrumbs.length - 1 ? (
	                                  <BreadcrumbLink href={crumb.href || "#"}>
	                                    {crumb.label}
	                                  </BreadcrumbLink>
	                                ) : (
	                                  <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
	                                )}
	                              </BreadcrumbItem>
	                              {index < _breadcrumbs.length - 1 && <BreadcrumbSeparator />}
	                            </span>
	                          ))}
                        </BreadcrumbList>
                      </Breadcrumb>
                      {breadcrumbAddon && (
                        <div className="ml-3 flex items-center gap-2">
                          {breadcrumbAddon}
                        </div>
                      )}
                    </div>
                    <div className="flex-1" />
                    <div className="flex items-center gap-2 titlebar-no-drag">
                      {header}
                      <div className="mx-1 h-4 w-px bg-border" />
                      <CommandSearch />
                      <AssistantToggleButton />
                    </div>
                  </div>
                </div>
              )}
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
