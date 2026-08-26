import { useEffect } from "react";

import type { OrchestrationEvent } from "@cozea/assistant-contracts";
import { SubstrateOrchestrationClient } from "@cozea/client-runtime";

import {
  coalesceOrchestrationUiEvents,
  useStore,
} from "@/stores/assistant-store";
import { createOrchestrationRecoveryCoordinator } from "@/stores/orchestrationRecovery";

const coordinator = createOrchestrationRecoveryCoordinator();

/**
 * When substrate-primary is active, stream orchestration domain events over
 * shadow RPC instead of relying solely on the in-process WS transport.
 */
export function useSubstrateOrchestrationSync(input: {
  readonly active: boolean;
  readonly shadowBaseUrl: string | null;
}): void {
  useEffect(() => {
    if (!input.active || !input.shadowBaseUrl) {
      return;
    }

    const client = new SubstrateOrchestrationClient({
      baseUrl: input.shadowBaseUrl,
    });

    let cancelled = false;
    const pending: OrchestrationEvent[] = [];

    const flush = () => {
      if (pending.length === 0) return;
      const batch = pending.splice(0, pending.length);
      const next = coordinator.markEventBatchApplied(batch);
      if (next.length === 0) return;
      useStore.getState().applyOrchestrationDomainEvents(coalesceOrchestrationUiEvents(next));
    };

    void (async () => {
      try {
        await client.connect();
        for await (const event of client.subscribeDomainEvents()) {
          if (cancelled) break;
          const action = coordinator.classifyDomainEvent(event.sequence);
          if (action === "ignore") continue;
          pending.push(event);
          if (action === "defer" || action === "recover") continue;
          flush();
        }
      } catch (error) {
        console.warn("[substrate.orchestration]", error);
      }
    })();

    return () => {
      cancelled = true;
      void client.close();
    };
  }, [input.active, input.shadowBaseUrl]);
}
