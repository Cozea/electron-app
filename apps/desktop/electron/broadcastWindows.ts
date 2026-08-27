import { BrowserWindow } from "electron"

let broadcastMainWindow: BrowserWindow | null = null

export function setBroadcastMainWindow(window: BrowserWindow | null): void {
  broadcastMainWindow = window
}

/**
 * Prefer the main app window when alive (single-window desktop UX).
 * Falls back to all live windows if the main reference is missing.
 */
export function forEachBroadcastWindow(fn: (window: BrowserWindow) => void): void {
  if (broadcastMainWindow && !broadcastMainWindow.isDestroyed()) {
    fn(broadcastMainWindow)
    return
  }
  for (const browserWindow of BrowserWindow.getAllWindows()) {
    if (browserWindow.isDestroyed()) continue
    fn(browserWindow)
  }
}
