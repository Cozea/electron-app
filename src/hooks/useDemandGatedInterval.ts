import { useEffect, useRef } from "react"

import {
  isBackgroundRefreshAllowed,
  readDocumentVisibility,
  type BackgroundPolicyOptions,
} from "@/lib/backgroundPolicy"

export interface UseDemandGatedIntervalOptions extends BackgroundPolicyOptions {
  /** When false, no interval is scheduled. Default true. */
  enabled?: boolean
  /** Fire once immediately when the effect mounts / becomes allowed again. Default true. */
  runOnResume?: boolean
}

/**
 * setInterval that respects BackgroundPolicy-lite: pauses while the document
 * is hidden (and optionally while a surface is inactive), then resumes.
 */
export function useDemandGatedInterval(
  callback: () => void,
  intervalMs: number,
  options: UseDemandGatedIntervalOptions = {},
): void {
  const {
    enabled = true,
    surfaceActive = true,
    pauseWhenDocumentHidden = true,
    runOnResume = true,
  } = options

  const callbackRef = useRef(callback)
  callbackRef.current = callback

  useEffect(() => {
    if (!enabled || intervalMs <= 0) {
      return
    }

    let intervalId: number | null = null

    const clear = () => {
      if (intervalId !== null) {
        window.clearInterval(intervalId)
        intervalId = null
      }
    }

    const allowed = () =>
      isBackgroundRefreshAllowed(
        { surfaceActive, pauseWhenDocumentHidden },
        readDocumentVisibility(),
      )

    const tick = () => {
      if (!allowed()) return
      callbackRef.current()
    }

    const start = (fireImmediately: boolean) => {
      clear()
      if (!allowed()) return
      if (fireImmediately) {
        callbackRef.current()
      }
      intervalId = window.setInterval(tick, intervalMs)
    }

    start(runOnResume)

    const onVisibilityChange = () => {
      if (allowed()) {
        start(runOnResume)
      } else {
        clear()
      }
    }

    document.addEventListener("visibilitychange", onVisibilityChange)
    return () => {
      document.removeEventListener("visibilitychange", onVisibilityChange)
      clear()
    }
  }, [enabled, intervalMs, pauseWhenDocumentHidden, runOnResume, surfaceActive])
}
