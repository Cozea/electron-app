import * as React from "react"
import { ArrowLeftIcon as ArrowLeft } from "@heroicons/react/24/outline"

import { NavUser } from "@/components/nav-user"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useLocation } from "@/lib/router"
import { cn } from "@/lib/utils"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import {
  canAccessWorkspaceSurface,
  comparePersonalContextUnifiedSettingsSidebar,
  comparePersonalDeviceSidebarSurfaces,
  compareWorkspaceScopedSidebarSurfaces,
  listSettingsSurfaces,
} from "@/lib/settings/settingsRegistry"
import { resolveSettingsNavChrome } from "@/lib/workspaces/settingsRoutes"
import {
  SIDEBAR_GROUP_LABEL_CLASS,
  SIDEBAR_NAV_ROW_BUTTON_CLASS,
  SIDEBAR_PILL_ACTIVE_CLASS,
} from "@/features/projects/components/sidebar/projectSidebarShared"

interface SettingsSidebarProps extends React.ComponentProps<typeof Sidebar> {
  user?: {
    email: string
    firstName?: string | null
    lastName?: string | null
    profileImageUrl?: string | null
  } | null
  onLogout?: () => void
}

function toProjectsPath(path: string): string {
  return path.startsWith("/projects/") ? path : `/projects${path}`
}

/** Same `<button>` + classes as `ProjectSidebar` / project settings rows — not `SidebarMenuButton` */
function SettingsSidebarNavRow({
  isActive,
  onClick,
  icon: Icon,
  label,
}: {
  isActive: boolean
  onClick: () => void
  icon: React.ComponentType<{ className?: string }>
  label: string
}) {
  return (
    <button
      type="button"
      className={cn(SIDEBAR_NAV_ROW_BUTTON_CLASS, isActive && SIDEBAR_PILL_ACTIVE_CLASS)}
      onClick={onClick}
    >
      <Icon />
      <span className="truncate">{label}</span>
    </button>
  )
}

