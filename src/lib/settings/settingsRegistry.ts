import type {
  ResolvedSettingsSurfaceRoute,
  SettingsPlacement,
  SettingsScopeKind,
  SettingsSurfaceDefinition,
  SettingsSurfaceId,
  WorkspaceSurfaceAccessState,
} from "@/lib/settings/settingsSurfaceTypes"

import { asHugeIcon } from '@/lib/icons/asHugeIcon'
import { CircleArrowDataTransferDiagonalIcon as __CircleStackIconHugeIcon, CommandLineIcon as __CommandLineIconHugeIcon, SwatchIcon as __SwatchIconHugeIcon, UserCircleIcon as __UserCircleIconHugeIcon } from '@hugeicons/core-free-icons'

const CircleStackIcon = asHugeIcon(__CircleStackIconHugeIcon)
const CommandLineIcon = asHugeIcon(__CommandLineIconHugeIcon)
const SwatchIcon = asHugeIcon(__SwatchIconHugeIcon)
const UserCircleIcon = asHugeIcon(__UserCircleIconHugeIcon)

/** User + this device (personal routes; shown under “Personal” when org workspace is active) */
const PERSONAL_DEVICE_SIDEBAR_ORDER: Partial<Record<SettingsSurfaceId, number>> = {
  account: 0,
  appearance: 1,
  storage: 2,
  tooling: 3,
}

/** Single “Settings” list when the active workspace is personal (everything is user settings UX) */
const PERSONAL_CONTEXT_UNIFIED_SIDEBAR_ORDER: Partial<Record<SettingsSurfaceId, number>> = {
  account: 0,
  appearance: 1,
  storage: 2,
  tooling: 3,
}

export function compareWorkspaceScopedSidebarSurfaces(
  a: SettingsSurfaceDefinition,
  b: SettingsSurfaceDefinition,
): number {
  return a.label.localeCompare(b.label)
}

export function comparePersonalDeviceSidebarSurfaces(
  a: SettingsSurfaceDefinition,
  b: SettingsSurfaceDefinition,
): number {
  const na = PERSONAL_DEVICE_SIDEBAR_ORDER[a.id] ?? 100
  const nb = PERSONAL_DEVICE_SIDEBAR_ORDER[b.id] ?? 100
  if (na !== nb) return na - nb
  return a.label.localeCompare(b.label)
}

export function comparePersonalContextUnifiedSettingsSidebar(
  a: SettingsSurfaceDefinition,
  b: SettingsSurfaceDefinition,
): number {
  const na = PERSONAL_CONTEXT_UNIFIED_SIDEBAR_ORDER[a.id] ?? 100
  const nb = PERSONAL_CONTEXT_UNIFIED_SIDEBAR_ORDER[b.id] ?? 100
  if (na !== nb) return na - nb
  return a.label.localeCompare(b.label)
}

const preloadAccountPage = () => import("@/pages/settings/Account")
const preloadAppearancePage = () => import("@/pages/settings/Appearance")
const preloadStoragePage = async () => {
  const module = await import("@/pages/settings/Storage")
  await module.prewarmStorageSettings?.()
}
const preloadToolingPage = async () => {
  const module = await import("@/pages/settings/Tooling")
  await module.prewarmToolingSettings?.()
}

