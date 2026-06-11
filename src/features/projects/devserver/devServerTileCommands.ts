/**
 * Commands the dock header sends to a mounted runtime-preview tile. The
 * header renders outside the tile's React tree (direct dock-header render),
 * so the few actions that genuinely need tile-instance state (the simulator
 * hook) travel as DOM events carrying plain data — never closures.
 */
export const DEV_SERVER_TILE_COMMAND_EVENT = "cozea:devserver-tile-command"

export interface DevServerTileCommand {
  tileId: string
  type: "refresh-simulators"
}

export function dispatchDevServerTileCommand(command: DevServerTileCommand): void {
  window.dispatchEvent(new CustomEvent(DEV_SERVER_TILE_COMMAND_EVENT, { detail: command }))
}

/** URL equality for "is the preview still on the server's own URL". */
export function isSameDevServerPreviewUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const strip = (value: string) => (value.endsWith("/") ? value.slice(0, -1) : value)
  return strip(a) === strip(b)
}
