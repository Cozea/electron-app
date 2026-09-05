import { useEffect } from "react";
import { T3OrchestrationClient } from "@cozea/client-runtime";
import type { OrchestrationEvent } from "@cozea/assistant-contracts";

import {
  useThreadDetailStore,
  type ThreadDetailRecord,
} from "@/features/assistant/model/threadDetailStore";
import { useSubstrateChatTransport } from "./useSubstrateChatTransport";
import { fetchT3RpcSession } from "./fetchT3RpcSession";
import { useT3CutoverActive } from "./t3CutoverStore";
import { superviseSubscription, type SubscriptionAttempt } from "./subscriptionSupervisor";
import { createSharedSubscriptionRegistry } from "./sharedSubscription";
import { setT3ConnectionStatus, t3ThreadConnectionKey } from "./t3ConnectionStatus";

const acquireThread = createSharedSubscriptionRegistry();

/** Snapshot-first protocol guard shared by every retry generation. */
export function createThreadStreamConsumer(threadId: string, attempt: SubscriptionAttempt) {
  let loaded = false;
  return (item: unknown) => {
    if (!attempt.isCurrent() || !item || typeof item !== "object") return;
    const row = item as Record<string, unknown>;
    try {
      if (row.kind === "snapshot" && row.snapshot && typeof row.snapshot === "object") {
        const snapshot = row.snapshot as Record<string, unknown>;
        const revision = snapshot.snapshotSequence;
        const thread = snapshot.thread;
        if (!thread || typeof thread !== "object" || !("id" in thread) || thread.id !== threadId) {
          throw new Error("Thread snapshot identity does not match the subscription");
        }
        const store = useThreadDetailStore.getState();
        if (typeof revision !== "number" || !Number.isSafeInteger(revision) || revision < 0) {
          throw new Error("Thread snapshot has no valid revision");
        }
        if (revision < (store.getThreadDetail(threadId)?.lastSequence ?? 0)) {
          throw new Error("Thread snapshot is older than accepted state");
        }
        store.ingestSnapshot(threadId, snapshot);
        const accepted = useThreadDetailStore.getState().getThreadDetail(threadId);
        if (!accepted?.loaded || accepted.snapshotSequence !== revision) {
          throw new Error("Thread snapshot was not accepted");
        }
        loaded = true;
        attempt.ready();
      } else if (row.kind === "event" && row.event) {
        if (!loaded) throw new Error("Thread event arrived before its snapshot");
        useThreadDetailStore.getState().applyEvent(threadId, row.event as OrchestrationEvent);
      }
    } catch (error) {
      attempt.disconnected(error);
    }
  };
}

const EMPTY_THREAD_RECORD: ThreadDetailRecord = {
  threadId: "",
  lastSequence: 0,
  loaded: false,
  snapshotSequence: null,
  canonical: { messages: [], activities: [], proposedPlans: [], checkpoints: [], session: null, latestTurn: null },
  messages: [],
  activities: [],
  proposedPlans: [],
  turnDiffSummaries: [],
  isStreaming: false,
  error: null,
};

/**
 * Hook for per-tile thread streaming directly from T3 Code's `orchestration.subscribeThread`.
 * Manages subscription lifecycle, real-time message chunks, and detail snapshots.
 */
export function useTileThreadStream(threadId: string | null | undefined): ThreadDetailRecord {
  const substrateTransport = useSubstrateChatTransport();
  const t3CutoverActive = useT3CutoverActive();

  const detail = useThreadDetailStore((state) =>
    threadId ? (state.byThreadId[threadId] ?? null) : null,
  );

  useEffect(() => {
    if (
      !threadId ||
      !substrateTransport.active ||
      !substrateTransport.shadowBaseUrl ||
      !t3CutoverActive
    ) {
      return;
    }

    const baseUrl = substrateTransport.shadowBaseUrl;
    const key = t3ThreadConnectionKey(baseUrl, threadId);
    return acquireThread(key, () => {
      const stop = superviseSubscription({
        status: (status) => setT3ConnectionStatus(key, status),
        connect: async (attempt) => {
          const abort = new AbortController();
          attempt.own(() => abort.abort());
          const session = await fetchT3RpcSession(baseUrl, abort.signal);
          if (!attempt.isCurrent()) return;
          const client = new T3OrchestrationClient(session);
          attempt.own(() => client.close());
          const unsubscribe = await client.subscribeThread(
            threadId,
            createThreadStreamConsumer(threadId, attempt),
            attempt.disconnected,
          );
          attempt.own(unsubscribe);
        },
      });
      return () => {
        stop();
        setT3ConnectionStatus(key, null);
      };
    });
  }, [threadId, substrateTransport.active, substrateTransport.shadowBaseUrl, t3CutoverActive]);

  return detail ?? (threadId ? { ...EMPTY_THREAD_RECORD, threadId } : EMPTY_THREAD_RECORD);
}
