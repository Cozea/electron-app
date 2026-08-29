import iconSrc from "@/features/devapps/apps/dev-server/icon.png"
import { isProjectDevAppLogoDataUrl } from "@/features/devapps/projectDevAppLogo"
import type { DevAppManifest, PublishedDevAppLaunchSpec } from "@/features/devapps/registry/types"
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
  }
}

export function buildPublishedDevAppId(publicationId: string): string {
  return `org-devapp:${publicationId}`
}

export function buildPublishedDevAppLaunchSpec(
  entry: OrgDevAppConsumerRecord,
): PublishedDevAppLaunchSpec {
  return {
    kind: "publishedDevApp",
    tileType: "orgDevApp",
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
    logoDataUrl: entry.logoDataUrl,
  }
}

export function buildPublishedDevAppManifest(entry: OrgDevAppConsumerRecord): DevAppManifest {
  const logoDataUrl = isProjectDevAppLogoDataUrl(entry.logoDataUrl) ? entry.logoDataUrl : null
  const description =
    entry.description?.trim() ||
    `Published to ${entry.organizationName} as a built artifact.`

  return {
    id: buildPublishedDevAppId(entry.publicationId),
    name: entry.name,
    description,
    categories: ["discover", "build-release"],
    icon: {
      src: logoDataUrl ?? iconSrc,
      alt: `${entry.name} DevApp`,
      ...(logoDataUrl ? {} : { className: "scale-[1.25]" }),
    },
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
      ],
    },
    store: {
      categoryLabel: "Organization",
      accentClassName: "from-indigo-500/18 via-violet-500/8 to-transparent",
      badgeLabel: entry.organizationName,
      featured: true,
    },
    launch: buildPublishedDevAppLaunchSpec(entry),
  }
}

export function buildPublishedDevAppOriginUrl(entry: OrgDevAppConsumerRecord): string {
  return buildOrgDevAppUrl({
    contentHash: entry.activeRelease.contentHash,
    entryPath: entry.activeRelease.entryPath,
  })
}
