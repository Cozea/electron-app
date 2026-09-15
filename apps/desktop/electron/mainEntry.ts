// First: initializes error/crash capture and profiling-header injection
// before any app module evaluates. No-op without a configured DSN.
import './monitoring/sentryMain'

import './registerAppLifecycle'
import './desktopBootstrapMain'
import './main'
import './runtimeQuitCleanup'
