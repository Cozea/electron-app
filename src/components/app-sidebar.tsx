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
import { useAuth } from "@/contexts/AuthContext"
import {} from "@/hooks/useScopedAiData"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import { prewarmCloudStorageData } from "@/hooks/useScopedCloudStorageData"
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

export function AppSidebar({ user, onLogout, className, ...props }: AppSidebarProps) {
  const { convexUserId } = useAuth()
  const {
    workspaceScoped: organizationWorkspaceSelected,
    convexOrganizationId,
    permissions,
    surfaceAccess,
  } = useScopedAppContext()

  const preloadProjectsPage = React.useCallback(async () => {
    const module = await import("@/pages/Projects")
    await module.prewarmProjectsPageData({
      personalScoped: !organizationWorkspaceSelected,
      organizationId: convexOrganizationId ?? null,
      userId: convexUserId ?? null,
      canViewWorkspaceMembers: permissions.includes('members:view'),
    })
  }, [convexOrganizationId, convexUserId, organizationWorkspaceSelected, permissions])

  const platformItems = React.useMemo<NavMainItem[]>(
    () => [
      {
        title: "Projects",
        url: "/projects",
        icon: IconFolderCode,
        preload: preloadProjectsPage,
      },
    ],
    [preloadProjectsPage]
  )

  const getSurfacePreload = React.useCallback(
    (
      surface: ReturnType<typeof listSettingsSurfaces>[number]
    ): (() => Promise<unknown>) | undefined => {
      if (surface.id === 'cloudStorage') {
        return async () => {
          await Promise.all([
            surface.preload?.(),
            prewarmCloudStorageData(convexOrganizationId ?? null),
          ])
        }
      }

      if (surface.id === 'ai') {
        return async () => {
          await Promise.all([
            surface.preload?.(),
            Promise.resolve({
              organizationId: convexOrganizationId ?? null,
              userId: convexUserId ?? null,
              range: '30d',
            }),
          ])
        }
      }

      return surface.preload
    },
    [convexOrganizationId, convexUserId]
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
              preload: getSurfacePreload(surface),
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
              preload: getSurfacePreload(surface),
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
            preload: getSurfacePreload(surface),
          }) satisfies NavMainItem
      )
        .sort((left, right) => {
          if (left.title === 'General') return -1
          if (right.title === 'General') return 1
          return 0
        })

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
        <NavMain label="Workspace" items={workspaceItems} />
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
