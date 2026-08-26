import type { KeybindingCommand } from "@cozea/assistant-contracts"

const COMMAND_LABELS: Partial<Record<KeybindingCommand, string>> = {
  "terminal.toggle": "Terminal: Toggle",
  "terminal.split": "Terminal: Split",
  "terminal.new": "Terminal: New",
  "terminal.close": "Terminal: Close",
  "diff.toggle": "Changes: Toggle Diff",
  "chat.new": "Chat: New Thread",
  "chat.newLocal": "Chat: New Local Thread",
  "editor.openFavorite": "Editor: Open Favorite / Launcher",
  "commandPalette.toggle": "Command Palette: Toggle",
  "modelPicker.toggle": "Model Picker: Toggle",
  "thread.previous": "Thread: Previous",
  "thread.next": "Thread: Next",
}

export function commandLabel(command: KeybindingCommand | string): string {
  if (command in COMMAND_LABELS) {
    return COMMAND_LABELS[command as KeybindingCommand] ?? command
  }
  if (command.startsWith("thread.jump.")) {
    return `Thread: Jump ${command.slice("thread.jump.".length)}`
  }
  if (command.startsWith("modelPicker.jump.")) {
    return `Model Picker: Jump ${command.slice("modelPicker.jump.".length)}`
  }
  if (command.startsWith("script.") && command.endsWith(".run")) {
    const scriptId = command.slice("script.".length, -".run".length)
    return `Script: Run ${scriptId}`
  }
  return command
}
