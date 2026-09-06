import { describe, expect, it } from "vitest"

import {
  activeInstallationsByPublication,
  isOrgDevAppUpdateAvailable,
  totalInstalledDevAppBytes,
} from "@/features/devapps/orgDevAppInstallationCatalog"
import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation"

function installation(
  publicationId: string,
  version: number,
  options: { active?: boolean; sizeBytes?: number } = {},
): OrgDevAppInstallation {
  return {
    ref: `cozea-devapp:org/${publicationId}@${version}`,
    publicationId,
    organizationId: "org",
    organizationName: "Cozea",
    name: publicationId,
    description: null,
    logoDataUrl: null,
    active: options.active ?? false,
    installedAt: 1,
    lastUsedAt: 1,
    sizeBytes: options.sizeBytes ?? 0,
    activeRelease: {
      id: `release_${version}`,
      version,
      framework: "vite-react",
      entryPath: "index.html",
      contentHash: String(version).padStart(64, "0"),
      runtimeKind: "static",
      manifestVersion: 1,
      platform: null,
      arch: null,
      permissionSetHash: null,
      publisherIdentityKey: null,
      publisherDisplayName: null,
      parts: { view: { source: "package" } },
      runtimeSourceDigest: null,
      packageManifestDigest: null,
      runtimeImage: null,
    },
  }
}

describe("organization DevApp installation catalog", () => {
  it("indexes only the explicitly active exact release", () => {
    const older = installation("publication", 1)
    const active = installation("publication", 2, { active: true })
    expect(activeInstallationsByPublication([older, active]).get("publication")).toBe(active)
  })

  it("reports an update only when an installed active version differs", () => {
    const installed = installation("publication", 2, { active: true })
    expect(isOrgDevAppUpdateAvailable([installed], "publication", 2)).toBe(false)
    expect(isOrgDevAppUpdateAvailable([installed], "publication", 3)).toBe(true)
    expect(isOrgDevAppUpdateAvailable([], "publication", 3)).toBe(false)
  })

  it("accounts for every retained version in storage", () => {
    expect(
      totalInstalledDevAppBytes([
        installation("publication", 1, { sizeBytes: 1_024 }),
        installation("publication", 2, { active: true, sizeBytes: 2_048 }),
      ]),
    ).toBe(3_072)
  })
})
