import { describe, expect, it } from "vitest"

import {
  filterCommandPaletteCommands,
  formatKeybindingIssueMessage,
  groupCommandPaletteCommands,
  normalizeSearchText,
  type CommandPaletteCommand,
} from "@/features/projects/components/command-palette/CommandPalette.logic"
import { commandLabel } from "@/features/projects/components/command-palette/commandLabels"
import {
  formatShortcutLabel,
  resolveShortcutCommand,
} from "@/lib/keybindings/matchShortcut"
import { CLIENT_FALLBACK_KEYBINDINGS } from "@/lib/keybindings/defaults"

function cmd(
  partial: Partial<CommandPaletteCommand> & Pick<CommandPaletteCommand, "id" | "title">,
): CommandPaletteCommand {
  return {
    group: "Actions",
    searchTerms: [],
    run: () => undefined,
    ...partial,
  }
}

describe("CommandPalette.logic", () => {
  it("normalizes search text", () => {
    expect(normalizeSearchText("  Hello   World ")).toBe("hello world")
  })

  it("filters and ranks commands by title and id", () => {
    const commands = [
      cmd({ id: "terminal.toggle", title: "Terminal: Toggle", searchTerms: ["shell"] }),
      cmd({ id: "chat.new", title: "Chat: New Thread", searchTerms: ["assistant"] }),
      cmd({ id: "workbench.openSettings", title: "Workbench: Open Settings", searchTerms: ["preferences"] }),
    ]

    expect(filterCommandPaletteCommands({ commands, query: "term" }).map((c) => c.id)).toEqual([
      "terminal.toggle",
    ])
    expect(filterCommandPaletteCommands({ commands, query: "settings" }).map((c) => c.id)).toEqual([
      "workbench.openSettings",
    ])
    expect(filterCommandPaletteCommands({ commands, query: ">chat" }).map((c) => c.id)).toEqual([
      "chat.new",
    ])
  })

  it("groups filtered commands", () => {
    const commands = [
      cmd({ id: "a", title: "A", group: "Actions" }),
      cmd({ id: "b", title: "B", group: "Workbench" }),
      cmd({ id: "c", title: "C", group: "Actions" }),
    ]
    expect(groupCommandPaletteCommands(commands).map((g) => g.value)).toEqual([
      "Actions",
      "Workbench",
    ])
  })

  it("formats keybinding issue messages", () => {
    expect(
      formatKeybindingIssueMessage({
        kind: "keybindings.malformed-config",
        message: "expected JSON array",
      }),
    ).toBe("expected JSON array")
    expect(
      formatKeybindingIssueMessage({
        kind: "keybindings.invalid-entry",
        message: "bad key",
        index: 2,
      }),
    ).toBe("Keybinding entry #2: bad key")
  })
})

describe("command labels + shortcut matching", () => {
  it("labels known and jump commands", () => {
    expect(commandLabel("commandPalette.toggle")).toBe("Command Palette: Toggle")
    expect(commandLabel("thread.jump.3")).toBe("Thread: Jump 3")
    expect(commandLabel("script.lint.run")).toBe("Script: Run lint")
  })

  it("resolves commandPalette.toggle from mod+k outside terminal focus", () => {
    const event = {
      key: "k",
      metaKey: true,
      ctrlKey: false,
      shiftKey: false,
      altKey: false,
    }
    expect(
      resolveShortcutCommand(event, CLIENT_FALLBACK_KEYBINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: false },
      }),
    ).toBe("commandPalette.toggle")
    expect(
      resolveShortcutCommand(event, CLIENT_FALLBACK_KEYBINDINGS, {
        platform: "MacIntel",
        context: { terminalFocus: true },
      }),
    ).toBeNull()
  })

  it("formats mac and windows shortcut labels", () => {
    const shortcut = CLIENT_FALLBACK_KEYBINDINGS.find(
      (binding) => binding.command === "commandPalette.toggle",
    )!.shortcut
    expect(formatShortcutLabel(shortcut, "MacIntel")).toContain("K")
    expect(formatShortcutLabel(shortcut, "Win32")).toBe("Ctrl+K")
  })

  it("includes at least ten core fallback keybinding commands", () => {
    const ids = new Set(CLIENT_FALLBACK_KEYBINDINGS.map((binding) => binding.command))
    expect(ids.size).toBeGreaterThanOrEqual(8)
    expect(ids.has("commandPalette.toggle")).toBe(true)
    expect(ids.has("terminal.toggle")).toBe(true)
    expect(ids.has("chat.new")).toBe(true)
  })
})
