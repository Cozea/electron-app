import { performance } from 'node:perf_hooks'

declare global {
  var __COZEA_MAIN_ENTRY_AT__: number | undefined
}

// This module must remain the first import in mainEntry.ts. Keeping it free of
// Electron/features/services makes the mark represent actual process-entry
// module evaluation rather than a point after the expensive import graph.
globalThis.__COZEA_MAIN_ENTRY_AT__ ??= performance.now()
