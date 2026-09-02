import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import type { MessageId, ThreadId } from "@cozea/assistant-contracts"

import { newCommandId } from "@/features/projects/components/assistant/lib/utils"
import { ensureNativeApi } from "@/lib/nativeApi"
import type { Thread } from "@/stores/types"

import { toErrorMessage } from "./workbenchAssistantShared"

const FORCE_STOP_DELAY_MS = 2_000
const TURN_START_PENDING_TIMEOUT_MS = 12_000

interface PendingTurnStart {
  messageId: MessageId
  threadId: ThreadId
  startedAt: number
}

interface UseAssistantTurnLifecycleInput {
  thread: Thread | null
  isRuntimeReady: boolean
  runtimeErrorMessage: string | null
  isRunning: boolean
  onError: (message: string | null) => void
}

function findLatestInterruptFailure(thread: Thread | null) {
  const activities = thread?.activities ?? []
  for (let index = activities.length - 1; index >= 0; index -= 1) {
    const activity = activities[index]
    if (activity?.kind === "provider.turn.interrupt.failed") {
      return activity
    }
  }
  return null
}

export function useAssistantTurnLifecycle({
  thread,
  isRuntimeReady,
  runtimeErrorMessage,
  isRunning,
  onError,
}: UseAssistantTurnLifecycleInput) {
  const [isInterrupting, setIsInterrupting] = useState(false)
  const [isForceStopAvailable, setIsForceStopAvailable] = useState(false)
  const [pendingTurnStart, setPendingTurnStart] = useState<PendingTurnStart | null>(null)
  const interruptFailureBaselineRef = useRef<string | null>(null)
  const pendingTurnObservedRunningRef = useRef<MessageId | null>(null)
  const latestInterruptFailure = useMemo(() => findLatestInterruptFailure(thread), [thread])

  const isTurnStartPending = pendingTurnStart !== null
  const isTurnBusy = isRunning || isInterrupting || isTurnStartPending

  const clearPendingTurnStart = useCallback(() => {
    pendingTurnObservedRunningRef.current = null
    setPendingTurnStart(null)
  }, [])

  const notePendingTurnStart = useCallback((
    messageId: MessageId,
    threadId: ThreadId,
    startedAtIso: string,
  ) => {
    const parsedStartedAt = Date.parse(startedAtIso)
    pendingTurnObservedRunningRef.current = null
    setPendingTurnStart({
      messageId,
      threadId,
      startedAt: Number.isFinite(parsedStartedAt) ? parsedStartedAt : Date.now(),
    })
  }, [])

  useEffect(() => {
    if (isRuntimeReady) {
      return
    }

    setIsInterrupting(false)
    setIsForceStopAvailable(false)
    pendingTurnObservedRunningRef.current = null
    setPendingTurnStart(null)
  }, [isRuntimeReady])

  useEffect(() => {
    if (!pendingTurnStart) {
      return
    }

    if (!thread || thread.id !== pendingTurnStart.threadId) {
      setPendingTurnStart(null)
      return
    }

    const projectedTurnStartedAt = thread.latestTurn?.startedAt
      ? Date.parse(thread.latestTurn.startedAt)
      : Number.NaN
    if (
      Number.isFinite(projectedTurnStartedAt) &&
      projectedTurnStartedAt >= pendingTurnStart.startedAt
    ) {
      pendingTurnObservedRunningRef.current = null
      setPendingTurnStart(null)
      return
    }

    // The runtime can report streaming before the new turn projection lands.
    // Keep the optimistic timestamp alive during that handoff and do not fire
    // the start-timeout error for a turn that is observably running.
    if (isRunning) {
      pendingTurnObservedRunningRef.current = pendingTurnStart.messageId
      return
    }

    if (pendingTurnObservedRunningRef.current === pendingTurnStart.messageId) {
      pendingTurnObservedRunningRef.current = null
      setPendingTurnStart(null)
      return
    }

    const hasStartFailure = thread.activities.some((activity) => {
      if (activity.kind !== "provider.turn.start.failed") {
        return false
      }
      return Date.parse(activity.createdAt) >= pendingTurnStart.startedAt
    })

    if (hasStartFailure) {
      setPendingTurnStart(null)
      return
    }

    const elapsedMs = Date.now() - pendingTurnStart.startedAt
    if (elapsedMs >= TURN_START_PENDING_TIMEOUT_MS) {
      setPendingTurnStart(null)
      onError("The agent did not start in time. Try sending again.")
      return
    }

    const timeoutId = window.setTimeout(() => {
      setPendingTurnStart((current) => {
        if (!current || current.messageId !== pendingTurnStart.messageId) {
          return current
        }
        return null
      })
      onError("The agent did not start in time. Try sending again.")
    }, TURN_START_PENDING_TIMEOUT_MS - elapsedMs)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isRunning, onError, pendingTurnStart, thread])

  useEffect(() => {
    if (!isRunning) {
      setIsInterrupting(false)
      setIsForceStopAvailable(false)
      return
    }

    if (!isInterrupting) {
      return
    }

    setIsForceStopAvailable(false)
    const timeoutId = window.setTimeout(() => {
      setIsForceStopAvailable(true)
    }, FORCE_STOP_DELAY_MS)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [isInterrupting, isRunning, thread?.id])

  useEffect(() => {
    if (!latestInterruptFailure) {
      return
    }

    if (!isInterrupting || latestInterruptFailure.id === interruptFailureBaselineRef.current) {
      return
    }

    const detail =
      typeof latestInterruptFailure.payload === "object" &&
      latestInterruptFailure.payload !== null &&
      "detail" in latestInterruptFailure.payload &&
      typeof latestInterruptFailure.payload.detail === "string"
        ? latestInterruptFailure.payload.detail
        : null

    onError(detail ?? latestInterruptFailure.summary)
    setIsInterrupting(false)
    setIsForceStopAvailable(isRunning)
  }, [isInterrupting, isRunning, latestInterruptFailure, onError])

  const handleForceStop = useCallback(async () => {
    if (!isRuntimeReady) {
      onError(runtimeErrorMessage ?? "Local chat runtime is unavailable.")
      return
    }

    if (!thread) {
      return
    }

    setIsInterrupting(true)
    setIsForceStopAvailable(false)
    onError(null)

    try {
      const api = ensureNativeApi()
      await api.orchestration.dispatchCommand({
        type: "thread.session.stop",
        commandId: newCommandId(),
        threadId: thread.id,
        createdAt: new Date().toISOString(),
      })
    } catch (error) {
      setIsInterrupting(false)
      onError(toErrorMessage(error))
    }
  }, [isRuntimeReady, onError, runtimeErrorMessage, thread])

  const handleInterrupt = useCallback(async () => {
    if (!isRuntimeReady) {
      onError(runtimeErrorMessage ?? "Local chat runtime is unavailable.")
      return
    }

    if (!thread) {
      return
    }

    if (isInterrupting) {
      if (isForceStopAvailable) {
        await handleForceStop()
      }
      return
    }

    interruptFailureBaselineRef.current = latestInterruptFailure?.id ?? null
    setIsInterrupting(true)
    setIsForceStopAvailable(false)
    onError(null)

    try {
      const api = ensureNativeApi()
      await api.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: thread.id,
        createdAt: new Date().toISOString(),
      })
    } catch (error) {
      setIsInterrupting(false)
      onError(toErrorMessage(error))
    }
  }, [
    handleForceStop,
    isForceStopAvailable,
    isInterrupting,
    isRuntimeReady,
    latestInterruptFailure?.id,
    onError,
    runtimeErrorMessage,
    thread,
  ])

  return {
    isInterrupting,
    isForceStopAvailable,
    isTurnStartPending,
    pendingTurnStartStartedAtIso: pendingTurnStart
      ? new Date(pendingTurnStart.startedAt).toISOString()
      : null,
    isTurnBusy,
    clearPendingTurnStart,
    notePendingTurnStart,
    handleInterrupt,
  }
}
