import { afterEach, describe, expect, it, vi } from "vitest"
import { ConvexReactClient } from "convex/react"

import { layoutProjectQueryCacheKey, prefetchLayoutProject } from "@/features/projects/lib/projectSwitchPrefetch"
import { useQueryCache } from "@/app/model/queryCache"
import { api } from "../../convex/_generated/api"
import type { Doc, Id } from "../../convex/_generated/dataModel"

afterEach(() => useQueryCache.getState().clear())

describe("layoutProjectQueryCacheKey", () => {
  it("prefers the canonical project id over a slug", () => {
    expect(layoutProjectQueryCacheKey("proj_123", "my-app")).toBe("layout-project-proj_123")
  })

  it("falls back to the slug for legacy routes", () => {
    expect(layoutProjectQueryCacheKey(null, "my-app")).toBe("layout-project-my-app")
  })
})

describe("project metadata prefetch association", () => {
  it("queries the genuine association under a local cache key and replaces mismatched presentation", async () => {
    const projectId = "lpj_" + "a".repeat(32)
    const cloudProjectId = "shared_project" as Id<"projects">
    const principalId = "principal" as Id<"devicePrincipals">
    const document: Doc<"projects"> = { _id: cloudProjectId, _creationTime: 1, name: "Shared", slug: "shared",
      creationPath: "fresh", status: "active", createdBy: principalId, createdAt: 1, updatedAt: 1 }
    useQueryCache.getState().set(layoutProjectQueryCacheKey(projectId, null), { _id: "different_project" })
    const client = new ConvexReactClient("http://127.0.0.1:3210")
    const query = vi.spyOn(client, "query").mockResolvedValue(document)
    await prefetchLayoutProject({ convex: client, projectId, cloudProjectId, principalId })
    expect(query).toHaveBeenCalledWith(api.projects.getAccessibleById, { projectId: cloudProjectId })
    expect(useQueryCache.getState().get(layoutProjectQueryCacheKey(projectId, null))).toBe(document)
    await prefetchLayoutProject({ convex: client, projectId, cloudProjectId, principalId })
    expect(query).toHaveBeenCalledOnce()
    await client.close()
  })
})
