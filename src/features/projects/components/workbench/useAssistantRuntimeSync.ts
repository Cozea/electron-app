import { useEffect } from "react"

import { ensureNativeApi } from "@/lib/nativeApi"
import { useStore } from "@/stores/assistant-store"

let subscriberCount = 0
let unsubscribeDomainEvents: (() => void) | null = null
let activeRefresh: Promise<void> | null = null
let queuedRefresh = false

async function performRefresh() {
  const api = ensureNativeApi()
  const snapshot = await api.orchestration.getSnapshot()
  useStore.getState().syncServerReadModel(snapshot)
}

export async function refreshAssistantRuntimeSnapshot(): Promise<void> {
  queuedRefresh = true

  if (activeRefresh) {
    return activeRefresh
  }

  activeRefresh = (async () => {
    while (queuedRefresh) {
      queuedRefresh = false
      await performRefresh()
    }
  })().finally(() => {
    activeRefresh = null
  })

  return activeRefresh
}

function ensureDomainEventSubscription() {
  if (unsubscribeDomainEvents) {
    return
  }

  const api = ensureNativeApi()
  void refreshAssistantRuntimeSnapshot().catch(() => undefined)
  unsubscribeDomainEvents = api.orchestration.onDomainEvent(() => {
    void refreshAssistantRuntimeSnapshot().catch(() => undefined)
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
