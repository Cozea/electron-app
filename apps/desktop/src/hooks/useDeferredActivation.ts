import { useEffect, useState } from "react"

export function useDeferredActivation(
  enabled: boolean,
  options: {
    delayMs?: number
    timeoutMs?: number
  } = {},
): boolean {
  const { delayMs = 0, timeoutMs = 3_000 } = options
  const [active, setActive] = useState(false)

  useEffect(() => {
    if (!enabled) {
      setActive(false)
      return
    }

    let cancelled = false
    let idleHandle: number | null = null
    const idleWindow = window as Window & {
      requestIdleCallback?: (
        callback: IdleRequestCallback,
        options?: IdleRequestOptions,
      ) => number
      cancelIdleCallback?: (handle: number) => void
    }

    const activate = () => {
      if (!cancelled) {
        setActive(true)
      }
    }
    const scheduleIdleActivation = () => {
      if (idleWindow.requestIdleCallback) {
        idleHandle = idleWindow.requestIdleCallback(activate, { timeout: timeoutMs })
        return
      }

      activate()
    }
    const timeoutHandle = window.setTimeout(() => {
      window.requestAnimationFrame(() => {
        window.requestAnimationFrame(scheduleIdleActivation)
      })
    }, delayMs)

    return () => {
      cancelled = true
      window.clearTimeout(timeoutHandle)
      if (idleHandle !== null) {
        idleWindow.cancelIdleCallback?.(idleHandle)
      }
    }
  }, [delayMs, enabled, timeoutMs])

  return active
}
