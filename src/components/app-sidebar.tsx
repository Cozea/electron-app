"use client"

import * as React from "react"
import {
  Users,
  Shield,
  Settings,
  CreditCard,
  Bot,
  Terminal,
  Cloud,
} from "lucide-react"
import { IconFolderCode } from "@tabler/icons-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { ContextSwitcher } from "@/components/context-switcher"
import { UpdateMenu } from "@/components/updates/UpdateMenu"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import type { NavMainItem } from "@/components/nav-main"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
  onLogout?: () => void
}

const PLATFORM_ITEMS: NavMainItem[] = [
  { title: "Projects", url: "/projects", icon: IconFolderCode },
]

const preloadRolesPage = () => import("@/pages/teams/Roles")
const preloadGeneralPage = () => import("@/pages/workspace/General")
const preloadBillingPage = () => import("@/pages/workspace/Billing")
const preloadAiPage = () => import("@/pages/workspace/AI")
const preloadIntegrationsPage = () => import("@/pages/workspace/Integrations")
const preloadSyncPage = () => import("@/pages/workspace/Sync")

const TEAM_ITEMS: NavMainItem[] = [
  { title: "Members", url: "/teams", icon: Users },
  { title: "Roles", url: "/teams/roles", icon: Shield, alpha: true, preload: preloadRolesPage },
]

const WORKSPACE_ITEMS: NavMainItem[] = [
  { title: "General", url: "/workspace/general", icon: Settings, preload: preloadGeneralPage },
  { title: "Billing", url: "/workspace/billing", icon: CreditCard, preload: preloadBillingPage },
  { title: "AI", url: "/workspace/ai", icon: Bot, preload: preloadAiPage },
  { title: "CLI Tools", url: "/workspace/integrations", icon: Terminal, preload: preloadIntegrationsPage },
  { title: "Cloud Storage", url: "/workspace/sync", icon: Cloud, alpha: true, preload: preloadSyncPage },
]

export function AppSidebar({ user, onLogout, className, ...props }: AppSidebarProps) {
  return (
    <div style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="h-full">
      <Sidebar
        collapsible="icon"
        className={cn("w-56 shrink-0 z-20 h-screen sidebar-glass", className)}
        {...props}
      >
        <SidebarHeader className="mt-9 titlebar-drag-region">
          <div className="titlebar-no-drag">
            <ContextSwitcher />
          </div>
        </SidebarHeader>
        <SidebarContent className="titlebar-no-drag group-data-[collapsible=icon]:mt-9">
          <NavMain label="Platform" items={PLATFORM_ITEMS} />
          <NavMain label="Team" items={TEAM_ITEMS} />
          <NavMain label="Workspace" items={WORKSPACE_ITEMS} />
        </SidebarContent>
        <SidebarFooter className="titlebar-no-drag mt-auto pb-4 group-data-[collapsible=icon]:pb-3">
          <UpdateMenu />
          <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <NavUser user={user} onLogout={onLogout} />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
