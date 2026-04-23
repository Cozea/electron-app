import { describe, expect, it } from "vitest"

import {
  buildProjectRouteNavigationState,
  readProjectRouteNavigationState,
  resolveTrustedProjectRouteNavigationState,
} from "@/features/projects/lib/projectNavigationState"

describe("projectNavigationState", () => {
  it("trusts local paths when the navigation state project id matches the route", () => {
    const state = buildProjectRouteNavigationState({
      projectId: "project-123",
      projectSlug: "alpha",
      projectName: "Alpha",
      localPath: "/tmp/alpha/",
    })

    expect(
      resolveTrustedProjectRouteNavigationState({
        state,
        routeProjectId: "project-123",
        routeProjectSlug: "alpha",
      }),
    ).toEqual({
      projectId: "project-123",
      projectSlug: "alpha",
      projectName: "Alpha",
      localPath: "/tmp/alpha",
    })
  })

  it("rejects local paths from a different project id", () => {
    const state = buildProjectRouteNavigationState({
      projectId: "project-new",
      projectSlug: "new-app",
      localPath: "/tmp/new-app",
    })

    expect(
      resolveTrustedProjectRouteNavigationState({
        state,
        routeProjectId: "project-old",
        routeProjectSlug: "old-app",
      }),
    ).toBeNull()
  })

  it("trusts slug-scoped navigation state when the slug matches", () => {
    const state = buildProjectRouteNavigationState({
      projectSlug: "alpha",
      localPath: "/tmp/alpha",
    })

    expect(
      resolveTrustedProjectRouteNavigationState({
        state,
        routeProjectId: null,
        routeProjectSlug: "alpha",
      }),
    ).toEqual({
      projectId: null,
      projectSlug: "alpha",
      projectName: null,
      localPath: "/tmp/alpha",
    })
  })

  it("does not trust bare localPath state without project identity", () => {
    expect(
      resolveTrustedProjectRouteNavigationState({
        state: { localPath: "/tmp/alpha" },
        routeProjectId: "project-123",
        routeProjectSlug: "alpha",
      }),
    ).toBeNull()
  })

  it("normalizes project route navigation state", () => {
    expect(
      readProjectRouteNavigationState({
        projectId: " project-123 ",
        projectSlug: " alpha ",
        projectName: " Alpha ",
        localPath: "C:\\Users\\admin\\alpha\\",
      }),
    ).toEqual({
      projectId: "project-123",
      projectSlug: "alpha",
      projectName: "Alpha",
      localPath: "C:/Users/admin/alpha",
    })
  })
})
