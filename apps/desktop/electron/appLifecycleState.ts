import { app } from 'electron'

let applicationQuitting = false

// This listener is registered from mainEntry before main.ts installs its own
// shutdown listeners, so window-lifetime cleanup can distinguish a normal
// macOS last-window close from an actual application quit/update restart.
app.on('before-quit', () => {
  applicationQuitting = true
})

export function isApplicationQuitting(): boolean {
  return applicationQuitting
}

export function shouldPreserveWindowlessRuntime(
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform === 'darwin' && !applicationQuitting
}
