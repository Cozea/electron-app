import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import { describe, expect, it } from "vitest"

const stylesheet = readFileSync(
  resolve(process.cwd(), "apps/desktop/src/index.css"),
  "utf8",
)
const chatSurface = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/CozeaChatSurface.tsx",
  ),
  "utf8",
)
const promptEditor = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/ComposerPromptEditor.tsx",
  ),
  "utf8",
)
const messagesTimeline = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/assistant/chat/MessagesTimeline.tsx",
  ),
  "utf8",
)

function readThemeBlock(theme: "navy" | "wine" | "clay" | "forest"): string {
  return stylesheet.match(new RegExp(`\\.${theme} \\{([\\s\\S]*?)\\n\\}`))?.[1] ?? ""
}

describe("agent chat composer theme surface", () => {
  it("uses semantic surface and action colors instead of Light/Dark-only utilities", () => {
    expect(chatSurface).toContain("bg-[var(--assistant-composer-surface)]")
    expect(chatSurface).not.toContain("border-border/60 bg-white")
    expect(chatSurface).not.toContain("dark:bg-surface-raised")
    expect(chatSurface).toContain("bg-primary text-primary-foreground")
    expect(chatSurface).not.toContain("bg-zinc-800 text-white")
    // The placeholder is checked by what it has to be, not by how it is spelled:
    // pinning the exact utility string made a density change look like a theme
    // regression. It must stay on the muted token so every theme picks its own
    // tone, and must stay legible — it was once faded to /35, which read as an
    // empty composer. Choosing an opacity is design; disappearing is a bug.
    const mutedTones = [...promptEditor.matchAll(/text-muted-foreground(?:\/(\d+))?(?=[\s"'`])/g)]
    expect(mutedTones.length, "the composer placeholder left the muted-foreground token")
      .toBeGreaterThan(0)
    for (const [utility, opacity] of mutedTones) {
      expect(Number(opacity ?? 100), `${utility} is too faint to read`).toBeGreaterThanOrEqual(50)
    }
    expect(promptEditor).not.toMatch(/text-(?:zinc|slate|gray|neutral|white|black)[-\s"']/)
  })

  it("maps the semantic surface for Light, Dark, and all chromatic themes", () => {
    // Light mode's composer rides the content surface rather than a hardcoded
    // white, so the shell can change tone without stranding the composer.
    expect(stylesheet).toContain("--assistant-composer-surface: var(--content-surface);")
    expect(stylesheet).toContain("--assistant-composer-surface: var(--surface-raised);")

    const chromaticBlock = stylesheet.match(
      /\.navy,\s*\.wine,\s*\.forest,\s*\.clay \{([\s\S]*?)\n\}/,
    )?.[1]
    expect(chromaticBlock).toContain("--assistant-composer-surface: var(--surface-raised);")
  })

  it("gives submitted user prompts a readable surface for every theme", () => {
    expect(messagesTimeline).toContain("bg-[var(--assistant-user-message-surface)]")
    expect(messagesTimeline).toContain("text-[var(--assistant-user-message-foreground)]")
    expect(messagesTimeline).not.toContain("bg-zinc-900 text-white")
    expect(messagesTimeline).not.toContain("dark:bg-surface-raised dark:text-foreground")

    expect(stylesheet).toContain("--assistant-user-message-surface: var(--primary);")
    expect(stylesheet).toContain("--assistant-user-message-surface: var(--surface-raised);")
    expect(stylesheet).toContain("--assistant-user-message-foreground: var(--foreground);")
    expect(readThemeBlock("navy")).toContain(
      "--assistant-user-message-surface: hsl(216 42% 24%);",
    )
    expect(readThemeBlock("wine")).toContain(
      "--assistant-user-message-surface: hsl(340 42% 25%);",
    )
    expect(readThemeBlock("clay")).toContain(
      "--assistant-user-message-surface: hsl(25 38% 25%);",
    )
    expect(readThemeBlock("forest")).toContain(
      "--assistant-user-message-surface: hsl(150 34% 23%);",
    )
  })
})
