import type { ProviderKind } from "@cozea/assistant-contracts"

export type DevAppCategoryId =
  | "discover"
  | "agent-kits"
  | "preview-tools"
  | "runtimes"
  | "build-release"
  | "themes"
  | "updates"

export type DevAppLauncherGroup = "Development" | "Assistant"

export type DevAppWorkbenchTileTarget =
  | "assistantChat"
  | "browser"
  | "devServer"
  | "mobileSimulator"
  | "orgDevApp"
  | "terminal"

export interface DevAppIconDefinition {
  src: string
  alt?: string
  className?: string
}

export interface DevAppLauncherMetadata {
  enabled: boolean
  order: number
  group: DevAppLauncherGroup
  searchTerms?: string[]
}

export interface DevAppStoreMetadata {
  categoryLabel: string
  accentClassName: string
  badgeLabel?: string
  featured?: boolean
}

interface DevAppLaunchBase {
  tileType: DevAppWorkbenchTileTarget
  singleton?: boolean
}

export interface DevAppBrowserLaunchSpec extends DevAppLaunchBase {
  kind: "browser"
  tileType: "browser"
}

export interface DevAppTerminalLaunchSpec extends DevAppLaunchBase {
  kind: "terminal"
  tileType: "terminal"
}

export interface DevAppDevServerLaunchSpec extends DevAppLaunchBase {
  kind: "devServer"
  tileType: "devServer"
  singleton: true
}

export interface ProjectDevAppLaunchSpec extends DevAppLaunchBase {
  kind: "projectDevApp"
  tileType: "devServer"
  singleton: true
  publicationId: string
  releaseId: string
  releaseVersion: number
  projectId: string
  sourceWorkspaceId?: string
  sourceLaneId?: string
  name: string
  framework: string
  devCommand: string
  devPort?: number
}

export interface PublishedDevAppLaunchSpec extends DevAppLaunchBase {
  kind: "publishedDevApp"
  tileType: "orgDevApp"
  singleton?: false
  publicationId: string
  organizationId: string
  organizationName: string
  releaseId: string
  releaseVersion: number
  name: string
  framework: string
  contentHash: string
  entryPath: string
  runtimeKind: "static" | "service"
  permissionSetHash?: string | null
  logoDataUrl?: string | null
}

export interface DevAppMobileSimulatorLaunchSpec extends DevAppLaunchBase {
  kind: "mobileSimulator"
  tileType: "mobileSimulator"
  singleton: true
}

export interface DevAppAssistantLaunchSpec extends DevAppLaunchBase {
  kind: "assistantChat"
  tileType: "assistantChat"
  provider: ProviderKind
}

export type DevAppLaunchSpec =
  | DevAppAssistantLaunchSpec
  | DevAppBrowserLaunchSpec
  | DevAppDevServerLaunchSpec
  | DevAppMobileSimulatorLaunchSpec
  | PublishedDevAppLaunchSpec
  | ProjectDevAppLaunchSpec
  | DevAppTerminalLaunchSpec

export interface DevAppManifest {
  id: string
  name: string
  description: string
  categories: DevAppCategoryId[]
  icon: DevAppIconDefinition
  launcher: DevAppLauncherMetadata
  store: DevAppStoreMetadata
  launch: DevAppLaunchSpec
}

export interface DevAppLaunchRequest {
  appId: string
  publishedDevApp?: PublishedDevAppLaunchSpec
  projectDevApp?: ProjectDevAppLaunchSpec
}
