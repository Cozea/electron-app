import type { ContextMenuItem } from "@cozea/assistant-contracts"

export type AssistantRuntimePhase = "idle" | "starting" | "ready" | "error"

export interface AssistantRuntimeBridgeStatus {
  phase: AssistantRuntimePhase
  wsUrl: string | null
  lastError: string | null
  updatedAt: number
}

type AssistantRuntimeBridgeListener = (
  status: Partial<AssistantRuntimeBridgeStatus> | null | undefined,
) => void

function readExplicitWebFallbackUrl(): string | null {
  const rawUrl = import.meta.env.VITE_WS_URL
  if (typeof rawUrl !== "string") {
    return null
  }

  const trimmed = rawUrl.trim()
  return trimmed.length > 0 ? trimmed : null
}

function readDesktopBridge() {
  if (typeof window === "undefined") {
    return null
  }

  return window.desktopBridge ?? null
}

export function readDesktopWsUrl(): string | null {
  return readDesktopBridge()?.getWsUrl?.() ?? null
}

export function readConfiguredWsUrl(): string | null {
  return readDesktopWsUrl() ?? readExplicitWebFallbackUrl()
}

export function resolveWsHttpOrigin(): string {
  if (typeof window === "undefined") {
    return ""
  }

  const wsCandidate = readConfiguredWsUrl()
  if (!wsCandidate) {
    return window.location.origin
  }

  try {
    const wsUrl = new URL(wsCandidate)
    const protocol =
      wsUrl.protocol === "wss:" ? "https:" : wsUrl.protocol === "ws:" ? "http:" : wsUrl.protocol
    return `${protocol}//${wsUrl.host}`
  } catch {
    return window.location.origin
  }
}

export function createFallbackAssistantRuntimeStatus(): AssistantRuntimeBridgeStatus {
  const wsUrl = readDesktopWsUrl()

  return {
    phase: wsUrl ? "starting" : "idle",
    wsUrl,
    lastError: null,
    updatedAt: Date.now(),
  }
}

export async function readAssistantRuntimeBridgeStatus(): Promise<
  Partial<AssistantRuntimeBridgeStatus> | null
> {
  const bridge = readDesktopBridge()
  if (!bridge?.getAssistantRuntimeStatus) {
    return null
  }

  return bridge.getAssistantRuntimeStatus()
}

export function subscribeToAssistantRuntimeBridgeStatus(
  listener: AssistantRuntimeBridgeListener,
): (() => void) | null {
  const bridge = readDesktopBridge()
  return bridge?.onAssistantRuntimeStatus?.(listener) ?? null
}

export function canShowDesktopContextMenu(): boolean {
  if (typeof window === "undefined") {
    return false
  }

  return Boolean(window.desktopBridge?.showContextMenu || window.nativeApi?.contextMenu?.show)
}

export async function showDesktopContextMenu<T extends string>(
  items: readonly ContextMenuItem<T>[],
  position?: { x: number; y: number },
): Promise<T | null> {
  if (items.length === 0 || typeof window === "undefined") {
    return null
  }

  if (window.desktopBridge?.showContextMenu) {
    return window.desktopBridge.showContextMenu(items, position)
  }

  if (window.nativeApi?.contextMenu?.show) {
    return window.nativeApi.contextMenu.show(items, position)
  }

  return null
}
