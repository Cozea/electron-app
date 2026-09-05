import { app, BrowserWindow } from 'electron'
import { performance } from 'node:perf_hooks'

import {
  isApplicationQuitting,
  markApplicationQuitting,
  runApplicationQuitCleanups,
} from './appLifecycleState'

const processEntryAt =
  (globalThis as { __COZEA_MAIN_ENTRY_AT__?: number }).__COZEA_MAIN_ENTRY_AT__ ?? performance.now()
let mainWindowId: number | null = null
let mainWindowRef: BrowserWindow | null = null

function shouldLogBootTimings(): boolean {
  return !app.isPackaged || process.env.COZEA_BOOT_TIMINGS === '1'
}

function logProcessEntryMilestone(label: string): void {
  if (!shouldLogBootTimings()) return
  console.info('[BootTiming]', label, {
    elapsedMs: Number((performance.now() - processEntryAt).toFixed(1)),
  })
}

// These listeners are registered before main.ts loads, so unlike main.ts's
// historical MAIN_BOOT_STARTED_AT they include static main-module resolution
// and evaluation in the measured interval.
app.once('ready', () => {
  logProcessEntryMilestone('process-entry-to-app-ready')
})

// Cozea creates its ordinary main BrowserWindow during app-ready before any of
// the on-demand snapshot/PiP BrowserWindows. Remember that first window by its
// public BrowserWindow id rather than reaching into Electron's undocumented
// WebContents preference internals.
app.on('browser-window-created', (_event, window) => {
  if (mainWindowId !== null) return
  mainWindowId = window.id
  mainWindowRef = window
  logProcessEntryMilestone('process-entry-to-main-window-created')

  window.once('closed', () => {
    if (mainWindowId !== window.id) return
    mainWindowId = null
    mainWindowRef = null
  })

  if (process.platform !== 'darwin') return

  // Keep the desktop shell itself alive when the user closes the ordinary main
  // window. Destroying the last renderer fired main.ts's legacy
  // `window-all-closed` cleanup even though macOS keeps the application
  // process alive, leaving a later Dock reopen wrapped around half-disposed
  // DevApp/preview services. Hiding the main window preserves the exact shell,
  // workbench and app-level service graph; explicit Cmd+Q/update shutdown sets
  // the quitting marker first and therefore still performs a real close.
  window.on('close', (event) => {
    if (isApplicationQuitting() || window.isDestroyed()) return
    event.preventDefault()
    window.hide()
  })
})

// mainEntry imports this module before main.ts, so the application-lifetime
// marker is installed before feature/window teardown listeners are registered.
// Explicit Quit can happen after the last macOS window is already gone, in
// which case `window-all-closed` will not run again. Runtime owners register
// cleanup when instantiated; execute those callbacks here without importing
// the heavyweight services into the process-entry path.
app.on('before-quit', () => {
  markApplicationQuitting()
  runApplicationQuitCleanups()
})

if (process.platform === 'darwin') {
  // A hidden main window still counts as an Electron window, so main.ts's
  // activate handler correctly avoids constructing a duplicate. Surface the
  // existing shell first when the Dock/app is activated again.
  app.on('activate', () => {
    if (isApplicationQuitting()) return
    const mainWindow = mainWindowRef
    if (!mainWindow || mainWindow.isDestroyed() || mainWindow.isVisible()) return
    mainWindow.show()
    mainWindow.focus()
  })
}
