import { useEffect } from "react";

import type { OrchestrationEvent } from "@cozea/assistant-contracts";
import { SubstrateOrchestrationClient, T3OrchestrationClient } from "@cozea/client-runtime";

import { coalesceOrchestrationUiEvents, useStore } from "@/features/assistant/model/assistantStore";
import { createOrchestrationRecoveryCoordinator } from "@/features/assistant/model/orchestrationRecovery";

import { mergeT3ShellSnapshot } from "@/features/assistant/model/t3ShellSnapshot";

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
          closeClient = () => client.close();
          // Shell metadata is authoritative for session/turn state. Detail streams
          // belong to the visible tiles and do not share a contiguous sequence.
          await client.onSnapshot((snapshot) => {
            if (cancelled) return;
            const store = useStore.getState();
            store.syncServerReadModel(mergeT3ShellSnapshot(store.orchestrationReadModel, snapshot));
          });
          if (cancelled) await client.close();
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
