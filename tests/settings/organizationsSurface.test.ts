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

  it("opens into the project on screen, not the first one stored", () => {
    // The drawer sits over a project. Reading the workbench record instead gave
    // insertion order, so with two projects open the DevApp could land in the
    // one the user was not looking at and the click looked like it did nothing.
    expect(resolveWorkbenchTarget(scope, open)).toEqual({
      projectId: "proj-onscreen",
      laneId: "lane-a",
      workspaceId: "ws-a",
    })
  })

  it("waits rather than opening into the collab placeholder", () => {
    expect(resolveWorkbenchTarget({ ...scope, laneResolutionPending: true }, open)).toBeNull()
  })

  it("falls back to the only open bench when no project is on screen", () => {
    const noScope = { ...scope, projectId: null, scopeKey: null }
    expect(resolveWorkbenchTarget(noScope, [open[0]!])).toEqual(open[0])
  })

  it("does nothing when there is no project on screen and the choice is a guess", () => {
    const noScope = { ...scope, projectId: null, scopeKey: null }
    expect(resolveWorkbenchTarget(noScope, open)).toBeNull()
    expect(resolveWorkbenchTarget(noScope, [])).toBeNull()
  })
})
