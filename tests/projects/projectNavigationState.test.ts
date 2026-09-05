import { describe, expect, it } from "vitest"

import {
  buildProjectRouteNavigationState,
  readProjectRouteNavigationState,
  resolveTrustedProjectRouteNavigationState,
} from "@/contexts/project/projectNavigationState"

describe("projectNavigationState", () => {
  it("trusts preferred workspace ids when the navigation state project id matches the route", () => {
    const state = buildProjectRouteNavigationState({
      projectId: "project-123",
      projectSlug: "alpha",
      projectName: "Alpha",
      preferredWorkspaceId: " workspace-123 ",
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
      preferredWorkspaceId: "workspace-123",
    })
  })

  it("rejects preferred workspace ids from a different project id", () => {
    const state = buildProjectRouteNavigationState({
      projectId: "project-new",
      projectSlug: "new-app",
      preferredWorkspaceId: "workspace-new",
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
      preferredWorkspaceId: "workspace-alpha",
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
      preferredWorkspaceId: "workspace-alpha",
    })
  })

  it("does not trust bare preferred workspace state without project identity", () => {
    expect(
      resolveTrustedProjectRouteNavigationState({
        state: { preferredWorkspaceId: "workspace-alpha" },
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
        preferredWorkspaceId: " workspace-123 ",
      }),
    ).toEqual({
      projectId: "project-123",
      projectSlug: "alpha",
      projectName: "Alpha",
      preferredWorkspaceId: "workspace-123",
    })
  })
})
