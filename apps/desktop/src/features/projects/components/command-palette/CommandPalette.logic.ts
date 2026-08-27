import type { KeybindingCommand } from "@cozea/assistant-contracts"

export interface CommandPaletteCommand {
  readonly id: string
  /** Optional stable keybinding command id used for shortcut labels / dispatch. */
  readonly keybindingCommand?: KeybindingCommand
  readonly title: string
  readonly description?: string
  readonly group: string
  readonly searchTerms: ReadonlyArray<string>
  readonly run: () => void | Promise<void>
}

export interface CommandPaletteGroup {
  readonly value: string
  readonly label: string
  readonly items: ReadonlyArray<CommandPaletteCommand>
}

export function normalizeSearchText(value: string): string {
  return value.trim().toLowerCase().replace(/\s+/g, " ")
}

function rankSearchFieldMatch(field: string, normalizedQuery: string): number {
  const normalizedField = normalizeSearchText(field)
  if (normalizedField.length === 0 || !normalizedField.includes(normalizedQuery)) {
    return Number.NEGATIVE_INFINITY
  }
  if (normalizedField === normalizedQuery) {
    return 3
  }
  if (normalizedField.startsWith(normalizedQuery)) {
    return 2
  }
  // Soft fuzzy: every query token present as a substring
  const tokens = normalizedQuery.split(" ").filter(Boolean)
  if (tokens.length > 1 && tokens.every((token) => normalizedField.includes(token))) {
    return 1
  }
  return 1
}

function rankCommandMatch(command: CommandPaletteCommand, normalizedQuery: string): number {
  const terms = [
    command.title,
    command.description ?? "",
    command.id,
    command.keybindingCommand ?? "",
    ...command.searchTerms,
  ].filter((term) => term.length > 0)

  let best = Number.NEGATIVE_INFINITY
  for (const [index, field] of terms.entries()) {
    const fieldRank = rankSearchFieldMatch(field, normalizedQuery)
    if (fieldRank !== Number.NEGATIVE_INFINITY) {
      best = Math.max(best, 1_000 - index * 100 + fieldRank)
    }
  }
  return best
}

export function filterCommandPaletteCommands(input: {
  readonly commands: ReadonlyArray<CommandPaletteCommand>
  readonly query: string
}): CommandPaletteCommand[] {
  const isActionsFilter = input.query.startsWith(">")
  const searchQuery = isActionsFilter ? input.query.slice(1) : input.query
  const normalizedQuery = normalizeSearchText(searchQuery)

  const ranked = input.commands
    .map((command, index) => ({
      command,
      index,
      rank: normalizedQuery.length === 0 ? 0 : rankCommandMatch(command, normalizedQuery),
    }))
    .filter((entry) => normalizedQuery.length === 0 || entry.rank !== Number.NEGATIVE_INFINITY)
    .toSorted((left, right) => {
      if (normalizedQuery.length === 0) return left.index - right.index
      return right.rank - left.rank || left.index - right.index
    })
    .map((entry) => entry.command)

  return ranked
}

export function groupCommandPaletteCommands(
  commands: ReadonlyArray<CommandPaletteCommand>,
): CommandPaletteGroup[] {
  const groups = new Map<string, CommandPaletteCommand[]>()
  for (const command of commands) {
    const existing = groups.get(command.group)
    if (existing) {
      existing.push(command)
    } else {
      groups.set(command.group, [command])
    }
  }

  return [...groups.entries()].map(([value, items]) => ({
    value,
    label: value,
    items,
  }))
}

export function formatKeybindingIssueMessage(issue: {
  readonly kind: string
  readonly message: string
  readonly index?: number
}): string {
  if (issue.kind === "keybindings.invalid-entry" && typeof issue.index === "number") {
    return `Keybinding entry #${issue.index}: ${issue.message}`
  }
  return issue.message
}
