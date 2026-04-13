import {
  canAccessWorkspaceSurface,
  comparePersonalContextUnifiedSettingsSidebar,
  comparePersonalDeviceSidebarSurfaces,
  compareWorkspaceScopedSidebarSurfaces,
  getSettingsSurfaceDisplayLabel,
  listSettingsSurfaces,
} from "@/lib/settings/settingsRegistry"
import type {
  SettingsPlacement,
  SettingsScopeKind,
  SettingsSurfaceDefinition,
  WorkspaceSurfaceAccessState,
} from "@/lib/settings/settingsSurfaceTypes"
import type { SettingsNavChrome } from "@/lib/workspaces/settingsRoutes"

export interface SettingsNavigationItem {
  label: string
  route: string
  scopeKind: SettingsScopeKind
  surface: SettingsSurfaceDefinition
}

export interface SettingsNavigationSection {
  id: "settings" | "team" | "workspace" | "userSettings"
  label: string
  items: SettingsNavigationItem[]
}

function toNavigationItems(
  surfaces: SettingsSurfaceDefinition[],
  scopeKind: SettingsScopeKind,
): SettingsNavigationItem[] {
  return surfaces.flatMap((surface) => {
    const route = surface.routes[scopeKind]
    if (!route) {
      return []
    }

    return [
      {
        label:
          surface.id === "cliTools" && scopeKind === "workspace"
            ? "Integrations"
            : getSettingsSurfaceDisplayLabel(surface, scopeKind),
        route,
        scopeKind,
        surface,
      },
    ]
  })
}

function resolveWorkspaceSurfaces(
  placement: SettingsPlacement,
  sidebarGroup: "team" | "workspace",
  access: WorkspaceSurfaceAccessState,
): SettingsSurfaceDefinition[] {
  return listSettingsSurfaces({
    scopeKind: "workspace",
    placement,
    sidebarGroup,
  })
    .filter((surface) => canAccessWorkspaceSurface(surface, access))
    .sort(compareWorkspaceScopedSidebarSurfaces)
}

function resolvePersonalDeviceSurfaces(
  placement: SettingsPlacement,
): SettingsSurfaceDefinition[] {
  return listSettingsSurfaces({
    scopeKind: "personal",
    placement,
    sidebarGroup: "personalDevice",
  }).sort(comparePersonalDeviceSidebarSurfaces)
}

function resolvePersonalWorkspaceSurfaces(
  placement: SettingsPlacement,
): SettingsSurfaceDefinition[] {
  return listSettingsSurfaces({
    scopeKind: "personal",
    placement,
    sidebarGroup: "personalWorkspace",
  })
}

function resolveUnifiedPersonalSurfaces(
  placement: SettingsPlacement,
): SettingsSurfaceDefinition[] {
  const personalWorkspaceSurfaces = resolvePersonalWorkspaceSurfaces(placement)
  const personalDeviceSurfaces = resolvePersonalDeviceSurfaces(placement)
  const seen = new Set<string>()
  const merged: SettingsSurfaceDefinition[] = []

  for (const surface of [...personalWorkspaceSurfaces, ...personalDeviceSurfaces]) {
    if (seen.has(surface.id)) {
      continue
    }
    seen.add(surface.id)
    merged.push(surface)
  }

  merged.sort(comparePersonalContextUnifiedSettingsSidebar)
  return merged
}

function buildSection(
  id: SettingsNavigationSection["id"],
  label: string,
  surfaces: SettingsSurfaceDefinition[],
  scopeKind: SettingsScopeKind,
): SettingsNavigationSection | null {
  const items = toNavigationItems(surfaces, scopeKind)
  if (items.length === 0) {
    return null
  }

  return { id, label, items }
}

export function resolveSettingsNavigationSections(input: {
  placement: SettingsPlacement
  navChrome: SettingsNavChrome
  access: WorkspaceSurfaceAccessState
}): SettingsNavigationSection[] {
  const { placement, navChrome, access } = input
  const workspaceTeamSection = buildSection(
    "team",
    "Team",
    resolveWorkspaceSurfaces(placement, "team", access),
    "workspace",
  )
  const workspaceSection = buildSection(
    "workspace",
    "Workspace",
    resolveWorkspaceSurfaces(placement, "workspace", access),
    "workspace",
  )
  const userSettingsSection = buildSection(
    "userSettings",
    "User settings",
    resolveUnifiedPersonalSurfaces(placement),
    "personal",
  )
  const personalSettingsSection = buildSection(
    "settings",
    "Settings",
    resolveUnifiedPersonalSurfaces(placement),
    "personal",
  )

  switch (navChrome) {
    case "personalUnified":
      return personalSettingsSection ? [personalSettingsSection] : []
    case "orgWorkspaceAdmin":
      return [workspaceTeamSection, workspaceSection].filter(
        (section): section is SettingsNavigationSection => section !== null,
      )
    case "userSettings":
      return userSettingsSection ? [userSettingsSection] : []
    case "mixed":
    default:
      return [workspaceTeamSection, workspaceSection, userSettingsSection].filter(
        (section): section is SettingsNavigationSection => section !== null,
      )
  }
}
