import { describe, expect, it } from "vitest"

import { resolveLocalProjectRoute } from "@/contexts/project/localProjectRoute"
import { canonicalLocalProjectRoute } from "@/contexts/project/canonicalLocalProjectRoute"
import type { Id } from "../../convex/_generated/dataModel"
import type { LocalProjectDTO, LocalProjectId } from "../../shared/localProjectTypes"
import type { WorkspaceCatalogSnapshot } from "../../shared/workspaceTypes"

const localId = `lpj_${"a".repeat(32)}` as LocalProjectId
const cloudId = "project_shared" as Id<"projects">
function project(overrides: Partial<LocalProjectDTO> = {}): LocalProjectDTO {
  return { projectId: localId, name: "My name", localName: "My name", fallbackName: "Original",
    slug: "same-slug", hidden: false, status: "active", cloudProjectId: null, sharedName: null,
    sharedStatus: null, sharedIdentityKey: null, sharedObservedAt: null, createdAt: 1, updatedAt: 1, ...overrides }
}
function snapshot(...projects: LocalProjectDTO[]): WorkspaceCatalogSnapshot {
  return { revision: 1, generatedAt: 1, entries: {}, projects: Object.fromEntries(projects.map((entry) => [entry.projectId, entry])) }
}

describe("device-local project route identity", () => {
  it("opens a durable hidden entry without cloud metadata or a current binding", () => {
    const entry = project({ hidden: true })
    expect(resolveLocalProjectRoute(snapshot(entry), localId, null)).toMatchObject({
      localProject: entry, localProjectId: localId, executionProjectId: localId,
      cloudProjectId: null, legacyCloudRouteKey: null, catalogReady: true,
    })
  })

  it("keeps the same execution owner when a cloud association appears", () => {
    const before = resolveLocalProjectRoute(snapshot(project()), localId, null)
    const after = resolveLocalProjectRoute(snapshot(project({ cloudProjectId: cloudId })), cloudId, null)
    expect(after.executionProjectId).toBe(before.executionProjectId)
    expect(after.localProjectId).toBe(localId)
    expect(after.cloudProjectId).toBe(cloudId)
    expect(after.legacyCloudRouteKey).toBeNull()
  })

  it("lets an exact local identity win over another entry's historical cloud alias", () => {
    const legacy = project({ projectId: cloudId as unknown as LocalProjectId, cloudProjectId: cloudId })
    const associated = project({ cloudProjectId: cloudId })
    expect(resolveLocalProjectRoute(snapshot(associated, legacy), cloudId, null).localProject).toBe(legacy)
  })

  it("resolves one local slug offline and refuses an ambiguous slug", () => {
    expect(resolveLocalProjectRoute(snapshot(project()), null, "same-slug").executionProjectId).toBe(localId)
    const other = project({ projectId: `lpj_${"b".repeat(32)}` as LocalProjectId })
    expect(resolveLocalProjectRoute(snapshot(project(), other), null, "same-slug")).toMatchObject({
      localProject: null, executionProjectId: null, localSlugAmbiguous: true, legacyCloudRouteKey: null,
    })
  })

  it("never sends unknown device-local route keys to legacy cloud discovery", () => {
    for (const key of [localId, "lpj_malformed"]) {
      expect(resolveLocalProjectRoute(snapshot(), key, null)).toMatchObject({ executionProjectId: null, legacyCloudRouteKey: null })
    }
    expect(resolveLocalProjectRoute(snapshot(), cloudId, null).legacyCloudRouteKey).toBe(cloudId)
    expect(resolveLocalProjectRoute(null, cloudId, null).legacyCloudRouteKey).toBeNull()
  })

  it("does not execute a removed entry", () => {
    expect(resolveLocalProjectRoute(snapshot(project({ status: "removed" })), localId, null).executionProjectId).toBeNull()
  })
})

describe("canonical local project deep links", () => {
  it("preserves query, hash, preferred workspace and tile intent from a cloud deep link", () => {
    const state = { projectId: cloudId, preferredWorkspaceId: "session-workspace", openTile: { type: "terminal" }, custom: true }
    expect(canonicalLocalProjectRoute({ href: `/projects/p/${cloudId}/workbench?lane=review#chat`,
      routeProjectId: cloudId, localProjectId: localId, state })).toEqual({
      href: `/projects/p/${localId}/workbench?lane=review#chat`, state: { ...state, projectId: localId },
    })
  })

  it("canonicalizes local slug links and leaves unrelated navigation hints untrusted", () => {
    const state = { projectId: "another-project", preferredWorkspaceId: "wrong-workspace", openTile: "browser" }
    expect(canonicalLocalProjectRoute({ href: "/projects/same-slug/changes", routeSlug: "same-slug",
      localProjectId: localId, state })).toEqual({ href: `/projects/p/${localId}/changes`, state })
  })

  it("does not replace an already canonical route or a different project prefix", () => {
    expect(canonicalLocalProjectRoute({ href: `/projects/p/${localId}/workbench`, routeProjectId: localId, localProjectId: localId, state: null })).toBeNull()
    expect(canonicalLocalProjectRoute({ href: "/projects/same-slug-other/workbench", routeSlug: "same-slug", localProjectId: localId, state: null })).toBeNull()
  })
})
