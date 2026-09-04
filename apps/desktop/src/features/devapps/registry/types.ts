import type { ProviderKind } from "@cozea/assistant-contracts";
import type { DevAppParts } from "@shared/devAppParts";

import type { RenderableWorkbenchTileType } from "@/lib/workbenchTileContract";

export type DevAppCategoryId =
  | "discover"
  | "agent-kits"
  | "preview-tools"
  | "runtimes"
  | "build-release"
  | "themes"
  | "updates";

export type DevAppLauncherGroup = "Development" | "Assistant";

export type DevAppWorkbenchTileTarget = Exclude<RenderableWorkbenchTileType, "selection">;

export interface DevAppIconDefinition {
  src: string;
  alt?: string;
  className?: string;
}

export interface DevAppLauncherMetadata {
  enabled: boolean;
  order: number;
  group: DevAppLauncherGroup;
  searchTerms?: string[];
}

export interface DevAppStoreMetadata {
  categoryLabel: string;
  accentClassName: string;
  badgeLabel?: string;
  featured?: boolean;
}

interface DevAppLaunchBase {
  tileType: DevAppWorkbenchTileTarget;
  singleton?: boolean;
}

export interface DevAppBrowserLaunchSpec extends DevAppLaunchBase {
  kind: "browser";
  tileType: "browser";
}

export interface DevAppTerminalLaunchSpec extends DevAppLaunchBase {
  kind: "terminal";
  tileType: "terminal";
}

export interface DevAppDevServerLaunchSpec extends DevAppLaunchBase {
  kind: "devServer";
  tileType: "devServer";
  singleton: true;
}

export interface ProjectDevAppLaunchSpec extends DevAppLaunchBase {
  kind: "projectDevApp";
  tileType: "devServer";
  singleton: true;
  publicationId: string;
  releaseId: string;
  releaseVersion: number;
  projectId: string;
  sourceWorkspaceId?: string;
  sourceLaneId?: string;
  name: string;
  framework: string;
  devCommand: string;
  devPort?: number;
}

export interface DevelopmentDevAppLaunchSpec extends DevAppLaunchBase {
  kind: "developmentDevApp";
  tileType: "devAppPreview";
  ref: string;
  sourceId: string;
  projectId: string;
  workspaceId: string;
  relativePath: string;
  name: string;
}

export interface PublishedDevAppLaunchSpec extends DevAppLaunchBase {
  kind: "publishedDevApp";
  tileType: "orgDevApp";
  singleton?: false;
  /** Durable authority-preserving identity; `latest` refs follow the active release. */
  ref: string;
  publicationId: string;
  organizationId: string;
  organizationName: string;
  releaseId: string;
  releaseVersion: number;
  name: string;
  framework: string;
  contentHash: string;
  entryPath: string;
  runtimeKind: "static" | "service";
  permissionSetHash?: string | null;
  logoDataUrl?: string | null;
}

export interface InstalledDevAppLaunchSpec extends DevAppLaunchBase {
  kind: "installedDevApp";
  tileType: "devApp";
  installationId: string;
  releaseId: string;
  appId: string;
  appVersion: string;
  surfaceId: string;
  name: string;
}

export interface DevAppMobileSimulatorLaunchSpec extends DevAppLaunchBase {
  kind: "mobileSimulator";
  tileType: "mobileSimulator";
  singleton: true;
}

export interface DevAppMemoryLaunchSpec extends DevAppLaunchBase {
  kind: "memory";
  tileType: "memory";
  singleton: true;
}

export interface DevAppLlamaLaunchSpec extends DevAppLaunchBase {
  kind: "llama";
  tileType: "llama";
  singleton: true;
}

export interface DevAppAssistantLaunchSpec extends DevAppLaunchBase {
  kind: "assistantChat";
  tileType: "assistantChat";
  provider: ProviderKind;
}

export type DevAppLaunchSpec =
  | DevAppAssistantLaunchSpec
  | DevAppBrowserLaunchSpec
  | DevAppDevServerLaunchSpec
  | DevelopmentDevAppLaunchSpec
  | InstalledDevAppLaunchSpec
  | DevAppLlamaLaunchSpec
  | DevAppMemoryLaunchSpec
  | DevAppMobileSimulatorLaunchSpec
  | PublishedDevAppLaunchSpec
  | ProjectDevAppLaunchSpec
  | DevAppTerminalLaunchSpec;

export interface DevAppManifest {
  id: string;
  name: string;
  description: string;
  categories: DevAppCategoryId[];
  icon: DevAppIconDefinition;
  launcher: DevAppLauncherMetadata;
  store: DevAppStoreMetadata;
  /** Composable runtime model; surfaces are derived from this, never from the launch union. */
  parts: DevAppParts;
  launch: DevAppLaunchSpec;
}

export interface DevAppLaunchRequest {
  appId: string;
  publishedDevApp?: PublishedDevAppLaunchSpec;
  projectDevApp?: ProjectDevAppLaunchSpec;
  developmentDevApp?: DevelopmentDevAppLaunchSpec;
  installedDevApp?: InstalledDevAppLaunchSpec;
}
