import { useEffect, useState } from "react"

export type AssistantRuntimePhase = "idle" | "starting" | "ready" | "error"

export interface AssistantRuntimeStatus {
  phase: AssistantRuntimePhase
  wsUrl: string | null
  lastError: string | null
  updatedAt: number
}

function createFallbackStatus(): AssistantRuntimeStatus {
  const wsUrl =
    typeof window !== "undefined" ? window.desktopBridge?.getWsUrl?.() ?? null : null

  return {
    phase: wsUrl ? "starting" : "idle",
    wsUrl,
    lastError: null,
    updatedAt: Date.now(),
  }
}

function normalizeStatus(
  value: Partial<AssistantRuntimeStatus> | null | undefined,
): AssistantRuntimeStatus {
  const fallback = createFallbackStatus()
  if (!value) {
    return fallback
  }

  const phase = value.phase
  return {
    phase:
      phase === "idle" || phase === "starting" || phase === "ready" || phase === "error"
        ? phase
        : fallback.phase,
    wsUrl: typeof value.wsUrl === "string" && value.wsUrl.trim() ? value.wsUrl : fallback.wsUrl,
    lastError:
      typeof value.lastError === "string" && value.lastError.trim().length > 0
        ? value.lastError
        : null,
    updatedAt:
      typeof value.updatedAt === "number" && Number.isFinite(value.updatedAt)
        ? value.updatedAt
        : fallback.updatedAt,
  }
}

export function useAssistantRuntimeStatus(): AssistantRuntimeStatus {
  const [status, setStatus] = useState<AssistantRuntimeStatus>(() => createFallbackStatus())

  useEffect(() => {
    const bridge = window.desktopBridge
    if (!bridge) {
      setStatus({
        phase: "ready",
        wsUrl: null,
        lastError: null,
        updatedAt: Date.now(),
      })
      return
    }

    let cancelled = false

    const applyStatus = (nextStatus: Partial<AssistantRuntimeStatus> | null | undefined) => {
      if (cancelled) return
      const normalized = normalizeStatus(nextStatus)
      setStatus(normalized)
    }

    void bridge
      .getAssistantRuntimeStatus()
      .then(applyStatus)
      .catch(() => undefined)

    const unsubscribe = bridge.onAssistantRuntimeStatus?.((nextStatus) => {
      applyStatus(nextStatus)
    })

    return () => {
      cancelled = true
      unsubscribe?.()
    }
  }, [])

  return status
}
