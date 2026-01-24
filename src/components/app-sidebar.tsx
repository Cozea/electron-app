"use client"

import * as React from "react"
import { useLocation } from "react-router-dom"
import {
  Home,
  Users,
  Building2,
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
  const location = useLocation()
  const currentPath = location.pathname

  const navMain = [
    {
      title: "Dashboard",
      url: "/",
      icon: Home,
      isActive: currentPath === "/",
    },
    {
      title: "Projects",
      url: "/projects",
      icon: IconFolderCode,
      isActive: currentPath.startsWith("/projects"),
    },
    {
      title: "Teams",
      url: "/teams",
      icon: Users,
      isActive: currentPath.startsWith("/teams"),
      items: [
        { title: "Members", url: "/teams" },
        { title: "Roles", url: "/teams/roles" },
      ],
    },
    {
      title: "Workspace",
      url: "/workspace/general",
      icon: Building2,
      isActive: currentPath.startsWith("/workspace"),
      items: [
        { title: "General", url: "/workspace/general" },
        { title: "Billing", url: "/workspace/billing" },
        { title: "AI", url: "/workspace/ai" },
        { title: "Integrations", url: "/workspace/integrations" },
        { title: "Cloud Sync", url: "/workspace/sync" },
      ],
    },
  ]

  return (
    <Sidebar collapsible="icon" {...props}>
      <SidebarHeader className="mt-9">
        <ContextSwitcher />
      </SidebarHeader>
      <SidebarContent className="group-data-[collapsible=icon]:mt-9">
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter className="pb-6">
        <NavUser user={user} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
