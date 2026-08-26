import {
  ORCHESTRATION_RPC_METHODS,
  SUBSTRATE_RPC_METHODS,
  SUBSTRATE_RPC_WS_PATH,
  type OrchestrationDomainEventEnvelope,
  type OrchestrationRpcEvent,
} from "@cozea/contracts";
import type { OrchestrationEvent } from "@cozea/assistant-contracts";

import {
  ConnectionSupervisor,
  type ConnectionPhase,
} from "./connectionSupervisor";

export interface SubstrateOrchestrationClientOptions {
  readonly baseUrl: string;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly onPhaseChange?: (phase: ConnectionPhase, detail?: string) => void;
  readonly requestTimeoutMs?: number;
}

interface PendingRequest {
  readonly resolve: (value: unknown) => void;
  readonly reject: (error: Error) => void;
  readonly timeout: ReturnType<typeof setTimeout> | null;
}

interface PendingSubscription {
  readonly push: (event: OrchestrationRpcEvent) => void;
  readonly end: () => void;
  readonly fail: (error: Error) => void;
}

function toWsUrl(baseUrl: string): string {
  const url = new URL(baseUrl);
  url.protocol = url.protocol === "https:" ? "wss:" : "ws:";
  url.pathname = SUBSTRATE_RPC_WS_PATH;
  url.search = "";
  url.hash = "";
  return url.toString();
}

/** Substrate RPC client for orchestration methods (Phase 2+ cutover). */
export class SubstrateOrchestrationClient {
  private readonly supervisor: ConnectionSupervisor;
  private readonly requestTimeoutMs: number;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, PendingSubscription>();

  constructor(options: SubstrateOrchestrationClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 30_000;
    this.supervisor = new ConnectionSupervisor({
      url: toWsUrl(options.baseUrl),
      WebSocketImpl: options.WebSocketImpl,
      onPhaseChange: options.onPhaseChange,
      onMessage: (data) => this.handleMessage(data),
    });
  }

  getPhase(): ConnectionPhase {
    return this.supervisor.getPhase();
  }

  async connect(): Promise<void> {
    await this.supervisor.connect();
  }

  async close(): Promise<void> {
    for (const [, pending] of this.pending) {
      if (pending.timeout) clearTimeout(pending.timeout);
      pending.reject(new Error("Client closed"));
    }
    this.pending.clear();
    for (const [, sub] of this.subscriptions) {
      sub.fail(new Error("Client closed"));
    }
    this.subscriptions.clear();
    await this.supervisor.close();
  }

  async getSnapshot(): Promise<unknown> {
    return await this.request(ORCHESTRATION_RPC_METHODS.getSnapshot, {});
  }

  async dispatchCommand(command: unknown): Promise<unknown> {
    return await this.request(ORCHESTRATION_RPC_METHODS.dispatchCommand, { command });
  }

  async getTurnDiff(params: unknown): Promise<unknown> {
    return await this.request(ORCHESTRATION_RPC_METHODS.getTurnDiff, params);
  }

  async getFullThreadDiff(params: unknown): Promise<unknown> {
    return await this.request(ORCHESTRATION_RPC_METHODS.getFullThreadDiff, params);
  }

  async *subscribeDomainEvents(input: { afterSequence?: number } = {}): AsyncGenerator<
    OrchestrationEvent,
    void,
    void
  > {
    await this.connect();
    const id = String(this.nextId++);
    const queue: OrchestrationRpcEvent[] = [];
    let done = false;
    let error: Error | null = null;
    let notify: (() => void) | null = null;

    const wait = () =>
      new Promise<void>((resolve) => {
        notify = resolve;
      });

    this.subscriptions.set(id, {
      push: (event) => {
        queue.push(event);
        notify?.();
        notify = null;
      },
      end: () => {
        done = true;
        notify?.();
        notify = null;
      },
      fail: (err) => {
        error = err;
        done = true;
        notify?.();
        notify = null;
      },
    });

    this.supervisor.send(
      JSON.stringify({
        type: "req",
        id,
        method: ORCHESTRATION_RPC_METHODS.subscribe,
        payload: input,
      }),
    );

    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await wait();
          if (error) throw error;
          continue;
        }
        const next = queue.shift();
        if (!next) continue;
        if (next._tag === "domainEvent") {
          yield next.event as OrchestrationEvent;
        }
      }
      if (error) throw error;
    } finally {
      this.subscriptions.delete(id);
    }
  }

  async health(): Promise<unknown> {
    return await this.request(SUBSTRATE_RPC_METHODS.health, {});
  }

  private async request(method: string, payload: unknown): Promise<unknown> {
    await this.connect();
    const id = String(this.nextId++);
    return await new Promise<unknown>((resolve, reject) => {
      const timeout =
        this.requestTimeoutMs > 0
          ? setTimeout(() => {
              this.pending.delete(id);
              reject(new Error(`Request timed out: ${method}`));
            }, this.requestTimeoutMs)
          : null;
      this.pending.set(id, { resolve, reject, timeout });
      try {
        this.supervisor.send(JSON.stringify({ type: "req", id, method, payload }));
      } catch (err) {
        if (timeout) clearTimeout(timeout);
        this.pending.delete(id);
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  }

  private handleMessage(raw: string): void {
    let message: unknown;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    if (!message || typeof message !== "object") return;
    const envelope = message as {
      type?: string;
      id?: string;
      ok?: boolean;
      result?: unknown;
      error?: { message?: string };
      event?: OrchestrationRpcEvent;
    };
    if (typeof envelope.id !== "string") return;

    if (envelope.type === "res") {
      const pending = this.pending.get(envelope.id);
      if (!pending) return;
      this.pending.delete(envelope.id);
      if (pending.timeout) clearTimeout(pending.timeout);
      if (envelope.ok) pending.resolve(envelope.result);
      else pending.reject(new Error(envelope.error?.message ?? "RPC error"));
      return;
    }

    if (envelope.type === "event") {
      const sub = this.subscriptions.get(envelope.id);
      if (sub && envelope.event) sub.push(envelope.event);
      return;
    }

    if (envelope.type === "done") {
      this.subscriptions.get(envelope.id)?.end();
    }
  }
}

export type { OrchestrationDomainEventEnvelope };
