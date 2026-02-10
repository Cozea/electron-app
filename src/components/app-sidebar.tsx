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
import { useAutoUpdateStore } from "@/stores/useAutoUpdateStore"
import { useAutoUpdater } from "@/hooks/useAutoUpdater"

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

const TEAM_ITEMS: NavMainItem[] = [
  { title: "Members", url: "/teams", icon: Users },
  { title: "Roles", url: "/teams/roles", icon: Shield, alpha: true },
]

const WORKSPACE_ITEMS: NavMainItem[] = [
  { title: "General", url: "/workspace/general", icon: Settings },
  { title: "Billing", url: "/workspace/billing", icon: CreditCard },
  { title: "AI", url: "/workspace/ai", icon: Bot },
  { title: "CLI Tools", url: "/workspace/integrations", icon: Terminal },
  { title: "Cloud Storage", url: "/workspace/sync", icon: Cloud, alpha: true },
]

function SidebarUpdate() {
  useAutoUpdater()
  const status = useAutoUpdateStore((s) => s.status)

  const show = status === "available" || status === "downloading" || status === "downloaded"
  if (!show) return null

  return (
    <div className="px-2 pb-2 group-data-[collapsible=icon]:px-0 group-data-[collapsible=icon]:pb-3">
      <div className="flex items-center justify-between rounded-md border bg-background/40 px-2 py-1 group-data-[collapsible=icon]:border-0 group-data-[collapsible=icon]:bg-transparent group-data-[collapsible=icon]:p-0 group-data-[collapsible=icon]:justify-center">
        <div className="text-xs text-muted-foreground group-data-[collapsible=icon]:hidden">
          Update
        </div>
        <UpdateMenu dropdownAlign="start" dropdownSide="right" />
      </div>
    </div>
  )
}

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
          <SidebarUpdate />
          <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <NavUser user={user} onLogout={onLogout} />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
