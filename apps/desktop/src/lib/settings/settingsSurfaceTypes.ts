import type { ComponentType, SVGProps } from "react"

export type SettingsScopeKind = "personal"
export type SettingsStorageMode = "local" | "cloud"
export type SettingsPlacement = "drawer" | "sidebar" | "command" | "settingsWindow"
export type SettingsSidebarGroup = "personalDevice"

export type SettingsSurfaceId =
  | "account"
  | "appearance"
  | "devapps"
  | "organizations"
  | "tooling"
  | "computerUse"

export interface SettingsSurfaceDefinition {
  id: SettingsSurfaceId
  label: string
  icon: ComponentType<SVGProps<SVGSVGElement>>
  routes: Partial<Record<SettingsScopeKind, string>>
  storageMode: Partial<Record<SettingsScopeKind, SettingsStorageMode>>
  placements: SettingsPlacement[]
  sidebarGroups?: Partial<Record<SettingsScopeKind, SettingsSidebarGroup>>
  commandKeywords: string[]
  alpha?: boolean
  preload?: () => Promise<unknown>
}

export interface ResolvedSettingsSurfaceRoute {
  route: string
  scopeKind: SettingsScopeKind
  surface: SettingsSurfaceDefinition
}
