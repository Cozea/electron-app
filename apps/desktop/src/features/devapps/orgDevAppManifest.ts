import { resolveProjectDevAppDisplayLogoDataUrl } from "@/features/devapps/projectDevAppLogo"
import { buildPublishedDevAppIconDefinition } from "@/features/devapps/publishedDevAppIcon"
import type { DevAppManifest, PublishedDevAppLaunchSpec } from "@/features/devapps/registry/types"
import type { DevAppParts } from "@shared/devAppParts"
import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation"
import { formatDevAppRef } from "@shared/devAppRef"
import { buildOrgDevAppUrl } from "@shared/orgDevAppProtocol"

export interface OrgDevAppConsumerRecord {
  publicationId: string
  organizationId: string
  organizationName: string
  name: string
  description: string | null
  logoDataUrl: string | null
  status: "active" | "archived"
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
  }
}

export function buildPublishedDevAppId(publicationId: string): string {
  return `org-devapp:${publicationId}`
}

export function buildPublishedDevAppLaunchSpec(
  entry: OrgDevAppConsumerRecord,
  ref: string = formatDevAppRef({
    kind: "publication",
    organizationId: entry.organizationId,
    publicationId: entry.publicationId,
    version: "latest",
  }),
): PublishedDevAppLaunchSpec {
  const logoDataUrl = resolveProjectDevAppDisplayLogoDataUrl(entry.logoDataUrl)

  return {
    kind: "publishedDevApp",
    tileType: "orgDevApp",
    ref,
    publicationId: entry.publicationId,
    organizationId: entry.organizationId,
    organizationName: entry.organizationName,
    releaseId: entry.activeRelease.id,
    releaseVersion: entry.activeRelease.version,
    name: entry.name,
    framework: entry.activeRelease.framework,
    contentHash: entry.activeRelease.contentHash,
    entryPath: entry.activeRelease.entryPath,
    runtimeKind: entry.activeRelease.runtimeKind,
    permissionSetHash: entry.activeRelease.permissionSetHash,
    logoDataUrl,
  }
}

export function buildPublishedDevAppManifest(
  entry: OrgDevAppConsumerRecord,
  ref?: string,
): DevAppManifest {
  const description =
    entry.description?.trim() ||
    `Published to ${entry.organizationName} as a built artifact.`
  const launch = buildPublishedDevAppLaunchSpec(entry, ref)

  return {
    id: buildPublishedDevAppId(entry.publicationId),
    name: entry.name,
    description,
    categories: ["discover", "build-release"],
    icon: buildPublishedDevAppIconDefinition(entry.name, entry.logoDataUrl),
    launcher: {
      enabled: true,
      order: 4,
      group: "Development",
      searchTerms: [
        "org",
        "organization",
        "published",
        "devapp",
        entry.organizationName,
        entry.activeRelease.framework,
        launch.ref,
      ],
    },
    store: {
      categoryLabel: "Organization",
      accentClassName: "from-indigo-500/18 via-violet-500/8 to-transparent",
      badgeLabel: entry.organizationName,
      featured: true,
    },
    parts: entry.activeRelease.parts,
    launch,
  }
}

export function buildInstalledDevAppManifest(
  installation: OrgDevAppInstallation,
): DevAppManifest {
  return buildPublishedDevAppManifest(
    { ...installation, status: "active" },
    installation.ref,
  )
}

export function buildPublishedDevAppOriginUrl(entry: OrgDevAppConsumerRecord): string {
  return buildOrgDevAppUrl({
    contentHash: entry.activeRelease.contentHash,
    entryPath: entry.activeRelease.entryPath,
  })
}
