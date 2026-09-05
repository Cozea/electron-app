import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { SETTINGS_SURFACES, getSettingsSurface } from "@/lib/settings/settingsRegistry"
import {
  OrganizationSettingsTabs,
  resolveWorkbenchTarget,
} from "@/features/settings/Organizations"
import { buildWorkbenchScopeKey } from "@/lib/workbenchScopeKey"

describe("organizations settings surface", () => {
  it("lists Organizations among personal settings", () => {
    const ids = SETTINGS_SURFACES.map((surface) => surface.id)
    expect(ids).toContain("organizations")
    expect(getSettingsSurface("organizations")?.routes.personal).toBe("/settings/organizations")
  })

  it("renders Details, Members, and Dev Apps as an ordered horizontal tablist", () => {
    const markup = renderToStaticMarkup(
      createElement(OrganizationSettingsTabs, {
        activeTab: "details",
        onTabChange: () => {},
      }),
    )

    expect(markup).toContain('role="tablist"')
    expect(markup).toContain('aria-selected="true"')
    expect(markup.match(/data-organization-tab-indicator/g)).toHaveLength(1)
    expect(markup).toContain("motion-reduce:transition-none")
    expect(markup.indexOf("Details")).toBeLessThan(markup.indexOf("Members"))
    expect(markup.indexOf("Members")).toBeLessThan(markup.indexOf("Dev Apps"))
  })

  it("places the invite action above the members list", () => {
    const source = readFileSync(
      resolve(process.cwd(), "apps/desktop/src/features/settings/Organizations.tsx"),
      "utf8",
    )

    expect(source.indexOf("data-organization-members-invite-action")).toBeLessThan(
      source.indexOf("data-organization-members-list"),
    )
  })
})

describe("opening a published DevApp", () => {
  const scope = {
    projectId: "proj-onscreen",
    laneId: "lane-a",
    workspaceId: "ws-a",
    scopeKey: "proj-onscreen::lane-a::ws-a",
    laneResolutionPending: false,
  }
  const open = [
    { projectId: "proj-other", laneId: "lane-z", workspaceId: "ws-z" },
    { projectId: "proj-onscreen", laneId: "lane-a", workspaceId: "ws-a" },
  ]

  const noScope = { ...scope, projectId: null, scopeKey: null }
  const otherKey = buildWorkbenchScopeKey("proj-other", "lane-z", "ws-z")

  it("opens into the project on screen, not the first one stored", () => {
    // The drawer sits over a project. Reading the workbench record instead gave
    // insertion order, so with two projects open the DevApp could land in the
    // one the user was not looking at and the click looked like it did nothing.
    expect(resolveWorkbenchTarget(scope, open, otherKey)).toEqual({
      projectId: "proj-onscreen",
      laneId: "lane-a",
      workspaceId: "ws-a",
    })
  })

  it("waits rather than opening into the collab placeholder", () => {
    const pending = { ...scope, laneResolutionPending: true }
    expect(resolveWorkbenchTarget(pending, open, null)).toBeNull()
  })

  it("uses the bench the user was last in when no project is on screen", () => {
    expect(resolveWorkbenchTarget(noScope, open, otherKey)).toEqual(open[0])
  })

  it("falls back to the only open bench", () => {
    expect(resolveWorkbenchTarget(noScope, [open[0]!], null)).toEqual(open[0])
  })

  it("does nothing when the choice would be a guess", () => {
    // Two benches, and a recency key that names neither — a cold start, or one
    // the user has since closed. Opening somewhere invisible is worse than not.
    expect(resolveWorkbenchTarget(noScope, open, null)).toBeNull()
    expect(resolveWorkbenchTarget(noScope, open, "proj-gone::lane::ws")).toBeNull()
    expect(resolveWorkbenchTarget(noScope, [], otherKey)).toBeNull()
  })
})
