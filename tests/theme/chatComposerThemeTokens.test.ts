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
    "apps/desktop/src/features/projects/components/assistant/chat/CozeaChatSurface.tsx",
  ),
  "utf8",
)
const promptEditor = readFileSync(
  resolve(
    process.cwd(),
    "apps/desktop/src/features/projects/components/assistant/chat/ComposerPromptEditor.tsx",
  ),
  "utf8",
)

describe("agent chat composer theme surface", () => {
  it("uses semantic surface and action colors instead of Light/Dark-only utilities", () => {
    expect(chatSurface).toContain("bg-[var(--assistant-composer-surface)]")
    expect(chatSurface).not.toContain("border-border/60 bg-white")
    expect(chatSurface).not.toContain("dark:bg-surface-raised")
    expect(chatSurface).toContain("bg-primary text-primary-foreground")
    expect(chatSurface).not.toContain("bg-zinc-800 text-white")
    expect(promptEditor).toContain("leading-relaxed text-muted-foreground")
    expect(promptEditor).not.toContain("text-muted-foreground/35")
  })

  it("maps the semantic surface for Light, Dark, and all chromatic themes", () => {
    expect(stylesheet).toContain("--assistant-composer-surface: oklch(1 0 0);")
    expect(stylesheet).toContain("--assistant-composer-surface: var(--surface-raised);")

    const chromaticBlock = stylesheet.match(
      /\.navy,\s*\.wine,\s*\.forest,\s*\.clay \{([\s\S]*?)\n\}/,
    )?.[1]
    expect(chromaticBlock).toContain("--assistant-composer-surface: var(--surface-raised);")
  })
})
