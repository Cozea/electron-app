import { describe, expect, it } from "vitest"

import { SETTINGS_SURFACES, getSettingsSurface } from "@/lib/settings/settingsRegistry"

describe("organizations settings surface", () => {
  it("lists Organizations among personal settings", () => {
    const ids = SETTINGS_SURFACES.map((surface) => surface.id)
    expect(ids).toContain("organizations")
    expect(getSettingsSurface("organizations")?.routes.personal).toBe("/settings/organizations")
  })
})
