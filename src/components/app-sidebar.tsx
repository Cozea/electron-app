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
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarHeader,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

interface AppSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
  onLogout?: () => void
}

export function AppSidebar({ user, onLogout, className, ...props }: AppSidebarProps) {
  const platformItems = [
    { title: "Projects", url: "/projects", icon: IconFolderCode },
  ]

  const teamItems = [
    { title: "Members", url: "/teams", icon: Users },
    { title: "Roles", url: "/teams/roles", icon: Shield, alpha: true },
  ]

  const workspaceItems = [
    { title: "General", url: "/workspace/general", icon: Settings },
    { title: "Billing", url: "/workspace/billing", icon: CreditCard },
    { title: "AI", url: "/workspace/ai", icon: Bot },
    { title: "CLI Tools", url: "/workspace/integrations", icon: Terminal },
    { title: "Cloud Storage", url: "/workspace/sync", icon: Cloud, alpha: true },
  ]

  return (
    <Sidebar
      collapsible="icon"
      className={cn("titlebar-no-drag", className)}
      {...props}
    >
      <SidebarHeader className="mt-9 titlebar-drag-region">
        <div className="titlebar-no-drag">
          <ContextSwitcher />
        </div>
      </SidebarHeader>
      <SidebarContent className="group-data-[collapsible=icon]:mt-9">
        <NavMain label="Platform" items={platformItems} />
        <SidebarSeparator className="hidden group-data-[collapsible=icon]:block my-2 mx-0 w-full" />
        <NavMain label="Team" items={teamItems} />
        <SidebarSeparator className="hidden group-data-[collapsible=icon]:block my-2 mx-0 w-full" />
        <NavMain label="Workspace" items={workspaceItems} />
      </SidebarContent>
      <SidebarFooter className="mt-auto pb-4 group-data-[collapsible=icon]:pb-3">
        <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          <NavUser user={user} onLogout={onLogout} />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
