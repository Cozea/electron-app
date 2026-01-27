import { type ReactNode } from "react"
import { SiteHeader } from "@/components/layout/SiteHeader"
import { StatusBar } from "@/components/StatusBar"
import { AppSidebar } from "@/components/app-sidebar"
import { AssistantPanel } from "@/components/assistant/AssistantPanel"
import {
  SidebarInset,
  SidebarProvider,
} from "@/components/ui/sidebar"
import { ScrollArea } from "@/components/ui/scroll-area"
import { cn } from "@/lib/utils"

interface DashboardLayoutProps {
  children: ReactNode
  header?: ReactNode
  footer?: ReactNode
  breadcrumbs?: { label: string; href?: string }[]
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
  footer,
  breadcrumbs = [{ label: "Projects" }],
  user,
  onLogout,
}: DashboardLayoutProps) {
  return (
    <SidebarProvider>
      <div className="h-screen w-screen bg-background flex flex-col overflow-hidden">
        {/* Top Bar - spans full width across everything */}
        <SiteHeader breadcrumbs={breadcrumbs} />

        {/* Main Content with Sidebar */}
        <div className="flex flex-1 overflow-hidden relative mt-9">
          <AppSidebar user={user} onLogout={onLogout} />
          <SidebarInset>
            <div className="flex flex-1 flex-col overflow-hidden relative">
              {header && (
                <div className="absolute top-0 left-0 right-0 z-40 h-12 flex items-center px-4 bg-background/50 backdrop-blur-md">
                  <div className="w-full">
                    {header}
                  </div>
                </div>
              )}
              <ScrollArea className="flex-1">
                <div className={cn("flex flex-col gap-4 p-4 min-h-full", header && "pt-16")}>
                  {children}
                </div>
              </ScrollArea>
              {footer && (
                <div className="flex-none border-t bg-background/95 backdrop-blur supports-[backdrop-filter]:bg-background/60">
                  {footer}
                </div>
              )}
            </div>
          </SidebarInset>
          <AssistantPanel />
        </div>

        {/* Status Bar - spans full width */}
        <StatusBar />
      </div>
    </SidebarProvider>
  )
}
