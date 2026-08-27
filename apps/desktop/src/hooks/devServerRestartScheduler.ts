export interface DevServerRestartScheduler {
  schedule: (callback: () => void) => void
  cancel: () => void
}

export function createDevServerRestartScheduler(
  delayMs: number = 500,
  setTimeoutFn: typeof setTimeout = setTimeout,
  clearTimeoutFn: typeof clearTimeout = clearTimeout,
): DevServerRestartScheduler {
  let timeoutHandle: ReturnType<typeof setTimeout> | null = null

  return {
    schedule(callback) {
      if (timeoutHandle) {
        clearTimeoutFn(timeoutHandle)
      }
      timeoutHandle = setTimeoutFn(() => {
        timeoutHandle = null
        callback()
      }, delayMs)
    },
    cancel() {
      if (!timeoutHandle) {
        return
      }
      clearTimeoutFn(timeoutHandle)
      timeoutHandle = null
    },
  }
}
