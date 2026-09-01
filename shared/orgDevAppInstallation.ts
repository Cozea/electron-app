import type { DevAppParts } from "./devAppParts"
import type { DevAppRuntimeReleaseImage } from "./devAppContainedRuntime"

/**
 * One immutable organization release installed on this device.
 *
 * Installations are deliberately device-local. Convex remains the catalog and release
 * authority, while this record is the offline-capable, exact-version launch authority.
 */
export interface OrgDevAppInstallation {
  ref: string
  publicationId: string
  organizationId: string
  organizationName: string
  name: string
  description: string | null
  logoDataUrl: string | null
  active: boolean
  installedAt: number
  lastUsedAt: number
  sizeBytes: number
  activeRelease: {
    id: string
    version: number
    framework: string
    entryPath: string
    contentHash: string
    runtimeKind: "static" | "service"
    manifestVersion: number | null
    platform: string | null
    arch: string | null
    permissionSetHash: string | null
    publisherIdentityKey: string | null
    publisherDeviceLabel: string | null
    parts: DevAppParts
    runtimeSourceDigest: string | null
    packageManifestDigest: string | null
    runtimeImage: DevAppRuntimeReleaseImage | null
  }
}

export interface OrgDevAppInstallRequest {
  downloadUrl: string
  installation: Omit<
    OrgDevAppInstallation,
    "active" | "installedAt" | "lastUsedAt" | "sizeBytes"
  >
}

export interface OrgDevAppInstalledArtifact {
  installation: OrgDevAppInstallation
  originUrl: string
  servicePermissions?: { network: boolean; persistentData: boolean }
}
