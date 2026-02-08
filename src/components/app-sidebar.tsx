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
import { cn } from "@/lib/utils"

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
      className={cn("sidebar-outward-curve sidebar-fade-border-right", className)}
      {...props}
    >
      <SidebarHeader className="pt-9">
        <ContextSwitcher />
      </SidebarHeader>
      <SidebarContent>
        <NavMain label="Platform" items={platformItems} />
        <SidebarSeparator className="hidden group-data-[collapsible=icon]:block my-2 mx-0 w-full" />
        <NavMain label="Team" items={teamItems} />
        <SidebarSeparator className="hidden group-data-[collapsible=icon]:block my-2 mx-0 w-full" />
        <NavMain label="Workspace" items={workspaceItems} />
      </SidebarContent>
      <SidebarFooter className="pb-6">
        <NavUser user={user} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
