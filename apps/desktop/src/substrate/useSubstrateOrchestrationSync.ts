import { useEffect } from "react";

import type { OrchestrationEvent, OrchestrationReadModel } from "@cozea/assistant-contracts";
import { SubstrateOrchestrationClient, T3OrchestrationClient } from "@cozea/client-runtime";

import {
  coalesceOrchestrationUiEvents,
  useStore,
} from "@/features/assistant/model/assistantStore";
import { createOrchestrationRecoveryCoordinator } from "@/features/assistant/model/orchestrationRecovery";

import { fetchT3RpcSession } from "./fetchT3RpcSession";

const coordinator = createOrchestrationRecoveryCoordinator();
const SHADOW_READY_PATH = "/.well-known/cozea/substrate/ready";

async function readShadowReadyT3Enabled(shadowBaseUrl: string): Promise<boolean> {
  try {
    const response = await fetch(new URL(SHADOW_READY_PATH, shadowBaseUrl));
    if (!response.ok) return false;
    const json = (await response.json()) as { t3Server?: boolean };
    return json.t3Server === true;
  } catch {
    return false;
  }
}

export interface SubstrateOrchestrationSyncInput {
  readonly active: boolean;
  readonly shadowBaseUrl: string | null;
}

/**
 * When substrate-primary is active, stream orchestration over shadow substrate JSON-RPC
 * or native T3 Effect RPC when the shadow child reports `t3Server: true` (Phase T2).
 */
export function useSubstrateOrchestrationSync(input: SubstrateOrchestrationSyncInput): void {
  useEffect(() => {
    if (!input.active || !input.shadowBaseUrl) {
      return;
    }

    let cancelled = false;
    let closeClient: (() => Promise<void>) | null = null;
    const pending: OrchestrationEvent[] = [];

    const flush = () => {
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      const next = coordinator.markEventBatchApplied(batch);
      if (next.length === 0) return;
      useStore.getState().applyOrchestrationDomainEvents(coalesceOrchestrationUiEvents(next));
    };

    const onDomainEvent = (event: OrchestrationEvent) => {
      if (cancelled) return;
      const action = coordinator.classifyDomainEvent(event.sequence);
      if (action === "ignore") return;
      pending.push(event);
      if (action === "defer" || action === "recover") return;
      flush();
    };

    void (async () => {
      try {
        const t3Server = await readShadowReadyT3Enabled(input.shadowBaseUrl!);
        if (cancelled) return;

        if (t3Server) {
          const session = await fetchT3RpcSession(input.shadowBaseUrl!);
          if (cancelled) return;
          const client = new T3OrchestrationClient({
            baseUrl: session.baseUrl,
            wsTicket: session.wsTicket,
          });
          const threadUnsubs: Array<() => Promise<void>> = [];
          closeClient = async () => {
            for (const unsub of threadUnsubs) {
              await unsub().catch(() => {});
            }
            await client.close();
          };

          // The archived snapshot intentionally omits active threads and any
          // projects referenced only by them. Hydrate from the live shell
          // snapshot so tiles restored from the current workbench bind to the
          // existing server project instead of attempting a duplicate create.
          const snapshot = await client.getSnapshot();
          if (!cancelled && snapshot && typeof snapshot === "object") {
            const record = snapshot as Record<string, unknown>;
            if (Array.isArray(record.threads) && Array.isArray(record.projects)) {
              useStore.getState().syncServerReadModel(snapshot as OrchestrationReadModel);
            }
          }

          await client.subscribeShellEvents((event) => {
            onDomainEvent(event);
            if (event.type === "thread.created" && (event as unknown as { payload: { threadId: string } }).payload?.threadId) {
              const thId = (event as unknown as { payload: { threadId: string } }).payload.threadId;
              void client.subscribeThread(thId, (item) => {
                const row = item as Record<string, unknown>;
                if (row?.kind === "event" && row.event) {
                  onDomainEvent(row.event as OrchestrationEvent);
                }
              }).then((unsub) => threadUnsubs.push(unsub));
            }
          });

          const initialThreads = ((snapshot as Record<string, unknown>)?.threads ?? []) as Array<{ id: string }>;
          for (const th of initialThreads) {
            const unsub = await client.subscribeThread(th.id, (item) => {
              const row = item as Record<string, unknown>;
              if (row?.kind === "event" && row.event) {
                onDomainEvent(row.event as OrchestrationEvent);
              }
            });
            threadUnsubs.push(unsub);
          }

          while (!cancelled) {
            await new Promise((resolve) => setTimeout(resolve, 500));
          }
          return;
        }

        const client = new SubstrateOrchestrationClient({
          baseUrl: input.shadowBaseUrl!,
        });
        closeClient = () => client.close();
        await client.connect();
        for await (const event of client.subscribeDomainEvents()) {
          if (cancelled) break;
          onDomainEvent(event);
        }
      } catch (error) {
        console.warn("[substrate.orchestration]", error);
      }
    })();

    return () => {
      cancelled = true;
      void closeClient?.();
    };
  }, [input.active, input.shadowBaseUrl]);
}
