import { useSyncExternalStore } from "react"

import type { ServerConfig } from "@cozea/assistant-contracts"

import { ensureNativeApi } from "@/lib/nativeApi"
import {
  onServerConfigUpdated,
  onServerProvidersUpdated,
} from "@/lib/wsNativeApi"

import { toErrorMessage } from "./workbenchAssistantShared"

export type AssistantRuntimePhase = "idle" | "starting" | "ready" | "error"

export interface AssistantRuntimeStatus {
  phase: AssistantRuntimePhase
  wsUrl: string | null
  lastError: string | null
  updatedAt: number
}

export interface AssistantRuntimeMetadataSnapshot {
  status: AssistantRuntimeStatus
  config: ServerConfig | null
  configError: string | null
  isConfigLoading: boolean
}

const listeners = new Set<() => void>()

let subscriberCount = 0
let runtimeStatusUnsubscribe: (() => void) | null = null
let serverConfigUnsubscribe: (() => void) | null = null
let serverProvidersUnsubscribe: (() => void) | null = null
let activeConfigLoad: Promise<void> | null = null
let hasLoadedConfig = false

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

function createInitialSnapshot(): AssistantRuntimeMetadataSnapshot {
  return {
    status: createFallbackStatus(),
    config: null,
    configError: null,
    isConfigLoading: false,
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

function areStatusesEqual(
  left: AssistantRuntimeStatus,
  right: AssistantRuntimeStatus,
): boolean {
  return (
    left.phase === right.phase &&
    left.wsUrl === right.wsUrl &&
    left.lastError === right.lastError &&
    left.updatedAt === right.updatedAt
  )
}

let snapshot = createInitialSnapshot()

function emitSnapshot(nextSnapshot: AssistantRuntimeMetadataSnapshot) {
  if (
    areStatusesEqual(snapshot.status, nextSnapshot.status) &&
    snapshot.config === nextSnapshot.config &&
    snapshot.configError === nextSnapshot.configError &&
    snapshot.isConfigLoading === nextSnapshot.isConfigLoading
  ) {
    return
  }

  snapshot = nextSnapshot
  listeners.forEach((listener) => listener())
}

function updateSnapshot(
  updater: (current: AssistantRuntimeMetadataSnapshot) => AssistantRuntimeMetadataSnapshot,
) {
  emitSnapshot(updater(snapshot))
}

function maybeLoadServerConfig(options?: { showLoading?: boolean }) {
  if (activeConfigLoad) {
    return activeConfigLoad
  }

  if (options?.showLoading ?? !hasLoadedConfig) {
    updateSnapshot((current) => ({
      ...current,
      isConfigLoading: true,
    }))
  }

  activeConfigLoad = (async () => {
    try {
      const api = ensureNativeApi()
      const nextConfig = await api.server.getConfig()
      hasLoadedConfig = true
      updateSnapshot((current) => ({
        ...current,
        config: nextConfig,
        configError: null,
        isConfigLoading: false,
      }))
    } catch (error) {
      updateSnapshot((current) => ({
        ...current,
        configError: toErrorMessage(error),
        isConfigLoading: false,
      }))
    } finally {
      activeConfigLoad = null
    }
  })()

  return activeConfigLoad
}

function maybeRefreshConfigForStatus(status: AssistantRuntimeStatus) {
  if (status.phase !== "ready") {
    return
  }

  if (hasLoadedConfig && snapshot.config) {
    return
  }

  void maybeLoadServerConfig({ showLoading: !hasLoadedConfig }).catch(() => undefined)
}

function applyRuntimeStatus(nextStatus: Partial<AssistantRuntimeStatus> | null | undefined) {
  const normalized = normalizeStatus(nextStatus)
  emitSnapshot({
    ...snapshot,
    status: normalized,
  })
  maybeRefreshConfigForStatus(normalized)
}

function ensureSharedSubscriptions() {
  if (runtimeStatusUnsubscribe || serverConfigUnsubscribe || serverProvidersUnsubscribe) {
    return
  }

  const bridge = typeof window !== "undefined" ? window.desktopBridge : null
  if (!bridge) {
    applyRuntimeStatus({
      phase: "ready",
      wsUrl: null,
      lastError: null,
      updatedAt: Date.now(),
    })
  } else {
    void bridge
      .getAssistantRuntimeStatus()
      .then((status) => {
        applyRuntimeStatus(status)
      })
      .catch(() => undefined)

    runtimeStatusUnsubscribe =
      bridge.onAssistantRuntimeStatus?.((nextStatus) => {
        applyRuntimeStatus(nextStatus)
      }) ?? null
  }

  serverConfigUnsubscribe = onServerConfigUpdated((payload) => {
    let shouldReload = false
    updateSnapshot((current) => {
      if (!current.config) {
        shouldReload = true
        return {
          ...current,
          configError: null,
        }
      }

      return {
        ...current,
        config: {
          ...current.config,
          issues: payload.issues,
          settings: payload.settings ?? current.config.settings,
        },
        configError: null,
      }
    })

    if (shouldReload) {
      void maybeLoadServerConfig({ showLoading: false }).catch(() => undefined)
    }
  })

  serverProvidersUnsubscribe = onServerProvidersUpdated((payload) => {
    let shouldReload = false
    updateSnapshot((current) => {
      if (!current.config) {
        shouldReload = true
        return {
          ...current,
          configError: null,
        }
      }

      return {
        ...current,
        config: {
          ...current.config,
          providers: payload.providers,
        },
        configError: null,
      }
    })

    if (shouldReload) {
      void maybeLoadServerConfig({ showLoading: false }).catch(() => undefined)
    }
  })
}

function releaseSharedSubscriptions() {
  if (subscriberCount > 0) {
    return
  }

  runtimeStatusUnsubscribe?.()
  runtimeStatusUnsubscribe = null
  serverConfigUnsubscribe?.()
  serverConfigUnsubscribe = null
  serverProvidersUnsubscribe?.()
  serverProvidersUnsubscribe = null
  activeConfigLoad = null
}

function subscribeToAssistantRuntimeMetadata(listener: () => void) {
  listeners.add(listener)
  subscriberCount += 1
  ensureSharedSubscriptions()

  return () => {
    listeners.delete(listener)
    subscriberCount = Math.max(0, subscriberCount - 1)
    releaseSharedSubscriptions()
  }
}

function getAssistantRuntimeMetadataSnapshot() {
  return snapshot
}

function getAssistantRuntimeMetadataServerSnapshot() {
  return createInitialSnapshot()
}

export function useAssistantRuntimeMetadata(): AssistantRuntimeMetadataSnapshot {
  return useSyncExternalStore(
    subscribeToAssistantRuntimeMetadata,
    getAssistantRuntimeMetadataSnapshot,
    getAssistantRuntimeMetadataServerSnapshot,
  )
}

export function resetAssistantRuntimeMetadataForTests() {
  listeners.clear()
  subscriberCount = 0
  runtimeStatusUnsubscribe?.()
  runtimeStatusUnsubscribe = null
  serverConfigUnsubscribe?.()
  serverConfigUnsubscribe = null
  serverProvidersUnsubscribe?.()
  serverProvidersUnsubscribe = null
  activeConfigLoad = null
  hasLoadedConfig = false
  snapshot = createInitialSnapshot()
}

export function getAssistantRuntimeMetadataSnapshotForTests() {
  return snapshot
}
