import { type ReactNode, useCallback, useMemo } from "react"

import { AppShellLayout } from "@/components/layouts/AppShellLayout"
import { useAuth } from "@/contexts/AuthContext"
import { useScopedAppContext } from "@/hooks/useScopedAppContext"
import { useScopedSettingsPage } from "@/hooks/useScopedSettingsPage"
import { useViewTransitionNavigate } from "@/lib/navigation"
import { useLocation } from "@/lib/router"
import { cn } from "@/lib/utils"
import {
  canAccessWorkspaceSurface,
  getSettingsSurfaceDisplayLabel,
  listSettingsSurfaces,
  resolveSettingsSurfaceFromRoute,
} from "@/lib/settings/settingsRegistry"
import type {
  SettingsSidebarGroup,
  SettingsSurfaceDefinition,
  SettingsSurfaceId,
} from "@/lib/settings/settingsSurfaceTypes"

const SETTINGS_GROUP_LABELS: Record<SettingsSidebarGroup, string> = {
  personalWorkspace: "Settings",
  team: "Team",
  workspace: "Workspace",
}

function isVisibleRouteSettingsSurface(_surface: SettingsSurfaceDefinition): boolean {
  return true
}

function getRouteSettingsSurfaceLabel(
  surface: SettingsSurfaceDefinition,
  scopeKind: "personal" | "workspace",
): string {
  if (surface.id === "cliTools") {
    return "Integrations"
  }

  if (surface.id === "cloudStorage" && scopeKind === "workspace") {
    return "Cloud Storage"
  }

  return getSettingsSurfaceDisplayLabel(surface, scopeKind)
}

interface SettingsRouteShellProps {
  children: ReactNode
  surfaceId: SettingsSurfaceId
  route?: string
  header?: ReactNode
  breadcrumbAddon?: ReactNode
  breadcrumbs?: Array<{ label: string; href?: string }>
}

export function SettingsRouteShell({
  children,
  surfaceId,
  route,
  header,
  breadcrumbAddon,
  breadcrumbs,
}: SettingsRouteShellProps) {
  const location = useLocation()
  const navigate = useViewTransitionNavigate()
  const { user, logout } = useAuth()
  const resolvedRoute = route ?? location.pathname
  const settingsPage = useScopedSettingsPage({
    route: resolvedRoute,
    surfaceId,
  })
  const { workspaceScoped, surfaceAccess } = useScopedAppContext({ route: resolvedRoute })
  const scopeKind = workspaceScoped ? "workspace" : "personal"
  const activeSurface =
    resolveSettingsSurfaceFromRoute(resolvedRoute, {
      placement: "sidebar",
      scopeKind,
    })?.surface.id ?? surfaceId

  const groupOrder: SettingsSidebarGroup[] = workspaceScoped
    ? ["workspace", "team"]
    : ["personalWorkspace"]

  const navGroups = useMemo(() => {
    return groupOrder
      .map((group) => {
        const items = listSettingsSurfaces({
          scopeKind,
          placement: "sidebar",
          sidebarGroup: group,
        })
          .filter(isVisibleRouteSettingsSurface)
          .filter((surface) =>
            scopeKind === "workspace"
              ? canAccessWorkspaceSurface(surface, surfaceAccess)
              : true,
          )

        return {
          group,
          items,
        }
      })
      .filter((entry) => entry.items.length > 0)
  }, [groupOrder, scopeKind, surfaceAccess])

  const preloadSurface = useCallback((surface: SettingsSurfaceDefinition) => {
    void surface.preload?.().catch(() => {})
  }, [])

  return (
    <AppShellLayout
      user={user}
      onLogout={logout}
      breadcrumbs={breadcrumbs ?? settingsPage.breadcrumbs}
      header={header}
      breadcrumbAddon={breadcrumbAddon}
      contentMode="fixed"
    >
      <div className="flex min-h-0 flex-1 p-4">
        <div className="flex min-h-0 flex-1 overflow-hidden rounded-[28px] border border-border/60 bg-background shadow-xs">
          <aside
            className="relative flex w-56 shrink-0 flex-col bdry-r bdry-sidebar bg-sidebar text-sidebar-foreground"
            style={
              {
                "--sidebar": "var(--left-sidebar-surface)",
                "--sidebar-surface": "var(--left-sidebar-surface)",
                "--sidebar-accent": "var(--left-sidebar-accent)",
                "--sidebar-border": "var(--left-sidebar-border)",
              } as React.CSSProperties
            }
          >
            <div className="h-full overflow-y-auto scrollbar-hide px-2 py-3">
              <div className="px-2 py-1 text-xs font-medium text-sidebar-foreground/70">
                Settings
              </div>

              <div className="space-y-4">
                {navGroups.map(({ group, items }) => (
                  <div key={group} className="space-y-1">
                    <div className="px-2 pt-1 text-[11px] font-medium text-sidebar-foreground/45">
                      {SETTINGS_GROUP_LABELS[group]}
                    </div>
                    <div className="space-y-1">
                      {items.map((item) => {
                        const itemRoute = item.routes[scopeKind]
                        if (!itemRoute) return null

                        const Icon = item.icon
                        const isActive = activeSurface === item.id

                        return (
                          <button
                            key={itemRoute}
                            type="button"
                            data-active={isActive}
                            onClick={() => navigate(itemRoute)}
                            onMouseEnter={() => preloadSurface(item)}
                            onFocus={() => preloadSurface(item)}
                            onPointerDown={() => preloadSurface(item)}
                            className={cn(
                              "flex h-8 w-full items-center gap-2 overflow-hidden rounded-xl px-2 text-left text-sm outline-hidden ring-sidebar-ring transition-colors hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground",
                            )}
                          >
                            <Icon className="size-4 shrink-0 opacity-60" />
                            <span className="truncate">
                              {getRouteSettingsSurfaceLabel(item, scopeKind)}
                            </span>
                          </button>
                        )
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </aside>

          <div className="min-w-0 flex-1 overflow-y-auto scrollbar-hide bg-background">
            {children}
          </div>
        </div>
      </div>
    </AppShellLayout>
  )
}
