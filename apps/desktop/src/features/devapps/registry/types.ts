import type { ProviderKind } from "@cozea/assistant-contracts"
import type { DevAppParts } from "@shared/devAppParts"

import type { RenderableWorkbenchTileType } from "@/features/projects/lib/workbenchTileRegistry"

export type DevAppCategoryId =
  | "discover"
  | "agent-kits"
  | "preview-tools"
  | "runtimes"
  | "build-release"
  | "themes"
  | "updates"

export type DevAppLauncherGroup = "Development" | "Assistant"

export type DevAppWorkbenchTileTarget = Exclude<
  RenderableWorkbenchTileType,
  "selection" | "devAppPreview"
>

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

export interface DevAppLlamaLaunchSpec extends DevAppLaunchBase {
  kind: "llama"
  tileType: "llama"
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
  | DevAppLlamaLaunchSpec
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
  /** Composable runtime model; surfaces are derived from this, never from the launch union. */
  parts: DevAppParts
  launch: DevAppLaunchSpec
}

export interface DevAppLaunchRequest {
  appId: string
  publishedDevApp?: PublishedDevAppLaunchSpec
  projectDevApp?: ProjectDevAppLaunchSpec
}
