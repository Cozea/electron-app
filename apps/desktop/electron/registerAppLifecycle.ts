import { app } from 'electron'

import { markApplicationQuitting } from './appLifecycleState'

// mainEntry imports this module before main.ts, so the application-lifetime
// marker is installed before feature/window teardown listeners are registered.
app.on('before-quit', markApplicationQuitting)
