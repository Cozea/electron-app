interface ShutdownCleanup {
  name: string
  run: () => void | Promise<void>
}

/** Start each owned cleanup once; one failure must not skip other owners. */
export function createShutdownCleanup(
  cleanups: readonly ShutdownCleanup[],
  onError: (name: string, error: unknown) => void,
): () => void {
  let started = false
  return () => {
    if (started) return
    started = true
    for (const cleanup of cleanups) {
      try {
        const result = cleanup.run()
        if (result) void result.catch((error: unknown) => onError(cleanup.name, error))
      } catch (error) {
        onError(cleanup.name, error)
      }
    }
  }
}
