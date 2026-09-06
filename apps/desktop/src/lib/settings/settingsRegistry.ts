import type {
  ResolvedSettingsSurfaceRoute,
  SettingsPlacement,
  SettingsSidebarGroup,
  SettingsScopeKind,
  SettingsSurfaceDefinition,
  SettingsSurfaceId,
} from "@/lib/settings/settingsSurfaceTypes"
import { getTranslation, getStoredLanguage, type TranslationKey } from "@/lib/i18n"

import { asHugeIcon } from "@/lib/icons/asHugeIcon"
import {
  CommandLineIcon as __CommandLineIconHugeIcon,
  ComputerIcon as __ComputerIconHugeIcon,
  PackageIcon as __PackageIconHugeIcon,
  PaintBoardIcon as __PaintBoardIconHugeIcon,
  UserCircleIcon as __UserCircleIconHugeIcon,
  UserGroupIcon as __UserGroupIconHugeIcon,
} from "@hugeicons/core-free-icons"

const CommandLineIcon = asHugeIcon(__CommandLineIconHugeIcon)
const ComputerIcon = asHugeIcon(__ComputerIconHugeIcon)
const PackageIcon = asHugeIcon(__PackageIconHugeIcon)
const PaintBoardIcon = asHugeIcon(__PaintBoardIconHugeIcon)
const UserCircleIcon = asHugeIcon(__UserCircleIconHugeIcon)
const UserGroupIcon = asHugeIcon(__UserGroupIconHugeIcon)

const PERSONAL_DEVICE_SIDEBAR_ORDER: Record<SettingsSurfaceId, number> = {
  account: 0,
  appearance: 1,
  devapps: 2,
  organizations: 3,
  tooling: 4,
  computerUse: 5,
}

const preloadAccountPage = () => import("@/features/settings/Account")
const preloadAppearancePage = () => import("@/features/settings/Appearance")
const preloadDevAppsPage = () => import("@/features/settings/DevAppSettings")
const preloadOrganizationsPage = () => import("@/features/settings/Organizations")
const preloadComputerUsePage = () => import("@/features/settings/ComputerUse")

const preloadToolingPage = async () => {
  const module = await import("@/features/settings/Tooling")
  await module.prewarmToolingSettings?.()
}

/** Translation keys for each settings surface label. */
const SURFACE_LABEL_KEYS: Record<SettingsSurfaceId, TranslationKey> = {
  account: "settings.nav.account",
  appearance: "settings.nav.appearance",
  devapps: "settings.nav.devapps",
  organizations: "settings.nav.organizations",
  tooling: "settings.nav.localEnvironment",
  computerUse: "settings.nav.computerUse",
}

/** Resolve a surface label for the current language. */
export function getLocalizedSurfaceLabel(surfaceId: SettingsSurfaceId): string {
  const key = SURFACE_LABEL_KEYS[surfaceId]
  return getTranslation(getStoredLanguage(), key)
}

export const SETTINGS_SURFACES: readonly SettingsSurfaceDefinition[] = [
  {
    id: "account",
    label: "Account",
    icon: UserCircleIcon,
    routes: { personal: "/settings/account" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadAccountPage,
    commandKeywords: ["device", "profile", "settings"],
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: PaintBoardIcon,
    routes: { personal: "/settings/appearance" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadAppearancePage,
    commandKeywords: ["appearance", "theme", "settings"],
  },
  {
    id: "devapps",
    label: "DevApps",
    icon: PackageIcon,
    routes: { personal: "/settings/devapps" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadDevAppsPage,
    commandKeywords: ["devapps", "plugins", "apps", "store", "installed"],
  },
  {
    id: "organizations",
    label: "Organizations",
    icon: UserGroupIcon,
    routes: { personal: "/settings/organizations" },
    storageMode: { personal: "cloud" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadOrganizationsPage,
    commandKeywords: ["organization", "org", "team", "invite", "devapp"],
  },
  {
    id: "tooling",
    label: "Local environment",
    icon: CommandLineIcon,
    routes: { personal: "/settings/tooling" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadToolingPage,
    commandKeywords: ["tooling", "runtime", "framework", "local machine"],
  },
  {
    id: "computerUse",
    label: "Computer Use",
    icon: ComputerIcon,
    routes: { personal: "/settings/computer-use" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadComputerUsePage,
    commandKeywords: ["computer", "computer use", "automation", "screen", "accessibility", "permissions"],
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

export function comparePersonalDeviceSidebarSurfaces(
  a: SettingsSurfaceDefinition,
  b: SettingsSurfaceDefinition,
): number {
  const na = PERSONAL_DEVICE_SIDEBAR_ORDER[a.id]
  const nb = PERSONAL_DEVICE_SIDEBAR_ORDER[b.id]
  if (na !== nb) return na - nb
  return a.label.localeCompare(b.label)
}

export const comparePersonalContextUnifiedSettingsSidebar =
  comparePersonalDeviceSidebarSurfaces

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
  _scopeKind: SettingsScopeKind,
  _options?: {
    includeScopePrefix?: boolean
  }
): string {
  return getLocalizedSurfaceLabel(surface.id)
}

export function getSettingsScopeLabel(_scopeKind: SettingsScopeKind): string {
  return getTranslation(getStoredLanguage(), "common.settings")
}

export function getSettingsSurfaceBreadcrumbs(
  surfaceId: SettingsSurfaceId,
  scopeKind: SettingsScopeKind
): Array<{ label: string }> {
  const surface = getSettingsSurface(surfaceId)
  return [
    { label: getSettingsScopeLabel(scopeKind) },
    { label: surface?.label ?? "Settings" },
  ]
}
