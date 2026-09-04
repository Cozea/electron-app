import { describe, expect, it } from "vitest"

import type { OrgDevAppConsumerRecord } from "@/features/devapps/orgDevAppManifest"
import { listStoreApps } from "@/features/devapps/registry"
import {
  buildAppStoreSections,
  buildInstalledRail,
  countAppStoreMatches,
  matchesOrgDevAppQuery,
  resolveAppStoreScope,
  resolveOrgInstallState,
} from "@/features/devapps/model/appStoreSections"
import type { OrgDevAppInstallation } from "@shared/orgDevAppInstallation"

function orgEntry(overrides: Partial<OrgDevAppConsumerRecord> = {}): OrgDevAppConsumerRecord {
  return {
    publicationId: "pub-1",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "Dashboard",
    description: "Internal metrics dashboard",
    logoDataUrl: null,
    status: "active",
    activeRelease: {
      id: "rel-1",
      version: 3,
      framework: "Vite",
      entryPath: "index.html",
      contentHash: "a".repeat(64),
      runtimeKind: "static",
      manifestVersion: 1,
      platform: null,
      arch: null,
      permissionSetHash: null,
      publisherIdentityKey: null,
      publisherDeviceLabel: null,
      parts: {},
    },
    ...overrides,
  }
}

function installation(overrides: Partial<OrgDevAppInstallation> = {}): OrgDevAppInstallation {
  return {
    ref: "devapp://publication/org-1/pub-1@3",
    publicationId: "pub-1",
    organizationId: "org-1",
    organizationName: "Acme",
    name: "Dashboard",
    description: null,
    logoDataUrl: null,
    active: true,
    installedAt: 1_000,
    lastUsedAt: 1_000,
    sizeBytes: 1024,
    activeRelease: {
      id: "rel-1",
      version: 3,
      framework: "Vite",
      entryPath: "index.html",
      contentHash: "a".repeat(64),
      runtimeKind: "static",
      manifestVersion: 1,
      platform: null,
      arch: null,
      permissionSetHash: null,
      publisherIdentityKey: null,
      publisherDeviceLabel: null,
      parts: {},
      runtimeSourceDigest: null,
      packageManifestDigest: null,
      runtimeImage: null,
    },
    ...overrides,
  }
}

const builtinApps = listStoreApps()

function sectionIds(input: Parameters<typeof buildAppStoreSections>[0]) {
  return buildAppStoreSections(input).map((section) => section.id)
}

describe("resolveAppStoreScope", () => {
  it("accepts the organization scope", () => {
    expect(resolveAppStoreScope("organization")).toBe("organization")
    expect(resolveAppStoreScope("builtin")).toBe("builtin")
  })

  it("falls back to built-in for missing and legacy values", () => {
    for (const value of [null, undefined, "", "discover", "themes", "nonsense"]) {
      expect(resolveAppStoreScope(value)).toBe("builtin")
    }
  })
})

describe("buildAppStoreSections — built-in scope", () => {
  const base = { scope: "builtin" as const, query: "", builtinApps, orgApps: [], installations: [] }

  it("splits the catalog on launcher.group", () => {
    const sections = buildAppStoreSections(base)
    expect(sections.map((section) => section.id)).toEqual(["popular", "assistants"])

    const [popular, assistants] = sections
    expect(popular.items.map((item) => item.app.id)).toEqual([
      "browser",
      "dev-server",
      "terminal",
      "mobile-simulator",
    ])
    expect(assistants.items.map((item) => item.app.id)).toEqual([
      "llama",
      "codex",
      "claude",
      "cursor",
      "opencode",
    ])
  })

  it("collapses to a flat result list while searching", () => {
    const sections = buildAppStoreSections({
      ...base,
      query: "browser",
      builtinApps: listStoreApps({ query: "browser" }),
    })
    expect(sections.map((section) => section.id)).toEqual(["results"])
    expect(sections[0].items.length).toBeGreaterThan(0)
  })

  it("emits no sections when nothing matches", () => {
    expect(sectionIds({ ...base, query: "zzzz", builtinApps: [] })).toEqual([])
  })
})

