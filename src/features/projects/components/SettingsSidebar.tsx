import * as React from "react"
import { ArrowLeft } from "lucide-react"

import { NavUser } from "@/components/nav-user"
import { Button } from "@/components/ui/button"
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupLabel,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
  SidebarSeparator,
} from "@/components/ui/sidebar"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useLocation } from "@/lib/router"
import { cn } from "@/lib/utils"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import {
  canAccessWorkspaceSurface,
  listSettingsSurfaces,
} from "@/lib/settings/settingsRegistry"
import {
  SIDEBAR_PILL_ACTIVE_CLASS,
  SIDEBAR_PILL_BASE_CLASS,
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

export function SettingsSidebar({ user, onLogout, className, ...props }: SettingsSidebarProps) {
  const navigate = useViewTransitionNavigate()
  const location = useLocation()
  const { workspaceScoped, surfaceAccess } = useScopedAppContext()

  const workspaceTeamItems = workspaceScoped
    ? listSettingsSurfaces({
        scopeKind: "workspace",
        placement: "sidebar",
        sidebarGroup: "team",
      }).filter((surface) => canAccessWorkspaceSurface(surface, surfaceAccess))
    : []

  const workspaceItems = workspaceScoped
    ? listSettingsSurfaces({
        scopeKind: "workspace",
        placement: "sidebar",
        sidebarGroup: "workspace",
      }).filter((surface) => canAccessWorkspaceSurface(surface, surfaceAccess))
    : listSettingsSurfaces({
        scopeKind: "personal",
        placement: "sidebar",
        sidebarGroup: "personalWorkspace",
      })

  const sectionRoutes = [
    ...workspaceTeamItems.map((surface) => toProjectsPath(surface.routes.workspace!)),
    ...workspaceItems.map((surface) =>
      toProjectsPath(workspaceScoped ? surface.routes.workspace! : surface.routes.personal!),
    ),
  ]

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
          <Button
            type="button"
            variant="ghost"
            className={cn("h-8 w-full justify-start gap-2 font-normal", SIDEBAR_PILL_BASE_CLASS)}
            onClick={() => navigate("/projects")}
          >
            <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground/80" />
            Back to projects
          </Button>
        </div>

        {workspaceTeamItems.length > 0 ? (
          <SidebarGroup className="px-0 py-0">
            <SidebarGroupLabel className="px-2 text-[14px] font-medium tracking-[-0.01em] text-muted-foreground/70">
              Team
            </SidebarGroupLabel>
            <SidebarMenu>
              {workspaceTeamItems.map((surface) => {
                const href = toProjectsPath(surface.routes.workspace!)
                const isActive =
                  location.pathname === href || location.pathname.startsWith(`${href}/`)
                const Icon = surface.icon
                return (
                  <SidebarMenuItem key={surface.id}>
                    <SidebarMenuButton
                      className={cn(
                        "h-8",
                        SIDEBAR_PILL_BASE_CLASS,
                        isActive && SIDEBAR_PILL_ACTIVE_CLASS,
                      )}
                      onClick={() => navigate(href)}
                    >
                      <Icon className="size-3.5 shrink-0" />
                      <span>{surface.label}</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                )
              })}
            </SidebarMenu>
          </SidebarGroup>
        ) : null}

        <SidebarGroup className="px-0 py-2">
          <SidebarGroupLabel className="px-2 text-[14px] font-medium tracking-[-0.01em] text-muted-foreground/70">
            {workspaceScoped ? "Workspace" : "Settings"}
          </SidebarGroupLabel>
          <SidebarMenu>
            {workspaceItems.map((surface) => {
              const rawHref = workspaceScoped ? surface.routes.workspace! : surface.routes.personal!
              const href = toProjectsPath(rawHref)
              const isActive =
                location.pathname === href || location.pathname.startsWith(`${href}/`)
              const Icon = surface.icon
              return (
                <SidebarMenuItem key={surface.id}>
                  <SidebarMenuButton
                    className={cn(
                      "h-8",
                      SIDEBAR_PILL_BASE_CLASS,
                      isActive && SIDEBAR_PILL_ACTIVE_CLASS,
                    )}
                    onClick={() => navigate(href)}
                  >
                    <Icon className="size-3.5 shrink-0" />
                    <span>{surface.label}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
          </SidebarMenu>
        </SidebarGroup>
      </SidebarContent>

      <SidebarSeparator />
      <SidebarFooter className="gap-3 p-3">
        {isSubRoute && parentSectionRoute ? (
          <Button
            type="button"
            variant="ghost"
            className={cn("h-8 w-full justify-start gap-2 font-normal", SIDEBAR_PILL_BASE_CLASS)}
            onClick={() => navigate(parentSectionRoute)}
          >
            <ArrowLeft className="size-3.5 shrink-0 text-muted-foreground/80" />
            Back
          </Button>
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

