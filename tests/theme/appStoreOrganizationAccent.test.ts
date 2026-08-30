import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const stylesheet = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/index.css"),
  "utf8",
)
const appStore = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/features/projects/pages/AppStorePage.tsx"),
  "utf8",
)

function themeBlock(theme: "navy" | "wine" | "clay" | "forest"): string {
  const match = stylesheet.match(new RegExp(`\\.${theme} \\{([\\s\\S]*?)\\n\\}`))
  return match?.[1] ?? ""
}

describe("DevApps Store organization accents", () => {
  it("keeps the built-in section header free of redundant availability copy", () => {
    expect(appStore).not.toContain("appStore.page.availableNow")
  })

  it("uses one semantic accent role for the release count and organization badge", () => {
    expect(appStore.match(/data-store-organization-accent/g)).toHaveLength(2)
    expect(appStore.match(/var\(--store-organization-accent\)/g)).toHaveLength(2)
    expect(appStore.match(/var\(--store-organization-accent-surface\)/g)).toHaveLength(2)
    expect(appStore).not.toContain("bg-indigo-500/10")
  })

  it.each(["navy", "wine", "clay", "forest"] as const)(
    "defines a readable %s organization accent",
    (theme) => {
      expect(themeBlock(theme)).toContain("--store-organization-accent:")
      expect(themeBlock(theme)).toContain("--store-organization-accent-surface:")
    },
  )
})
