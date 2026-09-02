import fs from "node:fs"
import path from "node:path"

import { describe, expect, it } from "vitest"

const ROOT = path.resolve(import.meta.dirname, "../..")

describe("project sidebar search", () => {
  it("opens the shared command palette directly below New project", () => {
    const source = fs.readFileSync(
      path.join(ROOT, "apps/desktop/src/features/projects/components/ProjectSidebar.tsx"),
      "utf8",
    )
    const newProjectIndex = source.indexOf("t('nav.newProject')")
    const searchIndex = source.indexOf("t('nav.search')")
    const storeIndex = source.indexOf("t('nav.devAppsStore')")

    expect(newProjectIndex).toBeGreaterThan(-1)
    expect(searchIndex).toBeGreaterThan(newProjectIndex)
    // Directly below: nothing else sits between them, and the store now follows.
    expect(storeIndex).toBeGreaterThan(searchIndex)
    expect(source.slice(newProjectIndex, searchIndex)).toContain("openCommandPalette")
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
