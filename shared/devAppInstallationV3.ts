import type { DevAppCapability } from "./devAppCapabilities"
import type {
  DevAppContributionsV3,
  DevAppReleaseManifestV1,
  DevAppSurfacePlacementV3,
} from "./devAppManifestV3"

export const DEV_APP_INSTALLATION_REGISTRY_VERSION = 1 as const

export type DevAppInstallationSourceV3 =
  | {
      kind: "development"
      workspaceId: string
      relativePath: string
    }
  | {
      kind: "system"
      systemId: string
    }
  | {
      kind: "organization"
      organizationId: string
      publicationId: string
    }

export interface DevAppInstalledReleaseV3 {
  releaseId: string
  appVersion: string
  installedAt: number
  sizeBytes: number
  manifest: DevAppReleaseManifestV1
}

/** One app identity installed on this device, with bounded rollback history. */
export interface DevAppInstallationV3 {
  installationId: string
  appId: string
  name: string
  description: string | null
  source: DevAppInstallationSourceV3
  installedAt: number
  updatedAt: number
  activeReleaseId: string
  releases: DevAppInstalledReleaseV3[]
}

export interface DevAppInstallationRegistryV3 {
  version: typeof DEV_APP_INSTALLATION_REGISTRY_VERSION
  installations: DevAppInstallationV3[]
}

interface PreparedDevAppSurfaceBaseV3 {
  installationId: string
  releaseId: string
  appId: string
  appVersion: string
  surfaceId: string
  title: string
  description?: string
  placement?: DevAppSurfacePlacementV3
  permissions: {
    required: DevAppCapability[]
    optional: DevAppCapability[]
  }
  contributions: DevAppContributionsV3
}

export interface PreparedNativeReactDevAppSurfaceV3
  extends PreparedDevAppSurfaceBaseV3 {
  kind: "nativeReact"
  component: string
  moduleUrl: string
  stylesUrl?: string
}

export interface PreparedWebDevAppSurfaceV3 extends PreparedDevAppSurfaceBaseV3 {
  kind: "webApp"
  applicationId: string
  url: string
}

export type PreparedDevAppSurfaceV3 =
  | PreparedNativeReactDevAppSurfaceV3
  | PreparedWebDevAppSurfaceV3

export type DevAppInstallationListResultV3 =
  | { success: true; installations: DevAppInstallationV3[] }
  | { success: false; error: string }

export type DevAppInstallDevelopmentResultV3 =
  | { success: true; installation: DevAppInstallationV3 }
  | { success: false; error: string }

export type DevAppPrepareSurfaceResultV3 =
  | { success: true; surface: PreparedDevAppSurfaceV3 }
  | { success: false; error: string }

export type DevAppUninstallResultV3 =
  | { success: true; removed: boolean }
  | { success: false; error: string }

export type DevAppActivateReleaseResultV3 =
  | { success: true; installation: DevAppInstallationV3 }
  | { success: false; error: string }
