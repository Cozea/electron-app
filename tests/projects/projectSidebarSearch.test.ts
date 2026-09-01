import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../..")

describe("project sidebar search", () => {
  it("opens the shared command palette directly below DevApps Store", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "apps/desktop/src/features/projects/components/ProjectSidebar.tsx"),
      "utf8",
    )
    const storeIndex = source.indexOf("t('nav.devAppsStore')")
    const searchIndex = source.indexOf("t('nav.search')")

    expect(storeIndex).toBeGreaterThan(-1)
    expect(searchIndex).toBeGreaterThan(storeIndex)
    expect(source.slice(storeIndex, searchIndex)).toContain("openCommandPalette")
  })

  it("localizes the search label", () => {
    for (const locale of ["en", "es"]) {
      const source = fs.readFileSync(
        path.join(ROOT, `apps/desktop/src/lib/i18n/${locale}.ts`),
        "utf8",
      )
      expect(source).toContain('"nav.search"')
    }
  })
})
