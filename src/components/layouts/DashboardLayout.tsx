import { type ReactNode, Fragment } from "react"
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
import { BdryDivider } from "@/components/ui/bdry"
import { LayoutToggles } from "./LayoutToggles"

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
              <DashboardHeader
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

interface DashboardHeaderProps {
  breadcrumbs: { label: string; href?: string }[]
  header?: ReactNode
  breadcrumbAddon?: ReactNode
}

function DashboardHeader({ breadcrumbs, header, breadcrumbAddon }: DashboardHeaderProps) {
  if (breadcrumbs.length === 0 && !header && !breadcrumbAddon) return null

  return (
    <div className="absolute top-0 left-0 right-0 z-40 h-12 flex items-center px-4 bg-background titlebar-drag-region">
      <div className="flex items-center w-full gap-3">
        <div className="flex items-center min-w-0 titlebar-no-drag">
          <Breadcrumb>
            <BreadcrumbList>
              {breadcrumbs.map((crumb, index) => (
                <Fragment key={`${crumb.label}-${index}`}>
                  <BreadcrumbItem>
                    {crumb.href && index < breadcrumbs.length - 1 ? (
                      <BreadcrumbLink href={crumb.href || "#"}>
                        {crumb.label}
                      </BreadcrumbLink>
                    ) : (
                      <BreadcrumbPage className="text-muted-foreground/80">
                        {crumb.label}
                      </BreadcrumbPage>
                    )}
                  </BreadcrumbItem>
                  {index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                </Fragment>
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
        <div className="flex items-center gap-1 titlebar-no-drag">
          {header}
          {(header || breadcrumbAddon) && (
            <BdryDivider orientation="vertical" className="mx-1.5 h-4" variant="muted" />
          )}
          <div className="flex items-center gap-1">
            <CommandSearch />
            <div className="w-1" />
            <LayoutToggles />
          </div>
        </div>
      </div>
    </div>
  )
}
