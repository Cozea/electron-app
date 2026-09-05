import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const controls = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/features/project-memory/useMemoryControls.ts"),
  "utf8",
)
const tile = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/features/workbench/WorkbenchMemoryTile.tsx"),
  "utf8",
)

/**
 * The library can hold a memory skill while the active build leaves it off. An
 * agent cannot build the map then, so the tile has to say so rather than show
 * an empty map with no way forward.
 */
describe("the memory tile without a memory skill running", () => {
  it("reads whether a memory skill is actually switched on", () => {
    expect(controls).toContain("binding.enabled")
    expect(controls).toContain("hasEnabledMemorySkill")
  })

  it("waits for the library before claiming nothing is on", () => {
    // An empty list means "not loaded yet" just as much as "none installed",
    // so the tile must not flash the message while the answer is in flight.
    expect(controls).toContain("skillsLoaded")
    expect(controls).toContain("knowsNoMemorySkillIsOn")
  })

  it("points at the active build rather than a setting that no longer exists", () => {
    expect(tile).toContain("workbench.memory.noSkill.title")
    for (const locale of ["en", "es"]) {
      const source = readFileSync(
        resolve(process.cwd(), `apps/desktop/src/lib/i18n/${locale}.ts`),
        "utf8",
      )
      expect(source).toContain('"workbench.memory.noSkill.description"')
    }
    const en = readFileSync(resolve(process.cwd(), "apps/desktop/src/lib/i18n/en.ts"), "utf8")
    const line = en.slice(en.indexOf('"workbench.memory.noSkill.description"'))
    expect(line.slice(0, 200)).toContain("active build")
  })

  it("checks the missing skill before the generic empty state", () => {
    // Otherwise "No memory yet" wins and never explains why.
    expect(tile.indexOf("workbench.memory.noSkill.title")).toBeLessThan(
      tile.indexOf('t("workbench.memory.empty.title")'),
    )
  })
})
