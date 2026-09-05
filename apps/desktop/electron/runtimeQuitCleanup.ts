import { registerApplicationQuitCleanup } from './appLifecycleState'
import { DevServerService } from './services/DevServerService'
import { TerminalService } from './services/TerminalService'

// main.ts already owns/instantiates these services. Register their explicit
// application-quit teardown only after main has loaded so the lightweight
// process-entry lifecycle path does not pull the runtime graph forward.
const terminalService = TerminalService.getInstance()
const devServerService = DevServerService.getInstance()

registerApplicationQuitCleanup(() => terminalService.killAll())
registerApplicationQuitCleanup(() => devServerService.killAll())
