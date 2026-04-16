import {
  comparePersonalContextUnifiedSettingsSidebar,
  comparePersonalDeviceSidebarSurfaces,
  listSettingsSurfaces,
} from "@/lib/settings/settingsRegistry"
import type {
  SettingsPlacement,
  SettingsSurfaceDefinition,
} from "@/lib/settings/settingsSurfaceTypes"

export interface SettingsNavigationItem {
  label: string
  route: string
  surface: SettingsSurfaceDefinition
}

export interface SettingsNavigationSection {
  id: "settings"
  label: string
  items: SettingsNavigationItem[]
}

function toNavigationItems(surfaces: SettingsSurfaceDefinition[]): SettingsNavigationItem[] {
  return surfaces.flatMap((surface) => {
    const route = surface.routes.personal
    if (!route) {
      return []
    }

    return [
      {
        label: surface.label,
        route,
        surface,
      },
    ]
  })
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
  surfaces: SettingsSurfaceDefinition[],
): SettingsNavigationSection | null {
  const items = toNavigationItems(surfaces)
  if (items.length === 0) {
    return null
  }

  return { id: "settings", label: "Settings", items }
}

export function resolveSettingsNavigationSections(
  placement: SettingsPlacement,
): SettingsNavigationSection[] {
  const section = buildSection(resolveUnifiedPersonalSurfaces(placement))
  return section ? [section] : []
}
