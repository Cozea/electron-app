import { createElement } from "react"
import { renderToStaticMarkup } from "react-dom/server"
import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

import { SETTINGS_SURFACES, getSettingsSurface } from "@/lib/settings/settingsRegistry"
import { OrganizationSettingsTabs } from "@/pages/settings/Organizations"

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
      resolve(process.cwd(), "apps/desktop/src/pages/settings/Organizations.tsx"),
      "utf8",
    )

    expect(source.indexOf("data-organization-members-invite-action")).toBeLessThan(
      source.indexOf("data-organization-members-list"),
    )
  })
})
