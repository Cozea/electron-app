"use client"

import * as React from "react"
import { IconFolderCode } from "@tabler/icons-react"

import { NavMain } from "@/components/nav-main"
import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarRail,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"
import type { NavMainItem } from "@/components/nav-main"
import { useLocation } from "@/lib/router"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import { resolveSettingsNavChrome } from "@/lib/workspaces/settingsRoutes"
import {
  canAccessWorkspaceSurface,
  comparePersonalContextUnifiedSettingsSidebar,
  comparePersonalDeviceSidebarSurfaces,
  compareWorkspaceScopedSidebarSurfaces,
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

export function AppSidebar({ user, onLogout, className, ...props }: AppSidebarProps) {
  const location = useLocation()
  const {
    workspaceScoped: organizationWorkspaceSelected,
    surfaceAccess,
  } = useScopedAppContext()
  const settingsNavChrome = resolveSettingsNavChrome(location.pathname, organizationWorkspaceSelected)

  const platformItems = React.useMemo<NavMainItem[]>(
    () => [
      {
        title: "Projects",
        url: "/projects",
        icon: IconFolderCode,
      },
    ],
    []
  )

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
  const orgWorkspaceHubItems = React.useMemo(() => {
    if (!organizationWorkspaceSelected) return []
    return listSettingsSurfaces({
      scopeKind: "workspace",
      placement: "sidebar",
      sidebarGroup: "workspace",
    })
      .filter((surface) => canAccessWorkspaceSurface(surface, surfaceAccess))
      .sort(compareWorkspaceScopedSidebarSurfaces)
      .map(
        (surface) =>
          ({
            title: surface.label,
            url: surface.routes.workspace!,
            icon: surface.icon,
            alpha: surface.alpha,
            preload: surface.preload,
          }) satisfies NavMainItem,
      )
  }, [organizationWorkspaceSelected, surfaceAccess])

  const orgPersonalDeviceItems = React.useMemo(() => {
    if (!organizationWorkspaceSelected) return []
    return listSettingsSurfaces({
      scopeKind: "personal",
      placement: "sidebar",
      sidebarGroup: "personalDevice",
    })
      .sort(comparePersonalDeviceSidebarSurfaces)
      .map(
        (surface) =>
          ({
            title: surface.label,
            url: surface.routes.personal!,
            icon: surface.icon,
            alpha: surface.alpha,
            preload: surface.preload,
          }) satisfies NavMainItem,
      )
  }, [organizationWorkspaceSelected])

  /** Personal workspace: one list — everything is user settings from the product perspective */
  const personalWorkspaceAllSettingsItems = React.useMemo(() => {
    if (organizationWorkspaceSelected) return []
    const hub = listSettingsSurfaces({
      scopeKind: "personal",
      placement: "sidebar",
      sidebarGroup: "personalWorkspace",
    })
    const device = listSettingsSurfaces({
      scopeKind: "personal",
      placement: "sidebar",
      sidebarGroup: "personalDevice",
    })
    const seen = new Set<string>()
    const merged: (typeof hub)[number][] = []
    for (const surface of [...hub, ...device]) {
      if (seen.has(surface.id)) continue
      seen.add(surface.id)
      merged.push(surface)
    }
    merged.sort(comparePersonalContextUnifiedSettingsSidebar)
    return merged.map(
      (surface) =>
        ({
          title: surface.label,
          url: surface.routes.personal!,
          icon: surface.icon,
          alpha: surface.alpha,
          preload: surface.preload,
        }) satisfies NavMainItem,
    )
  }, [organizationWorkspaceSelected])

  return (
    <Sidebar
      collapsible="icon"
      rootClassName="h-full"
      rootStyle={{ "--sidebar-width": "14rem" } as React.CSSProperties}
      className={cn("h-full w-56 shrink-0 z-20 sidebar-glass", className)}
      {...props}
    >
      <div className="h-10 shrink-0" aria-hidden="true" />
      <SidebarContent>
        <NavMain label="Platform" items={platformItems} />
        {teamItems.length > 0 ? <NavMain label="Access" items={teamItems} /> : null}
        {organizationWorkspaceSelected ? (
          settingsNavChrome === "userSettings" ? (
            orgPersonalDeviceItems.length > 0 ? (
              <NavMain label="User settings" items={orgPersonalDeviceItems} />
            ) : null
          ) : settingsNavChrome === "orgWorkspaceAdmin" ? (
            <NavMain label="Workspace" items={orgWorkspaceHubItems} />
          ) : (
            <>
              <NavMain label="Workspace" items={orgWorkspaceHubItems} />
              {orgPersonalDeviceItems.length > 0 ? (
                <NavMain label="User settings" items={orgPersonalDeviceItems} />
              ) : null}
            </>
          )
        ) : (
          <NavMain label="Settings" items={personalWorkspaceAllSettingsItems} />
        )}
      </SidebarContent>
      <SidebarFooter className="mt-auto pb-2 group-data-[collapsible=icon]:pb-2">
        <div className="group-data-[collapsible=icon]:flex group-data-[collapsible=icon]:justify-center">
          <NavUser user={user} onLogout={onLogout} />
        </div>
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}