export const SETTINGS_SURFACES: readonly SettingsSurfaceDefinition[] = [
  {
    id: "account",
    label: "Account",
    icon: UserCircleIcon,
    routes: { personal: "/settings/account" },
    storageMode: { personal: "cloud" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadAccountPage,
    commandKeywords: ["device", "profile", "settings"],
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: SwatchIcon,
    routes: { personal: "/settings/appearance" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadAppearancePage,
    commandKeywords: ["appearance", "theme", "settings"],
  },
  {
    id: "storage",
    label: "Storage",
    icon: CircleStackIcon,
    routes: { personal: "/settings/storage" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadStoragePage,
    commandKeywords: ["storage", "disk", "local files"],
  },
  {
    id: "tooling",
    label: "Tooling",
    icon: CommandLineIcon,
    routes: { personal: "/settings/tooling" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadToolingPage,
    commandKeywords: ["tooling", "runtime", "framework", "local machine"],
  },
] as const

export const SETTINGS_SURFACE_IDS = new Set<SettingsSurfaceId>(
  SETTINGS_SURFACES.map((surface) => surface.id)
)

function normalizeRoutePath(route?: string | null): string {
  if (!route) return "/"
  const [path] = route.split("?")
  const withLeadingSlash = path.startsWith("/") ? path : `/${path}`
  return withLeadingSlash.replace(/\/+$/, "") || "/"
}

export function getSettingsSurface(surfaceId: SettingsSurfaceId): SettingsSurfaceDefinition | null {
  return SETTINGS_SURFACES.find((surface) => surface.id === surfaceId) ?? null
}

export function getSettingsSurfaceRoute(
  surfaceId: SettingsSurfaceId,
  scopeKind: SettingsScopeKind
): string | null {
  return getSettingsSurface(surfaceId)?.routes[scopeKind] ?? null
}

export function listSettingsSurfaces(options: {
  scopeKind: SettingsScopeKind
  placement?: SettingsPlacement
  sidebarGroup?: SettingsSidebarGroup
}): SettingsSurfaceDefinition[] {
  const { scopeKind, placement, sidebarGroup } = options

  return SETTINGS_SURFACES.filter((surface) => {
    if (!surface.routes[scopeKind]) return false
    if (placement && !surface.placements.includes(placement)) return false
    if (sidebarGroup && surface.sidebarGroups?.[scopeKind] !== sidebarGroup) return false
    return true
  })
}

export function resolveSettingsSurfaceFromRoute(
  route?: string | null,
  options?: {
    placement?: SettingsPlacement
    scopeKind?: SettingsScopeKind
  }
): ResolvedSettingsSurfaceRoute | null {
  const normalizedRoute = normalizeRoutePath(route)
  const matches: ResolvedSettingsSurfaceRoute[] = []

  for (const surface of SETTINGS_SURFACES) {
    if (options?.placement && !surface.placements.includes(options.placement)) {
      continue
    }

    const routeEntries = Object.entries(surface.routes) as Array<[SettingsScopeKind, string]>
    for (const [scopeKind, surfaceRoute] of routeEntries) {
      if (options?.scopeKind && options.scopeKind !== scopeKind) {
        continue
      }

      const normalizedSurfaceRoute = normalizeRoutePath(surfaceRoute)
      const matchesRoute =
        normalizedRoute === normalizedSurfaceRoute ||
        normalizedRoute.startsWith(`${normalizedSurfaceRoute}/`)

      if (!matchesRoute) {
        continue
      }

      matches.push({
        route: normalizedSurfaceRoute,
        scopeKind,
        surface,
      })
    }
  }

  if (matches.length === 0) {
    return null
  }

  return matches.sort((left, right) => right.route.length - left.route.length)[0]
}

export function getSettingsSurfaceDisplayLabel(
  surface: SettingsSurfaceDefinition,
  scopeKind: SettingsScopeKind,
  options?: {
    includeScopePrefix?: boolean
  }
): string {
  if (!options?.includeScopePrefix) {
    return surface.label
  }

  if (surface.routes.personal && surface.routes.workspace) {
    return scopeKind === "workspace" ? `Workspace ${surface.label}` : `Personal ${surface.label}`
  }

  return surface.label
}

export function getSettingsScopeLabel(scopeKind: SettingsScopeKind): string {
  return scopeKind === 'workspace' ? 'Workspace' : 'Settings'
}

export function getSettingsSurfaceBreadcrumbs(
  surfaceId: SettingsSurfaceId,
  scopeKind: SettingsScopeKind
): Array<{ label: string }> {
  const surface = getSettingsSurface(surfaceId)
  return [
    { label: getSettingsScopeLabel(scopeKind) },
    { label: surface?.label ?? 'Settings' },
  ]
}

export function canAccessWorkspaceSurface(
  surface: SettingsSurfaceDefinition,
  access: WorkspaceSurfaceAccessState
): boolean {
  switch (surface.workspaceAccessKey) {
    case "general":
      return access.canViewWorkspaceGeneral
    case "members":
      return access.canViewWorkspaceMembers
    case "roles":
      return access.canViewWorkspaceRoles
    case "billing":
      return access.canViewWorkspaceUsage || access.canManageWorkspaceBilling
    case "settings":
      return access.canViewWorkspaceSettings
    case "integrations":
      return access.canViewWorkspaceIntegrations
    default:
      return true
  }
}
