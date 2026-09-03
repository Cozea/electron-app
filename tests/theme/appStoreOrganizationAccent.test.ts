import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const read = (path: string) => readFileSync(resolve(process.cwd(), path), "utf8")

const stylesheet = read("apps/desktop/src/index.css")
const appStore = read("apps/desktop/src/features/projects/pages/AppStorePage.tsx")
const storeRow = read("apps/desktop/src/features/devapps/components/DevAppStoreRow.tsx")
const accent = read("apps/desktop/src/features/devapps/components/devAppStoreAccent.ts")

function themeBlock(theme: "navy" | "wine" | "clay" | "forest"): string {
  const match = stylesheet.match(new RegExp(`\\.${theme} \\{([\\s\\S]*?)\\n\\}`))
  return match?.[1] ?? ""
}

describe("DevApps Store organization accents", () => {
  it("keeps the built-in section header free of redundant availability copy", () => {
    expect(appStore).not.toContain("appStore.page.availableNow")
  })

  it("declares the accent tokens exactly once, in one shared constant", () => {
    expect(accent.match(/var\(--store-organization-accent\)/g)).toHaveLength(1)
    expect(accent.match(/var\(--store-organization-accent-surface\)/g)).toHaveLength(1)
    expect(accent).toContain("STORE_ORGANIZATION_ACCENT_CLASS")
  })

  it("reaches the accent only through that constant", () => {
    for (const source of [appStore, storeRow]) {
      expect(source.match(/var\(--store-organization-accent/g)).toBeNull()
      expect(source).not.toContain("bg-indigo-500/10")
    }
    expect(appStore).toContain("STORE_ORGANIZATION_ACCENT_CLASS")
  })

  it("marks one semantic accent role — the organization badge", () => {
    expect(appStore.match(/data-store-organization-accent/g)).toHaveLength(1)
  })

  it.each(["navy", "wine", "clay", "forest"] as const)(
    "defines a readable %s organization accent",
    (theme) => {
      expect(themeBlock(theme)).toContain("--store-organization-accent:")
      expect(themeBlock(theme)).toContain("--store-organization-accent-surface:")
    },
  )
})
