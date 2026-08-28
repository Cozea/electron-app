import { useSyncExternalStore } from "react"

import type { ProviderDriverKind, ProviderInstanceId, ServerConfig } from "@cozea/assistant-contracts"

import {
  createFallbackAssistantRuntimeStatus,
  readAssistantRuntimeBridgeStatus,
  subscribeToAssistantRuntimeBridgeStatus,
} from "@/lib/desktopBridgeClient"
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
let t3ConfigBridgeUnsubscribe: (() => void) | null = null
let t3ConfigBridge: T3ServerConfigBridge | null = null
const t3ConfigBridges = new Map<symbol, T3ServerConfigBridge>()
let activeConfigLoad: Promise<void> | null = null
let hasLoadedConfig = false

export interface T3ServerConfigBridge {
  getConfig(): Promise<ServerConfig>
  subscribe(listener: (config: ServerConfig) => void): () => void
  refreshProviders?(): Promise<void>
  updateProvider?(provider: ProviderDriverKind, instanceId?: ProviderInstanceId): Promise<void>
}

export async function updateAssistantProvider(
  provider: ProviderDriverKind,
  instanceId?: ProviderInstanceId,
): Promise<void> {
  if (!t3ConfigBridge?.updateProvider) {
    throw new Error("Provider updates require the local T3 runtime.")
  }
  await t3ConfigBridge.updateProvider(provider, instanceId)
  await t3ConfigBridge.refreshProviders?.()
  await maybeLoadServerConfig({ showLoading: false })
}

function createFallbackStatus(): AssistantRuntimeStatus {
  return createFallbackAssistantRuntimeStatus()
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

function releaseLegacyServerConfigSubscriptions() {
  serverConfigUnsubscribe?.()
  serverConfigUnsubscribe = null
  serverProvidersUnsubscribe?.()
  serverProvidersUnsubscribe = null
}

function releaseT3ServerConfigBridge() {
  t3ConfigBridgeUnsubscribe?.()
  t3ConfigBridgeUnsubscribe = null
  t3ConfigBridge = null
}

function ensureLegacyServerConfigSubscriptions() {
  if (t3ConfigBridge || serverConfigUnsubscribe || serverProvidersUnsubscribe) {
    return
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

function activateT3ServerConfigBridge(bridge: T3ServerConfigBridge): void {
  if (t3ConfigBridge === bridge) {
    return
  }
  releaseT3ServerConfigBridge()
  releaseLegacyServerConfigSubscriptions()
  t3ConfigBridge = bridge
  t3ConfigBridgeUnsubscribe = bridge.subscribe((config) => {
    hasLoadedConfig = true
    updateSnapshot((current) => ({
      ...current,
      config,
      configError: null,
      isConfigLoading: false,
    }))
  })
  void maybeLoadServerConfig({ showLoading: !hasLoadedConfig }).catch(() => undefined)
}

export function connectT3ServerConfigBridge(
  owner: symbol,
  bridge: T3ServerConfigBridge,
): void {
  t3ConfigBridges.delete(owner)
  t3ConfigBridges.set(owner, bridge)
  activateT3ServerConfigBridge(bridge)
}

export function disconnectT3ServerConfigBridge(owner: symbol): void {
  const removedBridge = t3ConfigBridges.get(owner)
  t3ConfigBridges.delete(owner)
  if (!removedBridge || removedBridge !== t3ConfigBridge) {
    return
  }
  const fallbackBridge = Array.from(t3ConfigBridges.values()).at(-1) ?? null
  if (fallbackBridge) {
    activateT3ServerConfigBridge(fallbackBridge)
    return
  }
  const hadBridge = t3ConfigBridge !== null
  releaseT3ServerConfigBridge()
  if (!hadBridge) {
    return
  }
  if (subscriberCount > 0) {
    ensureLegacyServerConfigSubscriptions()
    void maybeLoadServerConfig({ showLoading: false }).catch(() => undefined)
  }
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
      const nextConfig = t3ConfigBridge
        ? await t3ConfigBridge.getConfig()
        : await ensureNativeApi().server.getConfig()
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
  if (t3ConfigBridge) {
    if (hasLoadedConfig && snapshot.config) {
      return
    }
    void maybeLoadServerConfig({ showLoading: !hasLoadedConfig }).catch(() => undefined)
    return
  }

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
  if (runtimeStatusUnsubscribe) {
    if (!t3ConfigBridge) {
      ensureLegacyServerConfigSubscriptions()
    }
    return
  }

  runtimeStatusUnsubscribe = subscribeToAssistantRuntimeBridgeStatus((nextStatus) => {
    applyRuntimeStatus(nextStatus)
  })

  if (!runtimeStatusUnsubscribe) {
    applyRuntimeStatus({
      phase: "ready",
      wsUrl: null,
      lastError: null,
      updatedAt: Date.now(),
    })
  } else {
    void readAssistantRuntimeBridgeStatus()
      .then((status) => {
        applyRuntimeStatus(status)
      })
      .catch(() => undefined)
  }

  if (!t3ConfigBridge) {
    ensureLegacyServerConfigSubscriptions()
  }
}

function releaseSharedSubscriptions() {
  if (subscriberCount > 0) {
    return
  }

  runtimeStatusUnsubscribe?.()
  runtimeStatusUnsubscribe = null
  releaseLegacyServerConfigSubscriptions()
  releaseT3ServerConfigBridge()
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
  releaseLegacyServerConfigSubscriptions()
  releaseT3ServerConfigBridge()
  activeConfigLoad = null
  hasLoadedConfig = false
  snapshot = createInitialSnapshot()
}

export function getAssistantRuntimeMetadataSnapshotForTests() {
  return snapshot
}
