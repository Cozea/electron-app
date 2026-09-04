import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../..")

describe("project sidebar search", () => {
  it("opens the shared command palette from the search bar below Cozea Alpha", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "apps/desktop/src/features/projects/ui/ProjectSidebar.tsx"),
      "utf8",
    )
    const headerIndex = source.indexOf("Cozea</span>")
    const searchIndex = source.indexOf("t('nav.search')")

    expect(headerIndex).toBeGreaterThan(-1)
    expect(searchIndex).toBeGreaterThan(headerIndex)
    expect(source.slice(headerIndex, searchIndex)).toContain("openCommandPalette")
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
