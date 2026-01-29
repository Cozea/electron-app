"use client"

import * as React from "react"
import {
  Users,
  Shield,
  Settings,
  CreditCard,
  Sparkles,
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

export function AppSidebar({ user, onLogout, ...props }: AppSidebarProps) {
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
    { title: "AI", url: "/workspace/ai", icon: Sparkles },
    { title: "CLI Tools", url: "/workspace/integrations", icon: Terminal },
    { title: "Cloud Sync", url: "/workspace/sync", icon: Cloud, alpha: true },
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="mt-9">
        <ContextSwitcher />
      </SidebarHeader>
      <SidebarContent className="group-data-[collapsible=icon]:mt-9">
        <NavMain label="Platform" items={platformItems} />
        <NavMain label="Team" items={teamItems} />
        <NavMain label="Workspace" items={workspaceItems} />
      </SidebarContent>
      <SidebarFooter className="pb-6">
        <NavUser user={user} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
