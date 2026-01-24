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

interface DashboardLayoutProps {
  children: ReactNode
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
            <div className="flex flex-1 flex-col overflow-hidden">
              <ScrollArea className="h-full">
                <div className="flex flex-col gap-4 p-4 min-h-full">
                  {children}
                </div>
              </ScrollArea>
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
