import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const stylesheet = readFileSync(resolve(process.cwd(), "apps/desktop/src/index.css"), "utf8")
const emptyFolder = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/components/ui/empty-folder.tsx"),
  "utf8",
)
const themeModule = readFileSync(resolve(process.cwd(), "apps/desktop/src/lib/theme.ts"), "utf8")

const TOKENS = [
  "--empty-folder-back",
  "--empty-folder-flap",
  "--empty-folder-flap-active",
  "--empty-folder-page",
  "--empty-folder-edge",
  "--empty-folder-mark",
  "--empty-folder-line",
  "--empty-folder-line-soft",
]

describe("empty-folder illustration follows the theme", () => {
  it("defines every illustration token", () => {
    for (const token of TOKENS) {
      expect(stylesheet).toContain(`${token}:`)
    }
  })

  it("derives the tokens from the card pair so they flip with the theme", () => {
    // --card-foreground is guaranteed to contrast with --card in every theme,
    // so marks and labels stay legible whichever way the theme flips.
    for (const token of ["--empty-folder-back", "--empty-folder-flap"]) {
      const declaration = stylesheet.match(new RegExp(`${token}:[^;]+;`))?.[0] ?? ""
      expect(declaration).toContain("color-mix")
      expect(declaration).toContain("var(--card)")
      expect(declaration).toContain("var(--card-foreground)")
    }
  })

  it("keeps the front flap the most contrasted layer, so depth reads in both polarities", () => {
    const percentOf = (token: string) =>
      Number(stylesheet.match(new RegExp(`${token}:[^;]*?(\\d+)%`))?.[1])

    const back = percentOf("--empty-folder-back")
    const flap = percentOf("--empty-folder-flap")
    const active = percentOf("--empty-folder-flap-active")

    // The page is bare --card (0% mix). Ordering by mix amount is what makes the
    // flap read as the front face whether the theme is light or dark.
    expect(back).toBeGreaterThan(0)
    expect(flap).toBeGreaterThan(back)
    expect(active).toBeGreaterThan(flap)
  })

  it("never uses the dark: variant, which cannot reach the tinted themes", () => {
    // `@custom-variant dark (&:is(.dark *))` matches only `.dark`, and
    // applyThemeClass swaps in exactly one mutually exclusive theme class, so a
    // `dark:` utility is silently inert under navy/wine/clay/forest.
    expect(stylesheet).toContain("@custom-variant dark (&:is(.dark *))")
    expect(themeModule).toContain("root.classList.remove(...ALL_THEMES)")
    expect(emptyFolder).not.toMatch(/\bdark:/)
  })

  it("hard-codes no colour in the illustration", () => {
    const code = emptyFolder.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "")
    expect(code).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    // Bare white/black alphas assume a fixed polarity.
    expect(code).not.toMatch(/\b(?:bg|fill|stroke|border|text)-(?:white|black)\//)
  })
})
