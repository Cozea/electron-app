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

interface DevServerPreviewRecoveryInput {
  status: string
  runId: string | null
  url: string
  loadError: string | null
  visible: boolean
}

/**
 * Identifies the single automatic retry allowed for a ready server run.
 *
 * Native navigation failures can arrive after the managed process has already
 * transitioned to ready. Deriving the retry from both pieces of state handles
 * either ordering, while keeping the key independent of the error text avoids
 * a reload loop when the retried navigation fails for the same run and URL.
 */
export function getDevServerPreviewRecoveryKey({
  status,
  runId,
  url,
  loadError,
  visible,
}: DevServerPreviewRecoveryInput): string | null {
  if (status !== "ready" || !runId || !url || !loadError || !visible) {
    return null
  }
  return `${runId}\0${url}`
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
