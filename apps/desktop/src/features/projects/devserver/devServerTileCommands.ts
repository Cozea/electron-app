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

/** Main probes IPv4 loopback, so renderer previews must use the same authority. */
export function buildLocalDevServerUrl(port: number): string {
  return `http://127.0.0.1:${port}`
}

/** URL equality for "is the preview still on the server's own URL". */
export function isSameDevServerPreviewUrl(a: string | null | undefined, b: string | null | undefined): boolean {
  if (!a || !b) return false
  const comparable = (value: string): string => {
    try {
      const url = new URL(value)
      if (url.hostname === "localhost" || url.hostname === "::1" || url.hostname === "[::1]") {
        url.hostname = "127.0.0.1"
      }
      if (url.pathname === "/") {
        url.pathname = ""
      }
      return url.toString().replace(/\/$/, "")
    } catch {
      return value.endsWith("/") ? value.slice(0, -1) : value
    }
  }
  return comparable(a) === comparable(b)
}
