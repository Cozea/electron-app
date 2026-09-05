import { useEffect } from "react";
import { Schema } from "effect";
import { OrchestrationReadModel } from "@cozea/assistant-contracts";
import { SubstrateOrchestrationClient, T3OrchestrationClient } from "@cozea/client-runtime";
import { coalesceOrchestrationUiEvents, useStore } from "@/features/assistant/model/assistantStore";
import { mergeT3ShellSnapshot } from "@/features/assistant/model/t3ShellSnapshot";
import { fetchT3RpcSession } from "./fetchT3RpcSession";
import { superviseSubscription } from "./subscriptionSupervisor";
import { setT3ConnectionStatus, t3ShellConnectionKey } from "./t3ConnectionStatus";
import { createSharedSubscriptionRegistry } from "./sharedSubscription";

const acquireShell = createSharedSubscriptionRegistry();
const SHADOW_READY_PATH = "/.well-known/cozea/substrate/ready";

/** Transport failure is not evidence that the server uses the legacy protocol. */
export async function readShadowReadyT3Enabled(shadowBaseUrl: string, signal: AbortSignal): Promise<boolean> {
  const response = await fetch(new URL(SHADOW_READY_PATH, shadowBaseUrl), { signal });
  if (!response.ok) throw new Error(`Shadow readiness unavailable (${response.status})`);
  const json: unknown = await response.json();
  if (!json || typeof json !== "object") throw new Error("Invalid shadow readiness response");
  const payload = json as Record<string, unknown>;
  if (payload.ok !== true) throw new Error("Shadow is not ready");
  if (payload.t3Server !== undefined && typeof payload.t3Server !== "boolean") {
    throw new Error("Invalid shadow transport capability");
  }
  // Older successful readiness payloads predate the optional t3Server flag.
  return payload.t3Server === true;
}

/** Shared by mounted views; each retry owns discovery, credentials and subscriptions. */
export function acquireSubstrateOrchestrationSync(baseUrl: string): () => void {
  const key = t3ShellConnectionKey(baseUrl);
  return acquireShell(key, () => {
    let latestSequence = -1;
    const stop = superviseSubscription({
      status: status => setT3ConnectionStatus(key, status),
      connect: async attempt => {
        const abort = new AbortController();
        attempt.own(() => abort.abort());
        const native = await readShadowReadyT3Enabled(baseUrl, abort.signal);
        if (!attempt.isCurrent()) return;
        if (native) {
          const session = await fetchT3RpcSession(baseUrl, abort.signal);
          if (!attempt.isCurrent()) return;
          const client = new T3OrchestrationClient(session);
          attempt.own(() => client.close());
          attempt.own(client.onDisconnect(attempt.disconnected));
          const unsubscribe = await client.onSnapshot(snapshot => {
            if (!attempt.isCurrent()) return;
            if (snapshot.snapshotSequence < latestSequence) {
              attempt.disconnected(new Error("Shell snapshot is older than accepted state"));
              return;
            }
            const store = useStore.getState();
            store.syncServerReadModel(mergeT3ShellSnapshot(store.orchestrationReadModel, snapshot));
            latestSequence = snapshot.snapshotSequence;
            attempt.ready();
          });
          attempt.own(unsubscribe);
          return;
        }

        const client = new SubstrateOrchestrationClient({
          baseUrl,
          onPhaseChange: (phase, detail) => {
            if (phase === "error" || phase === "closed" || phase === "reconnecting") {
              attempt.disconnected(new Error(detail ?? "Legacy subscription disconnected"));
            }
          },
        });
        attempt.own(() => client.close());
        await client.connect();
        if (!attempt.isCurrent()) return;
        // The RPC returns the full read model, not a command input requiring defaults.
        const snapshot = Schema.decodeUnknownSync(Schema.toType(OrchestrationReadModel))(
          await client.getSnapshot(),
        );
        if (!attempt.isCurrent()) return;
        if (snapshot.snapshotSequence < latestSequence) throw new Error("Legacy snapshot is older than accepted state");
        useStore.getState().syncServerReadModel(snapshot);
        latestSequence = snapshot.snapshotSequence;
        attempt.ready();
        // The persisted global stream replays everything after the snapshot.
        // A fresh owner never reuses a previous server's recovery coordinator.
        for await (const event of client.subscribeDomainEvents({ afterSequence: latestSequence })) {
          if (!attempt.isCurrent()) return;
          if (event.sequence <= latestSequence) continue;
          useStore.getState().applyOrchestrationDomainEvents(coalesceOrchestrationUiEvents([event]));
          latestSequence = event.sequence;
        }
        if (attempt.isCurrent()) attempt.disconnected(new Error("Legacy event stream ended"));
      },
    });
    return () => { stop(); setT3ConnectionStatus(key, null); };
  });
}

export interface SubstrateOrchestrationSyncInput {
  readonly active: boolean;
  readonly shadowBaseUrl: string | null;
}
export function useSubstrateOrchestrationSync(input: SubstrateOrchestrationSyncInput): void {
  useEffect(() => {
    if (!input.active || !input.shadowBaseUrl) return;
    return acquireSubstrateOrchestrationSync(input.shadowBaseUrl);
  }, [input.active, input.shadowBaseUrl]);
}
