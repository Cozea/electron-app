import { useEffect } from "react";
import { T3OrchestrationClient } from "@cozea/client-runtime";
import type { OrchestrationEvent } from "@cozea/assistant-contracts";

import { useThreadDetailStore, type ThreadDetailRecord } from "@/features/assistant/model/threadDetailStore";
import { useSubstrateChatTransport } from "./useSubstrateChatTransport";
import { fetchT3RpcSession } from "./fetchT3RpcSession";
import { useT3CutoverActive } from "./t3CutoverStore";

const EMPTY_THREAD_RECORD: ThreadDetailRecord = {
  threadId: "",
  lastSequence: 0,
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
    threadId ? state.byThreadId[threadId] ?? null : null,
  );

  useEffect(() => {
    if (!threadId || !substrateTransport.active || !substrateTransport.shadowBaseUrl || !t3CutoverActive) {
      return;
    }

    let cancelled = false;
    let unsubStream: (() => Promise<void>) | null = null;
    let clientToClose: T3OrchestrationClient | null = null;

    const connectStream = async () => {
      try {
        const session = await fetchT3RpcSession(substrateTransport.shadowBaseUrl!);
        if (cancelled) return;

        const client = new T3OrchestrationClient({
          baseUrl: session.baseUrl,
          wsTicket: session.wsTicket,
        });
        clientToClose = client;

        unsubStream = await client.subscribeThread(threadId, (item: unknown) => {
          if (cancelled || !item || typeof item !== "object") return;
          const row = item as Record<string, unknown>;

          if (row.kind === "snapshot" && row.snapshot) {
            useThreadDetailStore.getState().ingestSnapshot(threadId, row.snapshot);
          } else if (row.kind === "event" && row.event) {
            useThreadDetailStore.getState().applyEvent(threadId, row.event as OrchestrationEvent);
          }
        });
      } catch (err) {
        if (!cancelled) {
          console.warn(`[useTileThreadStream] Failed to subscribe to thread ${threadId}:`, err);
        }
      }
    };

    void connectStream();

    return () => {
      cancelled = true;
      if (unsubStream) {
        void unsubStream().catch(() => {});
      }
      if (clientToClose) {
        void clientToClose.close().catch(() => {});
      }
    };
  }, [threadId, substrateTransport.active, substrateTransport.shadowBaseUrl, t3CutoverActive]);

  return detail ?? (threadId ? { ...EMPTY_THREAD_RECORD, threadId } : EMPTY_THREAD_RECORD);
}
