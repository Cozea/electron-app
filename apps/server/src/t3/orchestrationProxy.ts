import type { OrchestrationEvent } from "@cozea/assistant-contracts";

import { authenticateT3Server } from "./auth.ts";
import { T3EffectRpcClient } from "./rpcClient.ts";

/** Minimal orchestration proxy surface shared by legacy WS and T3 RPC backends. */
export interface OrchestrationBackendProxy {
  getSnapshot(): Promise<unknown>;
  dispatchCommand(command: unknown): Promise<unknown>;
  getTurnDiff(params: unknown): Promise<unknown>;
  getFullThreadDiff(params: unknown): Promise<unknown>;
  replayEvents(params: unknown): Promise<unknown>;
  subscribeDomainEvents(listener: (event: OrchestrationEvent) => void): Promise<() => void>;
  close(): Promise<void>;
}

const T3_ORCHESTRATION = {
  getArchivedShellSnapshot: "orchestration.getArchivedShellSnapshot",
  dispatchCommand: "orchestration.dispatchCommand",
  getTurnDiff: "orchestration.getTurnDiff",
  getFullThreadDiff: "orchestration.getFullThreadDiff",
  subscribeShell: "orchestration.subscribeShell",
} as const;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function shellEventToDomainEvent(value: unknown): OrchestrationEvent | null {
  const record = asRecord(value);
  if (!record || typeof record.sequence !== "number") {
    return null;
  }
  return {
    sequence: record.sequence,
    ...(record as Record<string, unknown>),
  } as OrchestrationEvent;
}

export class T3OrchestrationRpcProxy implements OrchestrationBackendProxy {
  private readonly client: T3EffectRpcClient;
  private readonly shellListeners = new Set<(event: OrchestrationEvent) => void>();
  private shellUnsubscribe: (() => Promise<void>) | null = null;

  constructor(client: T3EffectRpcClient) {
    this.client = client;
  }

  static async connect(input: {
    readonly baseUrl: string;
    readonly pairingToken: string;
  }): Promise<T3OrchestrationRpcProxy> {
    const wsTicket = await authenticateT3Server(input.baseUrl, input.pairingToken);
    return new T3OrchestrationRpcProxy(
      new T3EffectRpcClient({ baseUrl: input.baseUrl, wsTicket }),
    );
  }

  async close(): Promise<void> {
    this.shellListeners.clear();
    if (this.shellUnsubscribe) {
      await this.shellUnsubscribe();
      this.shellUnsubscribe = null;
    }
    await this.client.close();
  }

  async getSnapshot(): Promise<unknown> {
    return this.client.callUnary(T3_ORCHESTRATION.getArchivedShellSnapshot, {});
  }

  async dispatchCommand(command: unknown): Promise<unknown> {
    return this.client.callUnary(T3_ORCHESTRATION.dispatchCommand, command);
  }

  async getTurnDiff(params: unknown): Promise<unknown> {
    return this.client.callUnary(T3_ORCHESTRATION.getTurnDiff, params);
  }

  async getFullThreadDiff(params: unknown): Promise<unknown> {
    return this.client.callUnary(T3_ORCHESTRATION.getFullThreadDiff, params);
  }

  async replayEvents(_params: unknown): Promise<unknown> {
    // T1: T3 uses shell streams instead of legacy replayEvents; return empty until T3 cutover maps sequences.
    return { events: [] };
  }

  private async ensureShellSubscription(): Promise<void> {
    if (this.shellUnsubscribe) {
      return;
    }
    this.shellUnsubscribe = await this.client.openStream(
      T3_ORCHESTRATION.subscribeShell,
      { requestCompletionMarker: true },
      (item) => {
        const row = asRecord(item);
        if (!row || row.kind === "snapshot" || row.kind === "synchronized") {
          return;
        }
        const mapped = shellEventToDomainEvent(row);
        if (!mapped) {
          return;
        }
        for (const listener of this.shellListeners) {
          listener(mapped);
        }
      },
    );
  }

  async subscribeDomainEvents(
    listener: (event: OrchestrationEvent) => void,
  ): Promise<() => void> {
    this.shellListeners.add(listener);
    await this.ensureShellSubscription();
    return () => {
      this.shellListeners.delete(listener);
    };
  }
}
