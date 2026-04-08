import {
  Cloud,
  CreditCard,
  FileText,
  FolderGit2,
  HardDrive,
  Lock,
  Palette,
  Shield,
  Terminal,
  UserCircle2,
  Users,
  Wrench,
} from "lucide-react"

import type {
  ResolvedSettingsSurfaceRoute,
  SettingsPlacement,
  SettingsScopeKind,
  SettingsSidebarGroup,
  SettingsSurfaceDefinition,
  SettingsSurfaceId,
  WorkspaceSurfaceAccessState,
} from "@/lib/settings/settingsSurfaceTypes"

/** Org workspace sidebar only (no user-only surfaces) */
const WORKSPACE_SCOPED_SIDEBAR_ORDER: Partial<Record<SettingsSurfaceId, number>> = {
  general: 0,
  billing: 1,
  cliTools: 2,
  cloudStorage: 3,
}

/** User + this device (personal routes; shown under “Personal” when org workspace is active) */
const PERSONAL_DEVICE_SIDEBAR_ORDER: Partial<Record<SettingsSurfaceId, number>> = {
  account: 0,
  sourceControl: 1,
  appearance: 2,
  storage: 3,
  tooling: 4,
}

/** Single “Settings” list when the active workspace is personal (everything is user settings UX) */
const PERSONAL_CONTEXT_UNIFIED_SIDEBAR_ORDER: Partial<Record<SettingsSurfaceId, number>> = {
  general: 0,
  account: 1,
  sourceControl: 2,
  appearance: 3,
  cliTools: 4,
  cloudStorage: 5,
  storage: 6,
  tooling: 7,
}

export function compareWorkspaceScopedSidebarSurfaces(
  a: SettingsSurfaceDefinition,
  b: SettingsSurfaceDefinition,
): number {
  const na = WORKSPACE_SCOPED_SIDEBAR_ORDER[a.id] ?? 100
  const nb = WORKSPACE_SCOPED_SIDEBAR_ORDER[b.id] ?? 100
  if (na !== nb) return na - nb
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
const preloadBillingPage = () => import("@/pages/workspace/Billing")
const preloadAppearancePage = () => import("@/pages/settings/Appearance")
const preloadGeneralPage = () => import("@/pages/workspace/General")
const preloadStoragePage = async () => {
  const module = await import("@/pages/settings/Storage")
  await module.prewarmStorageSettings?.()
}
const preloadSourceControlPage = () => import("@/pages/workspace/SourceControl")
const preloadCliToolsPage = () => import("@/pages/workspace/Integrations")
const preloadToolingPage = async () => {
  const module = await import("@/pages/settings/Tooling")
  await module.prewarmToolingSettings?.()
}
const preloadPoliciesPage = () => import("@/pages/workspace/Policies")
const preloadMembersPage = () => import("@/pages/teams/Members")
const preloadCloudStoragePage = () => import("@/pages/workspace/Sync")
const preloadPermissionsPage = () => import("@/pages/teams/Roles")

export const SETTINGS_SURFACES: readonly SettingsSurfaceDefinition[] = [
  {
    id: "account",
    label: "Account",
    icon: UserCircle2,
    routes: { personal: "/settings/account" },
    storageMode: { personal: "cloud" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadAccountPage,
    commandKeywords: ["account", "profile", "settings"],
  },
  {
    id: "billing",
    label: "Billing",
    icon: CreditCard,
    routes: { personal: "/settings/billing", workspace: "/workspace/billing" },
    storageMode: { personal: "cloud", workspace: "cloud" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { workspace: "workspace" },
    workspaceAccessKey: "billing",
    preload: preloadBillingPage,
    commandKeywords: ["billing", "subscription", "payment", "usage", "plan"],
  },
  {
    id: "appearance",
    label: "Appearance",
    icon: Palette,
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
    icon: HardDrive,
    routes: { personal: "/settings/storage" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadStoragePage,
    commandKeywords: ["storage", "disk", "local files"],
  },
  {
    id: "sourceControl",
    label: "Source Control",
    icon: FolderGit2,
    routes: { personal: "/settings/source-control" },
    storageMode: { personal: "cloud" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadSourceControlPage,
    commandKeywords: ["source control", "git", "github", "gitlab", "repository", "repos"],
  },
  {
    id: "cliTools",
    label: "CLI Tools",
    icon: Wrench,
    routes: {
      personal: "/settings/cli-tools",
      workspace: "/workspace/integrations",
    },
    storageMode: { personal: "cloud", workspace: "cloud" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalWorkspace", workspace: "workspace" },
    workspaceAccessKey: "integrations",
    preload: preloadCliToolsPage,
    commandKeywords: ["cli", "tools", "integrations", "connect", "services", "terminal"],
  },
  {
    id: "tooling",
    label: "Tooling",
    icon: Terminal,
    routes: { personal: "/settings/tooling" },
    storageMode: { personal: "local" },
    placements: ["drawer", "sidebar", "command", "settingsWindow"],
    sidebarGroups: { personal: "personalDevice" },
    preload: preloadToolingPage,
    commandKeywords: ["tooling", "runtime", "framework", "local machine"],
  },
  {
    id: "general",
    label: "General",
    icon: FileText,
    routes: { personal: "/settings/general", workspace: "/workspace/general" },
    storageMode: { personal: "cloud", workspace: "cloud" },
    placements: ["drawer", "sidebar", "command"],
    sidebarGroups: { personal: "personalWorkspace", workspace: "workspace" },
    workspaceAccessKey: "general",
    preload: preloadGeneralPage,
    commandKeywords: ["workspace", "general", "settings"],
  },
  {
    id: "policies",
    label: "Policies",
    icon: Lock,
    routes: { workspace: "/workspace/policies" },
    storageMode: { workspace: "cloud" },
    placements: ["drawer", "sidebar", "command"],
    sidebarGroups: { workspace: "team" },
    workspaceAccessKey: "settings",
    commandKeywords: ["policies", "governance", "sharing", "retention"],
    preload: preloadPoliciesPage,
  },
  {
    id: "members",
    label: "Members",
    icon: Users,
    routes: { workspace: "/teams" },
    storageMode: { workspace: "cloud" },
    placements: ["drawer", "sidebar", "command"],
    sidebarGroups: { workspace: "team" },
    workspaceAccessKey: "members",
    preload: preloadMembersPage,
    commandKeywords: ["team", "members", "organization", "invite"],
  },
  {
    id: "permissions",
    label: "Permissions",
    icon: Shield,
    routes: { workspace: "/teams/roles" },
    storageMode: { workspace: "cloud" },
    placements: ["drawer", "sidebar", "command"],
    sidebarGroups: { workspace: "team" },
    workspaceAccessKey: "roles",
    alpha: true,
    preload: preloadPermissionsPage,
    commandKeywords: ["permissions", "roles", "iam", "access"],
  },
  {
    id: "cloudStorage",
    label: "Cloud Storage",
    icon: Cloud,
    routes: { personal: "/settings/cloud-storage", workspace: "/workspace/sync" },
    storageMode: { personal: "cloud", workspace: "cloud" },
    placements: ["drawer", "sidebar", "command"],
    sidebarGroups: { personal: "personalWorkspace", workspace: "workspace" },
    workspaceAccessKey: "usage",
    alpha: true,
    preload: preloadCloudStoragePage,
    commandKeywords: ["cloud storage", "sync", "usage", "storage"],
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
    case "usage":
      return access.canViewWorkspaceUsage || access.canManageWorkspaceBilling
    default:
      return true
  }
}
