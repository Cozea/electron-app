import { useEffect } from "react"

import type { NativeApi, OrchestrationEvent } from "@cozea/assistant-contracts"
import { flushPendingAssistantProjectDeletions } from "@/features/assistant/services/assistantProjectDeletion"
import { ensureNativeApi } from "@/lib/nativeApi"
import { coalesceOrchestrationUiEvents, useStore } from "@/features/assistant/model/assistantStore"
import { createOrchestrationRecoveryCoordinator } from "@/features/assistant/model/orchestrationRecovery"

let subscriberCount = 0
let unsubscribeDomainEvents: (() => void) | null = null

const coordinator = createOrchestrationRecoveryCoordinator()

// First-ever hydration builds every thread's slices from scratch; one
// synchronous apply blocked the main thread for seconds on large profiles.
// Applying prefix batches with yields keeps startup interactive — repeat
// applies of already-built threads are near-free (content fingerprints in
// writeThreadFromReadModel), and the recovery coordinator defers incoming
// domain events until completeSnapshotRecovery, so batching stays consistent.
const FIRST_HYDRATION_THREAD_BATCH = 8

type AssistantRuntimeSnapshot = Awaited<ReturnType<NativeApi["orchestration"]["getSnapshot"]>>

interface SnapshotRefreshState {
  active: Promise<AssistantRuntimeSnapshot> | null
  queued: boolean
}

// A renderer can briefly see two NativeApi instances while T3 reconnects. Never
// let one runtime's in-flight refresh satisfy a caller that explicitly supplied
// another runtime instance.
const snapshotRefreshByApi = new Map<NativeApi, SnapshotRefreshState>()

function snapshotRefreshState(api: NativeApi): SnapshotRefreshState {
  let state = snapshotRefreshByApi.get(api)
  if (!state) {
    state = { active: null, queued: false }
    snapshotRefreshByApi.set(api, state)
  }
  return state
}

function yieldToMain(): Promise<void> {
  const scheduler = (globalThis as { scheduler?: { yield?: () => Promise<void> } }).scheduler
  if (typeof scheduler?.yield === "function") {
    return scheduler.yield()
  }
  return new Promise((resolve) => setTimeout(resolve, 0))
}

async function applySnapshotToStore(snapshot: AssistantRuntimeSnapshot) {
  const alreadyHydrated = useStore.getState().threadsHydrated
  if (alreadyHydrated || snapshot.threads.length <= FIRST_HYDRATION_THREAD_BATCH) {
    useStore.getState().syncServerReadModel(snapshot)
    return
  }

  for (let end = FIRST_HYDRATION_THREAD_BATCH; ; end += FIRST_HYDRATION_THREAD_BATCH) {
    const done = end >= snapshot.threads.length
    useStore.getState().syncServerReadModel(
      done ? snapshot : { ...snapshot, threads: snapshot.threads.slice(0, end) },
    )
    if (done) break
    await yieldToMain()
  }
}

async function performSnapshotSync(api: NativeApi): Promise<AssistantRuntimeSnapshot> {
  const snapshot = await api.orchestration.getSnapshot()
  await applySnapshotToStore(snapshot)
  await flushPendingAssistantProjectDeletions({
    snapshotIsAuthoritative: true,
    nativeApi: api,
  })
  const shouldReplay = coordinator.completeSnapshotRecovery(snapshot.snapshotSequence)
  if (shouldReplay) {
    const nextEvents = coordinator.markEventBatchApplied(pendingDomainEvents)
    if (nextEvents.length > 0) {
      const coalesced = coalesceOrchestrationUiEvents(nextEvents)
      useStore.getState().applyOrchestrationDomainEvents(coalesced)
    }
  }
  return snapshot
}

/**
 * Coalesced full read-model refresh (initial hydrate + explicit invalidation).
 * Calls sharing a NativeApi reuse one in-flight refresh; calls for a different
 * NativeApi never await or consume another runtime's snapshot.
 */
export async function refreshAssistantRuntimeSnapshot(
  api: NativeApi = ensureNativeApi(),
): Promise<AssistantRuntimeSnapshot> {
  const state = snapshotRefreshState(api)
  state.queued = true

  if (state.active) {
    return state.active
  }

  let latestSnapshot: AssistantRuntimeSnapshot | null = null
  const active = (async () => {
    while (state.queued) {
      state.queued = false
      latestSnapshot = await performSnapshotSync(api)
    }
    if (!latestSnapshot) {
      throw new Error("Assistant runtime snapshot refresh produced no snapshot.")
    }
    return latestSnapshot
  })()
  state.active = active

  try {
    return await active
  } finally {
    if (state.active === active) {
      state.active = null
      if (!state.queued) snapshotRefreshByApi.delete(api)
    }
  }
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

  const nextEvents = coordinator.markEventBatchApplied(batch)
  if (nextEvents.length === 0) return

  const coalesced = coalesceOrchestrationUiEvents(nextEvents)
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
  if (coordinator.beginSnapshotRecovery("bootstrap")) {
    void refreshAssistantRuntimeSnapshot(api).catch(() => {
      coordinator.failSnapshotRecovery()
    })
  }

  unsubscribeDomainEvents = api.orchestration.onDomainEvent((event: OrchestrationEvent) => {
    const action = coordinator.classifyDomainEvent(event.sequence)
    if (action === "ignore") return

    pendingDomainEvents.push(event)

    if (action === "defer") {
      return
    }

    if (action === "recover") {
      if (coordinator.beginSnapshotRecovery("sequence-gap")) {
        void refreshAssistantRuntimeSnapshot(api).catch(() => {
          coordinator.failSnapshotRecovery()
        })
      }
      return
    }

    scheduleDomainEventFlush()
  })
}

function releaseDomainEventSubscription() {
  if (subscriberCount > 0 || !unsubscribeDomainEvents) {
    return
  }

  unsubscribeDomainEvents()
  unsubscribeDomainEvents = null
  pendingDomainEvents = []
  flushMicrotaskScheduled = false
  coordinator.failSnapshotRecovery()
  coordinator.failReplayRecovery()
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
