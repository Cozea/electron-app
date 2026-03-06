"use client"

import * as React from "react"
import {
  Users,
  Shield,
  FileText,
  Wrench,
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
import { cn } from "@/lib/utils"
import type { NavMainItem } from "@/components/nav-main"
import { useAuth } from "@/contexts/AuthContext"
import { isPersonalWorkspace } from "@/lib/workspaces"

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

const TEAM_ITEMS: NavMainItem[] = [
  { title: "Members", url: "/teams", icon: Users },
  { title: "Roles", url: "/teams/roles", icon: Shield, alpha: true, preload: preloadRolesPage },
]

const WORKSPACE_ITEMS: NavMainItem[] = [
  { title: "General", url: "/workspace/general", icon: FileText },
  { title: "CLI Tools", url: "/workspace/integrations", icon: Wrench },
  { title: "Cloud Storage", url: "/workspace/sync", icon: Cloud, alpha: true },
]

const PERSONAL_WORKSPACE_ITEMS: NavMainItem[] = WORKSPACE_ITEMS.filter(
  (item) => item.url !== "/workspace/general"
)

function isMacClient(): boolean {
  if (typeof navigator === "undefined") return false
  const nav = navigator as Navigator & { userAgentData?: { platform?: string } }
  const platformHint = nav.userAgentData?.platform || navigator.platform || navigator.userAgent
  return /mac/i.test(platformHint)
}

export function AppSidebar({ user, onLogout, className, ...props }: AppSidebarProps) {
  const isMacPlatform =
    typeof window !== "undefined" && window.electronAPI?.platform === "darwin"
      ? true
      : isMacClient()
  const [isFullScreen, setIsFullScreen] = React.useState(false)
  const applyWindowControlsInset = isMacPlatform && !isFullScreen
  const { currentOrganization } = useAuth()
  const personalWorkspaceSelected = isPersonalWorkspace(currentOrganization)
  const teamItems = personalWorkspaceSelected ? [] : TEAM_ITEMS
  const workspaceItems = personalWorkspaceSelected ? PERSONAL_WORKSPACE_ITEMS : WORKSPACE_ITEMS

  React.useEffect(() => {
    if (!isMacPlatform) return

    let isMounted = true

    void window.electronAPI?.window?.isFullScreen?.()
      .then((fullScreen) => {
        if (isMounted) setIsFullScreen(Boolean(fullScreen))
      })
      .catch(() => {
        if (isMounted) setIsFullScreen(false)
      })

    const cleanup = window.electronAPI?.window?.onFullScreenChange?.((fullScreen) => {
      if (isMounted) setIsFullScreen(Boolean(fullScreen))
    })

    return () => {
      isMounted = false
      cleanup?.()
    }
  }, [isMacPlatform])

  return (
    <div style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="h-full">
      <Sidebar
        collapsible="icon"
        className={cn("w-56 shrink-0 z-20 h-screen sidebar-glass", className)}
        {...props}
      >
        <SidebarHeader className={cn("titlebar-drag-region", applyWindowControlsInset && "mt-9")}>
          <div className="titlebar-no-drag">
            <ContextSwitcher />
          </div>
        </SidebarHeader>
        <SidebarContent
          className={cn(
            "titlebar-no-drag",
            applyWindowControlsInset && "group-data-[collapsible=icon]:mt-9"
          )}
        >
          <NavMain label="Platform" items={PLATFORM_ITEMS} />
          {teamItems.length > 0 ? <NavMain label="Team" items={teamItems} /> : null}
          <NavMain label="Workspace" items={workspaceItems} />
        </SidebarContent>
        <SidebarFooter className="titlebar-no-drag mt-auto pb-4 group-data-[collapsible=icon]:pb-3">
          <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <NavUser user={user} onLogout={onLogout} />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
