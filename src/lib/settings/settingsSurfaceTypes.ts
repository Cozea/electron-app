import type { LucideIcon } from "lucide-react"

export type SettingsScopeKind = "personal" | "workspace"
export type SettingsStorageMode = "local" | "cloud"
export type SettingsPlacement = "drawer" | "sidebar" | "command" | "settingsWindow"
export type SettingsSidebarGroup = "team" | "workspace" | "personalWorkspace"
export type WorkspaceSurfaceAccessKey =
  | "general"
  | "members"
  | "roles"
  | "billing"
  | "settings"
  | "ai"
  | "integrations"
  | "usage"

export type SettingsSurfaceId =
  | "account"
  | "billing"
  | "ai"
  | "modelSelection"
  | "appearance"
  | "storage"
  | "cliTools"
  | "tooling"
  | "general"
  | "policies"
  | "members"
  | "permissions"
  | "cloudStorage"

export interface SettingsSurfaceDefinition {
  id: SettingsSurfaceId
  label: string
  icon: LucideIcon
  routes: Partial<Record<SettingsScopeKind, string>>
  storageMode: Partial<Record<SettingsScopeKind, SettingsStorageMode>>
  placements: SettingsPlacement[]
  sidebarGroups?: Partial<Record<SettingsScopeKind, SettingsSidebarGroup>>
  commandKeywords: string[]
  workspaceAccessKey?: WorkspaceSurfaceAccessKey
  alpha?: boolean
  preload?: () => Promise<unknown>
}

export interface ResolvedSettingsSurfaceRoute {
  route: string
  scopeKind: SettingsScopeKind
  surface: SettingsSurfaceDefinition
}

export interface WorkspaceSurfaceAccessState {
  canManageWorkspaceBilling: boolean
  canViewWorkspaceAi: boolean
  canViewWorkspaceGeneral: boolean
  canViewWorkspaceIntegrations: boolean
  canViewWorkspaceMembers: boolean
  canViewWorkspaceRoles: boolean
  canViewWorkspaceSettings: boolean
  canViewWorkspaceUsage: boolean
}
