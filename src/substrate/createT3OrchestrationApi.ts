import type {
  ClientOrchestrationCommand,
  OrchestrationEvent,
  OrchestrationGetFullThreadDiffInput,
  OrchestrationGetFullThreadDiffResult,
  OrchestrationGetTurnDiffInput,
  OrchestrationGetTurnDiffResult,
  OrchestrationReadModel,
} from "@cozea/assistant-contracts";
import type { NativeApi } from "@cozea/assistant-contracts";
import { T3OrchestrationClient } from "@cozea/client-runtime";

export interface T3OrchestrationApiHandle {
  readonly orchestration: NativeApi["orchestration"];
  readonly client: T3OrchestrationClient;
  close(): Promise<void>;
}

export function createT3OrchestrationApi(input: {
  readonly baseUrl: string;
  readonly wsTicket: string;
}): T3OrchestrationApiHandle {
  const client = new T3OrchestrationClient({
    baseUrl: input.baseUrl,
    wsTicket: input.wsTicket,
  });

  const domainListeners = new Set<(event: OrchestrationEvent) => void>();
  let unsubscribeShell: (() => void) | null = null;

  const ensureShellSubscription = async (): Promise<void> => {
    if (unsubscribeShell) return;
    unsubscribeShell = await client.subscribeShellEvents((event) => {
      for (const listener of domainListeners) {
        listener(event);
      }
    });
  };

  const orchestration: NativeApi["orchestration"] = {
    getSnapshot: async () => (await client.getSnapshot()) as OrchestrationReadModel,
    dispatchCommand: async (command: ClientOrchestrationCommand) => client.dispatchCommand(command),
    getTurnDiff: async (input: OrchestrationGetTurnDiffInput) =>
      (await client.getTurnDiff(input)) as OrchestrationGetTurnDiffResult,
    getFullThreadDiff: async (input: OrchestrationGetFullThreadDiffInput) =>
      (await client.getFullThreadDiff(input)) as OrchestrationGetFullThreadDiffResult,
    replayEvents: async () => [],
    onDomainEvent: (callback) => {
      domainListeners.add(callback);
      void ensureShellSubscription();
      return () => {
        domainListeners.delete(callback);
      };
    },
  };

  return {
    orchestration,
    client,
    close: async () => {
      domainListeners.clear();
      unsubscribeShell?.();
      unsubscribeShell = null;
      await client.close();
    },
  };
}
