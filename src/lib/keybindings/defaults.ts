import type { KeybindingCommand, ResolvedKeybindingsConfig } from "@cozea/assistant-contracts"

function modShortcut(key: string, modifiers?: {
  shiftKey?: boolean
  altKey?: boolean
  ctrlKey?: boolean
  metaKey?: boolean
}): ResolvedKeybindingsConfig[number]["shortcut"] {
  return {
    key,
    metaKey: modifiers?.metaKey ?? false,
    ctrlKey: modifiers?.ctrlKey ?? false,
    shiftKey: modifiers?.shiftKey ?? false,
    altKey: modifiers?.altKey ?? false,
    modKey: true,
  }
}

function whenIdentifier(name: string) {
  return { type: "identifier" as const, name }
}

function whenNot(node: ReturnType<typeof whenIdentifier>) {
  return { type: "not" as const, node }
}

/**
 * Client fallback when the assistant runtime has not yet pushed keybindings.
 * Mirrors `DEFAULT_KEYBINDINGS` in `electron/assistant-runtime/keybindings.ts`
 * plus `commandPalette.toggle` (Track A).
 */
export const CLIENT_FALLBACK_KEYBINDINGS: ResolvedKeybindingsConfig = [
  { command: "terminal.toggle", shortcut: modShortcut("j") },
  {
    command: "terminal.split",
    shortcut: modShortcut("d"),
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    command: "terminal.new",
    shortcut: modShortcut("n"),
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    command: "terminal.close",
    shortcut: modShortcut("w"),
    whenAst: whenIdentifier("terminalFocus"),
  },
  {
    command: "diff.toggle",
    shortcut: modShortcut("d"),
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
  {
    command: "chat.new",
    shortcut: modShortcut("n"),
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
  {
    command: "chat.new",
    shortcut: modShortcut("o", { shiftKey: true }),
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
  {
    command: "chat.newLocal",
    shortcut: modShortcut("n", { shiftKey: true }),
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
  { command: "editor.openFavorite", shortcut: modShortcut("o") },
  {
    command: "commandPalette.toggle",
    shortcut: modShortcut("k"),
    whenAst: whenNot(whenIdentifier("terminalFocus")),
  },
]

export const COMMAND_PALETTE_TOGGLE_COMMAND = "commandPalette.toggle" as const satisfies KeybindingCommand
