"use client"

import * as React from "react"
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
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import {
  canAccessWorkspaceSurface,
  listSettingsSurfaces,
} from "@/lib/settings/settingsRegistry"

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

export function AppSidebar({ user, onLogout, className, ...props }: AppSidebarProps) {
  const {
    workspaceScoped: organizationWorkspaceSelected,
    surfaceAccess,
  } = useScopedAppContext()

  const teamItems = organizationWorkspaceSelected
    ? listSettingsSurfaces({
        scopeKind: 'workspace',
        placement: 'sidebar',
        sidebarGroup: 'team',
      })
        .filter((surface) =>
          canAccessWorkspaceSurface(surface, surfaceAccess)
        )
        .map(
          (surface) =>
            ({
              title: surface.label,
              url: surface.routes.workspace!,
              icon: surface.icon,
              alpha: surface.alpha,
              preload: surface.preload,
            }) satisfies NavMainItem
        )
    : []
  const workspaceItems = organizationWorkspaceSelected
    ? listSettingsSurfaces({
        scopeKind: 'workspace',
        placement: 'sidebar',
        sidebarGroup: 'workspace',
      })
        .filter((surface) =>
          canAccessWorkspaceSurface(surface, surfaceAccess)
        )
        .map(
          (surface) =>
            ({
              title: surface.label,
              url: surface.routes.workspace!,
              icon: surface.icon,
              alpha: surface.alpha,
              preload: surface.preload,
            }) satisfies NavMainItem
        )
        .sort((left, right) => {
          if (left.title === 'General') return -1
          if (right.title === 'General') return 1
          return 0
        })
    : listSettingsSurfaces({
        scopeKind: 'personal',
        placement: 'sidebar',
        sidebarGroup: 'personalWorkspace',
      })
        .map(
        (surface) =>
          ({
            title: surface.label,
            url: surface.routes.personal!,
            icon: surface.icon,
            alpha: surface.alpha,
          }) satisfies NavMainItem
      )
        .sort((left, right) => {
          if (left.title === 'General') return -1
          if (right.title === 'General') return 1
          return 0
        })

  return (
    <div style={{ "--sidebar-width": "14rem" } as React.CSSProperties} className="h-full">
      <Sidebar
        collapsible="icon"
        windowChromeAware
        className={cn("w-56 shrink-0 z-20 h-screen sidebar-glass", className)}
        {...props}
      >
        <SidebarHeader className="titlebar-drag-region">
          <div className="titlebar-no-drag">
            <ContextSwitcher />
          </div>
        </SidebarHeader>
        <SidebarContent className="titlebar-no-drag">
          <NavMain label="Platform" items={PLATFORM_ITEMS} />
          {teamItems.length > 0 ? <NavMain label="Access" items={teamItems} /> : null}
          <NavMain label="Workspace" items={workspaceItems} />
        </SidebarContent>
        <SidebarFooter className="titlebar-no-drag mt-auto pb-2 group-data-[collapsible=icon]:pb-2">
          <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
            <NavUser user={user} onLogout={onLogout} />
          </div>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>
    </div>
  )
}
