let applicationQuitting = false
const applicationQuitCleanups: Array<() => void> = []

export function markApplicationQuitting(): void {
  applicationQuitting = true
}

export function isApplicationQuitting(): boolean {
  return applicationQuitting
}

/**
 * Runtime owners register cleanup only when they are actually instantiated.
 * This keeps the process-entry lifecycle module independent of heavy services.
 */
export function registerApplicationQuitCleanup(cleanup: () => void): () => void {
  applicationQuitCleanups.push(cleanup)
  return () => {
    const index = applicationQuitCleanups.lastIndexOf(cleanup)
    if (index >= 0) applicationQuitCleanups.splice(index, 1)
  }
}

export function runApplicationQuitCleanups(): void {
  const cleanups = applicationQuitCleanups.splice(0)
  // Reverse construction order: dependents (DevServer) shut down before the
  // lower-level runtime they use (Terminal/PTY).
  for (let index = cleanups.length - 1; index >= 0; index -= 1) {
    try {
      cleanups[index]?.()
    } catch (error) {
      console.warn('[Lifecycle] Application quit cleanup failed.', error)
    }
  }
}

export function shouldPreserveWindowlessRuntime(
  platform: NodeJS.Platform = process.platform,
  quitting: boolean = applicationQuitting,
): boolean {
  return platform === 'darwin' && !quitting
}
