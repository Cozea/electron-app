import { useEffect } from "react"

import type { OrchestrationEvent } from "@cozea/assistant-contracts"
import { ensureNativeApi } from "@/lib/nativeApi"
import { coalesceOrchestrationUiEvents, useStore } from "@/stores/assistant-store"

let subscriberCount = 0
let unsubscribeDomainEvents: (() => void) | null = null
let activeRefresh: Promise<void> | null = null
let queuedRefresh = false

async function performSnapshotSync() {
  const api = ensureNativeApi()
  const snapshot = await api.orchestration.getSnapshot()
  useStore.getState().syncServerReadModel(snapshot)
}

/**
 * Coalesced full read-model refresh (initial hydrate + explicit invalidation).
 */
export async function refreshAssistantRuntimeSnapshot(): Promise<void> {
  queuedRefresh = true

  if (activeRefresh) {
    return activeRefresh
  }

  activeRefresh = (async () => {
    while (queuedRefresh) {
      queuedRefresh = false
      await performSnapshotSync()
    }
  })().finally(() => {
    activeRefresh = null
  })

  return activeRefresh
}

let pendingDomainEvents: OrchestrationEvent[] = []
let flushMicrotaskScheduled = false

function flushPendingDomainEvents() {
  flushMicrotaskScheduled = false
  if (pendingDomainEvents.length === 0) {
    return
  }

  const batch = pendingDomainEvents
  pendingDomainEvents = []
  const coalesced = coalesceOrchestrationUiEvents(batch)
  useStore.getState().applyOrchestrationDomainEvents(coalesced)
}

function scheduleDomainEventFlush() {
  if (flushMicrotaskScheduled) {
    return
  }
  flushMicrotaskScheduled = true
  queueMicrotask(() => {
    flushPendingDomainEvents()
  })
}

function ensureDomainEventSubscription() {
  if (unsubscribeDomainEvents) {
    return
  }

  const api = ensureNativeApi()
  void refreshAssistantRuntimeSnapshot().catch(() => undefined)
  unsubscribeDomainEvents = api.orchestration.onDomainEvent((event: OrchestrationEvent) => {
    pendingDomainEvents.push(event)
    scheduleDomainEventFlush()
  })
}

function releaseDomainEventSubscription() {
  if (subscriberCount > 0 || !unsubscribeDomainEvents) {
    return
  }

  unsubscribeDomainEvents()
  unsubscribeDomainEvents = null
  activeRefresh = null
  queuedRefresh = false
  pendingDomainEvents = []
  flushMicrotaskScheduled = false
}

export function useAssistantRuntimeSync(enabled = true) {
  useEffect(() => {
    if (!enabled) {
      return
    }

    subscriberCount += 1
    ensureDomainEventSubscription()

    return () => {
      subscriberCount = Math.max(0, subscriberCount - 1)
      releaseDomainEventSubscription()
    }
  }, [enabled])
}
