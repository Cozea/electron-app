import { app } from 'electron'

import {
  markApplicationQuitting,
  runApplicationQuitCleanups,
} from './appLifecycleState'

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
