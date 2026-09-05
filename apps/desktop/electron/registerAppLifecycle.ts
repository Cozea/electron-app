import { app } from 'electron'

import { markApplicationQuitting } from './appLifecycleState'
import { DevServerService } from './services/DevServerService'
import { TerminalService } from './services/TerminalService'

// mainEntry imports this module before main.ts, so the application-lifetime
// marker is installed before feature/window teardown listeners are registered.
// Explicit Quit can happen after the last macOS window is already gone, in
// which case `window-all-closed` will not run again. Terminate the user-owned
// process runtime here as well so preserved windowless work never becomes an
// orphan after Cmd+Q / Dock > Quit / an updater restart.
app.on('before-quit', () => {
  markApplicationQuitting()
  DevServerService.getInstance().killAll()
  TerminalService.getInstance().killAll()
})
