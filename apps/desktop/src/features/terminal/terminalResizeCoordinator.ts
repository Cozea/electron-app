import {
  registerGeometryTask,
  type GeometryTask,
} from "@/lib/desktopInteraction/geometryScheduler"
import {
  isDesktopInteractionActive,
  subscribeDesktopInteraction,
} from "@/lib/desktopInteraction/interactionStore"
import { recordInteractionCounter } from "@/lib/performance/interactionCounters"

export interface TerminalResizeCoordinatorOptions {
  name?: string
  container: HTMLElement
  fit(): void
  getBufferState(): { wasAtBottom: boolean }
  scrollToBottom(): void
  getDimensions(): { cols: number; rows: number }
  onSendPtyResize: (size: { cols: number; rows: number }) => void
}

export interface TerminalResizeCoordinator {
  onContainerResize(contentRect?: { width: number; height: number }): void
  dispose(): void
}

const PTY_THROTTLE_MS = 100

export function createTerminalResizeCoordinator(
  options: TerminalResizeCoordinatorOptions,
): TerminalResizeCoordinator {
  let lastMeasuredSize: { width: number; height: number } | null = null
  let pendingSize: { width: number; height: number } | null = null
  let lastSentPtySize: { cols: number; rows: number } | null = null
  let pendingPtySize: { cols: number; rows: number } | null = null
  let ptyThrottleTimer: ReturnType<typeof setTimeout> | null = null
  let lastPtySendTime = 0
  let isDisposed = false

  function sendPty(size: { cols: number; rows: number }) {
    if (
      lastSentPtySize &&
      lastSentPtySize.cols === size.cols &&
      lastSentPtySize.rows === size.rows
    ) {
      pendingPtySize = null
      return
    }
    lastSentPtySize = size
    pendingPtySize = null
    lastPtySendTime = Date.now()
    recordInteractionCounter("terminalPtyResizeSends")
    try {
      options.onSendPtyResize(size)
    } catch (error) {
      console.error("[terminalResizeCoordinator] onSendPtyResize error:", error)
    }
  }

  function flushPendingPty() {
    if (ptyThrottleTimer !== null) {
      clearTimeout(ptyThrottleTimer)
      ptyThrottleTimer = null
    }
    if (pendingPtySize !== null) {
      sendPty(pendingPtySize)
    }
  }

  function checkAndSchedulePtyResize(cols: number, rows: number) {
    if (
      lastSentPtySize &&
      lastSentPtySize.cols === cols &&
      lastSentPtySize.rows === rows
    ) {
      pendingPtySize = null
      return
    }

    const newSize = { cols, rows }
    pendingPtySize = newSize

    if (!isDesktopInteractionActive()) {
      sendPty(newSize)
      return
    }

    const now = Date.now()
    const elapsed = now - lastPtySendTime
    if (elapsed >= PTY_THROTTLE_MS) {
      sendPty(newSize)
    } else if (ptyThrottleTimer === null) {
      const delay = Math.max(0, PTY_THROTTLE_MS - elapsed)
      ptyThrottleTimer = setTimeout(() => {
        ptyThrottleTimer = null
        if (pendingPtySize !== null && !isDisposed) {
          sendPty(pendingPtySize)
        }
      }, delay)
    }
  }

  const geometryTask: GeometryTask<{ width: number; height: number }> =
    registerGeometryTask<{ width: number; height: number }>({
      name: options.name ?? "terminal-visual-fit",
      read: () => {
        if (isDisposed) return null
        if (pendingSize) {
          const size = pendingSize
          pendingSize = null
          return size
        }
        const rect = options.container.getBoundingClientRect()
        if (rect.width === 0 || rect.height === 0) return null
        if (
          lastMeasuredSize &&
          Math.abs(lastMeasuredSize.width - rect.width) < 0.5 &&
          Math.abs(lastMeasuredSize.height - rect.height) < 0.5
        ) {
          return null
        }
        return { width: rect.width, height: rect.height }
      },
      write: (size) => {
        if (isDisposed) return
        lastMeasuredSize = size
        recordInteractionCounter("terminalFitCalls")
        try {
          const { wasAtBottom } = options.getBufferState()
          options.fit()
          if (wasAtBottom) {
            options.scrollToBottom()
          }
          const { cols, rows } = options.getDimensions()
          checkAndSchedulePtyResize(cols, rows)
        } catch (error) {
          console.error("[terminalResizeCoordinator] fit error:", error)
        }
      },
    })

  const unsubInteraction = subscribeDesktopInteraction((activeKinds) => {
    if (activeKinds.size === 0) {
      flushPendingPty()
    }
  })

  return {
    onContainerResize(contentRect) {
      if (isDisposed) return
      if (contentRect) {
        if (contentRect.width === 0 || contentRect.height === 0) return
        if (
          lastMeasuredSize &&
          Math.abs(lastMeasuredSize.width - contentRect.width) < 0.5 &&
          Math.abs(lastMeasuredSize.height - contentRect.height) < 0.5
        ) {
          return
        }
        pendingSize = contentRect
      }
      geometryTask.invalidate()
    },
    dispose() {
      if (isDisposed) return
      isDisposed = true
      geometryTask.dispose()
      unsubInteraction()
      if (ptyThrottleTimer !== null) {
        clearTimeout(ptyThrottleTimer)
        ptyThrottleTimer = null
      }
      pendingPtySize = null
    },
  }
}
