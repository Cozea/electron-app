"use client"

import * as React from "react"
import { useLocation } from "react-router-dom"
import {
  FolderKanban,
  Sparkles,
  Home,
  Users,
  Building2,
} from "lucide-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import { TeamSwitcher } from "@/components/team-switcher"
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
  } | null
  onLogout?: () => void
}

const teams = [
  {
    name: "Cozea",
    logo: Sparkles,
    plan: "Pro",
  },
]

export function AppSidebar({ user, onLogout, ...props }: AppSidebarProps) {
  const location = useLocation()
  const currentPath = location.pathname

  const userName = user?.firstName
    ? `${user.firstName}${user.lastName ? ` ${user.lastName}` : ""}`
    : user?.email?.split("@")[0] || "User"

  const userData = {
    name: userName,
    email: user?.email || "",
    avatar: "",
  }

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
      icon: FolderKanban,
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
      <SidebarHeader className="mt-7">
        <TeamSwitcher teams={teams} />
      </SidebarHeader>
      <SidebarContent>
        <NavMain items={navMain} />
      </SidebarContent>
      <SidebarFooter className="pb-6">
        <NavUser user={userData} onLogout={onLogout} />
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
