import { ORCHESTRATION_WS_METHODS } from "@cozea/contracts";
import type { OrchestrationEvent } from "@cozea/assistant-contracts";

import { T3EffectRpcClient } from "./effectRpcClient";

export interface T3OrchestrationClientOptions {
  readonly baseUrl: string;
  readonly wsTicket: string;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly requestTimeoutMs?: number;
}

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

/** Native T3 Effect RPC orchestration client (Phase T2). */
export class T3OrchestrationClient {
  private readonly client: T3EffectRpcClient;
  private shellUnsubscribe: (() => Promise<void>) | null = null;
  private readonly shellListeners = new Set<(event: OrchestrationEvent) => void>();

  constructor(options: T3OrchestrationClientOptions) {
    this.client = new T3EffectRpcClient(options);
  }

  async close(): Promise<void> {
    this.shellListeners.clear();
    if (this.shellUnsubscribe) {
      await this.shellUnsubscribe();
      this.shellUnsubscribe = null;
    }
    await this.client.close();
  }

  async getArchivedShellSnapshot(): Promise<unknown> {
    return this.client.callUnary(ORCHESTRATION_WS_METHODS.getArchivedShellSnapshot, {});
  }

  async dispatchCommand(command: unknown): Promise<{ sequence: number }> {
    const result = await this.client.callUnary(ORCHESTRATION_WS_METHODS.dispatchCommand, command);
    const record = asRecord(result);
    const sequence =
      record && typeof record.sequence === "number"
        ? record.sequence
        : record && typeof record.receiptSequence === "number"
          ? record.receiptSequence
          : 0;
    return { sequence };
  }

  async getTurnDiff(params: unknown): Promise<unknown> {
    return this.client.callUnary(ORCHESTRATION_WS_METHODS.getTurnDiff, params);
  }

  async getFullThreadDiff(params: unknown): Promise<unknown> {
    return this.client.callUnary(ORCHESTRATION_WS_METHODS.getFullThreadDiff, params);
  }

  async getSnapshot(): Promise<unknown> {
    return this.getArchivedShellSnapshot();
  }

  private async ensureShellSubscription(): Promise<void> {
    if (this.shellUnsubscribe) {
      return;
    }
    this.shellUnsubscribe = await this.client.openStream(
      ORCHESTRATION_WS_METHODS.subscribeShell,
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

  async subscribeShellEvents(listener: (event: OrchestrationEvent) => void): Promise<() => void> {
    this.shellListeners.add(listener);
    await this.ensureShellSubscription();
    return () => {
      this.shellListeners.delete(listener);
    };
  }
}
