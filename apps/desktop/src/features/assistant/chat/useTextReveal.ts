import { useCallback, useLayoutEffect, useState, useSyncExternalStore } from "react"

import type { ChatMessage } from "../model/types"
import { TextRevealController, type TextRevealScheduler } from "./textRevealController"

const browserScheduler: TextRevealScheduler = {
  now: () => performance.now(),
  requestFrame: (callback) => requestAnimationFrame(callback),
  cancelFrame: (handle) => cancelAnimationFrame(handle),
}

/** The caller is keyed by thread ID. Registry lifetime is independent of row recycling. */
export function useTimelineTextReveal(
  messages: readonly ChatMessage[],
  visible: boolean,
  immediate: boolean,
): TextRevealController {
  const [controller] = useState(() => new TextRevealController(browserScheduler, messages))
  useLayoutEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)")
    const update = () => controller.setEnabled(visible && !document.hidden && !media.matches)
    update()
    media.addEventListener("change", update)
    document.addEventListener("visibilitychange", update)
    return () => {
      media.removeEventListener("change", update)
      document.removeEventListener("visibilitychange", update)
      controller.stop()
    }
  }, [controller, visible])
  useLayoutEffect(() => {
    controller.sync(messages, immediate)
  }, [controller, messages, immediate])
  return controller
}

export function useTextReveal(controller: TextRevealController, messageId: string) {
  const subscribe = useCallback(
    (listener: () => void) => controller.subscribe(messageId, listener),
    [controller, messageId],
  )
  const getSnapshot = useCallback(() => controller.getSnapshot(messageId), [controller, messageId])
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}
