import { Fragment, type ReactNode } from "react"
import { TitleBar } from "../TitleBar"
import { StatusBar } from "@/components/StatusBar"
import { AppSidebar } from "@/components/app-sidebar"
import { AssistantToggleButton } from "@/components/assistant/AssistantToggleButton"
import { AssistantPanel } from "@/components/assistant/AssistantPanel"
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb"
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"

interface DashboardLayoutProps {
  children: ReactNode
  breadcrumbs?: { label: string; href?: string }[]
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
  } | null
  onLogout?: () => void
}

export function DashboardLayout({
  children,
  breadcrumbs = [{ label: "Projects" }],
  user,
  onLogout,
}: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
        {/* Top Bar - spans full width across everything */}
        <TitleBar>
          <div className="flex items-center justify-between w-full">
            <div className="flex items-center">
              <SidebarTrigger className="-ml-1" />
              <div className="mx-2 h-4 w-[1px] bg-foreground/20" />
              <Breadcrumb>
                <BreadcrumbList>
                  {breadcrumbs.map((crumb, index) => (
                    <Fragment key={crumb.label}>
                      <BreadcrumbItem>
                        {index < breadcrumbs.length - 1 ? (
                          <BreadcrumbLink href={crumb.href || "#"}>
                            {crumb.label}
                          </BreadcrumbLink>
                        ) : (
                          <BreadcrumbPage>{crumb.label}</BreadcrumbPage>
                        )}
                      </BreadcrumbItem>
                      {index < breadcrumbs.length - 1 && <BreadcrumbSeparator />}
                    </Fragment>
                  ))}
                </BreadcrumbList>
              </Breadcrumb>
            </div>
            <div className="flex items-center gap-2">
              <AssistantToggleButton />
            </div>
          </div>
        </TitleBar>

        {/* Main Content with Sidebar */}
        <div className="flex flex-1 overflow-hidden relative">
          <AppSidebar user={user} onLogout={onLogout} />
          <SidebarInset>
            <div className="flex flex-1 flex-col overflow-hidden pt-11">
              <ScrollArea className="h-full">
                <div className="flex flex-col gap-4 px-4 pb-4">
                  {children}
                </div>
              </ScrollArea>
            </div>
          </SidebarInset>
          <AssistantPanel />
        </div>
        <StatusBar />
      </div>
    </SidebarProvider>
  )
}