describe("buildAppStoreSections — organization scope", () => {
  const base = { scope: "organization" as const, query: "", builtinApps }

  it("lists updates ahead of everything else, each entry exactly once", () => {
    const stale = orgEntry({ publicationId: "pub-1" })
    const current = orgEntry({ publicationId: "pub-2", name: "Docs" })
    const sections = buildAppStoreSections({
      ...base,
      orgApps: [stale, current],
      installations: [
        installation({ activeRelease: { ...installation().activeRelease, version: 2 } }),
        installation({ ref: "r2", publicationId: "pub-2" }),
      ],
    })

    expect(sections.map((section) => section.id)).toEqual(["updates", "all"])
    expect(sections[0].items.map((item) => item.key)).toEqual(["pub-1"])
    expect(sections[1].items.map((item) => item.key)).toEqual(["pub-2"])
  })

  it("treats a query as a flat result list", () => {
    const sections = buildAppStoreSections({
      ...base,
      query: "docs",
      orgApps: [orgEntry(), orgEntry({ publicationId: "pub-2", name: "Docs" })],
      installations: [],
    })
    expect(sections.map((section) => section.id)).toEqual(["results"])
    expect(sections[0].items.map((item) => item.key)).toEqual(["pub-2"])
  })

  it("yields nothing while the catalog is loading", () => {
    expect(sectionIds({ ...base, orgApps: undefined, installations: [] })).toEqual([])
  })
})

describe("resolveOrgInstallState", () => {
  it("reports install when nothing is installed", () => {
    expect(resolveOrgInstallState([], orgEntry())).toEqual({ state: "install", installedVersion: null })
  })

  it("reports installed when the active version matches", () => {
    expect(resolveOrgInstallState([installation()], orgEntry())).toEqual({
      state: "installed",
      installedVersion: 3,
    })
  })

  it("reports update when the active version differs", () => {
    const older = installation({ activeRelease: { ...installation().activeRelease, version: 2 } })
    expect(resolveOrgInstallState([older], orgEntry())).toEqual({ state: "update", installedVersion: 2 })
  })

  it("ignores inactive installs of the catalog version", () => {
    expect(resolveOrgInstallState([installation({ active: false })], orgEntry()).state).toBe("install")
  })
})

describe("matchesOrgDevAppQuery", () => {
  const entry = orgEntry()

  it("matches name, description, organization, framework and version", () => {
    for (const query of ["dash", "metrics", "acme", "vite", "v3"]) {
      expect(matchesOrgDevAppQuery(entry, query)).toBe(true)
    }
  })

  it("is case-insensitive and matches everything on an empty query", () => {
    expect(matchesOrgDevAppQuery(entry, "ACME")).toBe(true)
    expect(matchesOrgDevAppQuery(entry, "   ")).toBe(true)
  })

  it("rejects unrelated text", () => {
    expect(matchesOrgDevAppQuery(entry, "kubernetes")).toBe(false)
  })
})

describe("countAppStoreMatches", () => {
  it("counts both scopes", () => {
    const counts = countAppStoreMatches({
      query: "docs",
      builtinApps: listStoreApps({ query: "docs" }),
      orgApps: [orgEntry({ publicationId: "pub-2", name: "Docs" })],
      installations: [],
    })
    expect(counts.organization).toBe(1)
    expect(counts.builtin).toBe(listStoreApps({ query: "docs" }).length)
  })
})

describe("buildInstalledRail", () => {
  it("puts built-ins first, in launcher order", () => {
    const rail = buildInstalledRail(builtinApps, [])
    expect(rail.map((entry) => entry.key)).toEqual(builtinApps.map((app) => app.id))
    expect(rail.every((entry) => entry.kind === "builtin" && entry.scope === "builtin")).toBe(true)
  })

  it("appends one entry per publication, most recently used first", () => {
    const rail = buildInstalledRail([], [
      installation({ ref: "r1", publicationId: "pub-1", lastUsedAt: 10 }),
      installation({ ref: "r2", publicationId: "pub-2", name: "Docs", lastUsedAt: 90 }),
    ])
    expect(rail.map((entry) => entry.key)).toEqual(["pub-2", "pub-1"])
    expect(rail.every((entry) => entry.scope === "organization")).toBe(true)
  })

  it("excludes inactive versions so a publication appears once", () => {
    const rail = buildInstalledRail([], [
      installation({ ref: "r1", publicationId: "pub-1", active: true }),
      installation({ ref: "r0", publicationId: "pub-1", active: false }),
    ])
    expect(rail.map((entry) => entry.key)).toEqual(["pub-1"])
  })
})
