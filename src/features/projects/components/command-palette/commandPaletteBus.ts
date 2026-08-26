const COMMAND_PALETTE_OPEN_EVENT = "cozea:open-command-palette"
const COMMAND_PALETTE_TOGGLE_EVENT = "cozea:toggle-command-palette"

export interface CommandPaletteOpenDetail {
  readonly query?: string
}

export function openCommandPalette(detail?: CommandPaletteOpenDetail): void {
  window.dispatchEvent(
    new CustomEvent(COMMAND_PALETTE_OPEN_EVENT, detail ? { detail } : undefined),
  )
}

export function toggleCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_TOGGLE_EVENT))
}

export function onOpenCommandPalette(
  listener: (detail: CommandPaletteOpenDetail) => void,
): () => void {
  const handler = (event: Event) => {
    listener((event as CustomEvent<CommandPaletteOpenDetail>).detail ?? {})
  }
  window.addEventListener(COMMAND_PALETTE_OPEN_EVENT, handler)
  return () => window.removeEventListener(COMMAND_PALETTE_OPEN_EVENT, handler)
}

export function onToggleCommandPalette(listener: () => void): () => void {
  const handler = () => {
    listener()
  }
  window.addEventListener(COMMAND_PALETTE_TOGGLE_EVENT, handler)
  return () => window.removeEventListener(COMMAND_PALETTE_TOGGLE_EVENT, handler)
}

/** Read at event time so consumers do not subscribe to transient dialog state. */
export function isCommandPaletteOpen(): boolean {
  return (
    typeof document !== "undefined" && document.querySelector("[data-command-palette]") !== null
  )
}