export function SettingsSidebar({ user, onLogout, className, ...props }: SettingsSidebarProps) {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const { workspaceScoped, surfaceAccess } = useScopedAppContext()
  const settingsNavChrome = resolveSettingsNavChrome(location.pathname, workspaceScoped)

  const workspaceTeamItems = workspaceScoped
    ? listSettingsSurfaces({
        scopeKind: "workspace",
        placement: "sidebar",
        sidebarGroup: "team",
      }).filter((surface) => canAccessWorkspaceSurface(surface, surfaceAccess))
    : []

  const workspaceHubSurfaces = workspaceScoped
    ? listSettingsSurfaces({
        scopeKind: "workspace",
        placement: "sidebar",
        sidebarGroup: "workspace",
      }).filter((surface) => canAccessWorkspaceSurface(surface, surfaceAccess))
    : []

  const orgWorkspaceHubSorted = workspaceScoped
    ? [...workspaceHubSurfaces].sort(compareWorkspaceScopedSidebarSurfaces)
    : []

  const personalDeviceSurfaces = workspaceScoped
    ? listSettingsSurfaces({
        scopeKind: "personal",
        placement: "sidebar",
        sidebarGroup: "personalDevice",
      }).sort(comparePersonalDeviceSidebarSurfaces)
    : []

  const personalContextMergedSurfaces = !workspaceScoped
    ? (() => {
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
        return merged
      })()
    : []

  const sectionRoutes = (() => {
    const team = workspaceTeamItems.map((surface) => toProjectsPath(surface.routes.workspace!))
    if (settingsNavChrome === "personalUnified") {
      return [...team, ...personalContextMergedSurfaces.map((s) => toProjectsPath(s.routes.personal!))]
    }
    if (settingsNavChrome === "orgWorkspaceAdmin") {
      return [...team, ...orgWorkspaceHubSorted.map((s) => toProjectsPath(s.routes.workspace!))]
    }
    if (settingsNavChrome === "userSettings") {
      return personalDeviceSurfaces.map((s) => toProjectsPath(s.routes.personal!))
    }
    return [
      ...team,
      ...orgWorkspaceHubSorted.map((s) => toProjectsPath(s.routes.workspace!)),
      ...personalDeviceSurfaces.map((s) => toProjectsPath(s.routes.personal!)),
    ]
  })()

  const directSectionRoute = sectionRoutes.find((route) => route === location.pathname) ?? null
  const parentSectionRoute =
    sectionRoutes
      .filter((route) => location.pathname.startsWith(`${route}/`))
      .sort((a, b) => b.length - a.length)[0] ?? null
  const isSubRoute = !directSectionRoute && Boolean(parentSectionRoute)

  return (
    <Sidebar
      collapsible="offcanvas"
      windowChromeAware
      rootClassName={cn("h-full min-w-0 overflow-hidden", className)}
      rootStyle={{ "--sidebar-width": "14rem" } as React.CSSProperties}
      className="h-full min-w-0 z-20 sidebar-glass"
      {...props}
    >
      <SidebarContent className="gap-0 px-2 py-3">
        <div className="mb-2">
          <button
            type="button"
            className={SIDEBAR_NAV_ROW_BUTTON_CLASS}
            onClick={() => navigate("/projects")}
          >
            <ArrowLeft />
            <span className="truncate">Back to projects</span>
          </button>
        </div>

        {workspaceTeamItems.length > 0 && settingsNavChrome !== "userSettings" ? (
          <SidebarGroup className="px-0 py-0">
            <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>Team</SidebarGroupLabel>
            <div className="space-y-1">
              {workspaceTeamItems.map((surface) => {
                const href = toProjectsPath(surface.routes.workspace!)
                const isActive =
                  location.pathname === href || location.pathname.startsWith(`${href}/`)
                return (
                  <SettingsSidebarNavRow
                    key={surface.id}
                    icon={surface.icon}
                    label={surface.label}
                    isActive={isActive}
                    onClick={() => navigate(href)}
                  />
                )
              })}
            </div>
          </SidebarGroup>
        ) : null}

        {settingsNavChrome === "personalUnified" ? (
          <SidebarGroup className="px-0 py-2">
            <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>Settings</SidebarGroupLabel>
            <div className="space-y-1">
              {personalContextMergedSurfaces.map((surface) => {
                const href = toProjectsPath(surface.routes.personal!)
                const isActive =
                  location.pathname === href || location.pathname.startsWith(`${href}/`)
                return (
                  <SettingsSidebarNavRow
                    key={surface.id}
                    icon={surface.icon}
                    label={surface.label}
                    isActive={isActive}
                    onClick={() => navigate(href)}
                  />
                )
              })}
            </div>
          </SidebarGroup>
        ) : null}

        {settingsNavChrome === "orgWorkspaceAdmin" ? (
          <SidebarGroup className="px-0 py-2">
            <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>Workspace</SidebarGroupLabel>
            <div className="space-y-1">
              {orgWorkspaceHubSorted.map((surface) => {
                const href = toProjectsPath(surface.routes.workspace!)
                const isActive =
                  location.pathname === href || location.pathname.startsWith(`${href}/`)
                return (
                  <SettingsSidebarNavRow
                    key={surface.id}
                    icon={surface.icon}
                    label={surface.label}
                    isActive={isActive}
                    onClick={() => navigate(href)}
                  />
                )
              })}
            </div>
          </SidebarGroup>
        ) : null}

        {settingsNavChrome === "userSettings" && personalDeviceSurfaces.length > 0 ? (
          <SidebarGroup className="px-0 py-2">
            <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>User settings</SidebarGroupLabel>
            <div className="space-y-1">
              {personalDeviceSurfaces.map((surface) => {
                const href = toProjectsPath(surface.routes.personal!)
                const isActive =
                  location.pathname === href || location.pathname.startsWith(`${href}/`)
                return (
                  <SettingsSidebarNavRow
                    key={surface.id}
                    icon={surface.icon}
                    label={surface.label}
                    isActive={isActive}
                    onClick={() => navigate(href)}
                  />
                )
              })}
            </div>
          </SidebarGroup>
        ) : null}

        {settingsNavChrome === "mixed" ? (
          <>
            <SidebarGroup className="px-0 py-2">
              <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>Workspace</SidebarGroupLabel>
              <div className="space-y-1">
                {orgWorkspaceHubSorted.map((surface) => {
                  const href = toProjectsPath(surface.routes.workspace!)
                  const isActive =
                    location.pathname === href || location.pathname.startsWith(`${href}/`)
                  return (
                    <SettingsSidebarNavRow
                      key={surface.id}
                      icon={surface.icon}
                      label={surface.label}
                      isActive={isActive}
                      onClick={() => navigate(href)}
                    />
                  )
                })}
              </div>
            </SidebarGroup>
            {personalDeviceSurfaces.length > 0 ? (
              <SidebarGroup className="px-0 py-2">
                <SidebarGroupLabel className={SIDEBAR_GROUP_LABEL_CLASS}>User settings</SidebarGroupLabel>
                <div className="space-y-1">
                  {personalDeviceSurfaces.map((surface) => {
                    const href = toProjectsPath(surface.routes.personal!)
                    const isActive =
                      location.pathname === href || location.pathname.startsWith(`${href}/`)
                    return (
                      <SettingsSidebarNavRow
                        key={surface.id}
                        icon={surface.icon}
                        label={surface.label}
                        isActive={isActive}
                        onClick={() => navigate(href)}
                      />
                    )
                  })}
                </div>
              </SidebarGroup>
            ) : null}
          </>
        ) : null}
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="gap-3 p-3">
        {isSubRoute && parentSectionRoute ? (
          <button
            type="button"
            className={SIDEBAR_NAV_ROW_BUTTON_CLASS}
            onClick={() => navigate(parentSectionRoute)}
          >
            <ArrowLeft />
            <span className="truncate">Back</span>
          </button>
        ) : (
          <div>
            <NavUser user={user} onLogout={onLogout} />
          </div>
        )}
      </SidebarFooter>
      <SidebarRail />
    </Sidebar>
  )
}

