import type {
  ChatEvent,
  ChatSendInput,
  ChatSendResult,
  ChatSubscribeInput,
  HealthResult,
} from "@cozea/contracts";
import { SUBSTRATE_RPC_METHODS, SUBSTRATE_RPC_WS_PATH } from "@cozea/contracts";

import {
  ConnectionSupervisor,
  type ConnectionPhase,
} from "./connectionSupervisor";

export interface SubstrateChatClientOptions {
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
  readonly push: (event: ChatEvent) => void;
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

/**
 * Phase 2 chat client: JSON request/response + streamed subscribe over WS.
 */
export class SubstrateChatClient {
  private readonly supervisor: ConnectionSupervisor;
  private readonly requestTimeoutMs: number;
  private nextId = 1;
  private readonly pending = new Map<string, PendingRequest>();
  private readonly subscriptions = new Map<string, PendingSubscription>();

  constructor(options: SubstrateChatClientOptions) {
    this.requestTimeoutMs = options.requestTimeoutMs ?? 15_000;
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

  getUrl(): string {
    return this.supervisor.getUrl();
  }

  async connect(): Promise<void> {
    await this.supervisor.connect();
  }

  async close(): Promise<void> {
    for (const [id, pending] of this.pending) {
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      pending.reject(new Error("Client closed"));
      this.pending.delete(id);
    }
    for (const [id, sub] of this.subscriptions) {
      sub.fail(new Error("Client closed"));
      this.subscriptions.delete(id);
    }
    await this.supervisor.close();
  }

  async health(): Promise<HealthResult> {
    return (await this.request(SUBSTRATE_RPC_METHODS.health, {})) as HealthResult;
  }

  async send(input: ChatSendInput): Promise<ChatSendResult> {
    return (await this.request(SUBSTRATE_RPC_METHODS.chatSend, input)) as ChatSendResult;
  }

  async *subscribe(input: ChatSubscribeInput): AsyncGenerator<ChatEvent, void, void> {
    await this.connect();
    const id = String(this.nextId++);
    const queue: ChatEvent[] = [];
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
        method: SUBSTRATE_RPC_METHODS.chatSubscribe,
        payload: input,
      }),
    );

    try {
      while (!done || queue.length > 0) {
        if (queue.length === 0) {
          await wait();
          if (error) {
            throw error;
          }
          continue;
        }
        const next = queue.shift();
        if (next) {
          yield next;
        }
      }
      if (error) {
        throw error;
      }
    } finally {
      this.subscriptions.delete(id);
    }
  }

  /** Smoke: connect → health → chat.send → drain chat.subscribe. */
  async smokeRoundtrip(text = "ping"): Promise<{
    readonly health: HealthResult;
    readonly send: ChatSendResult;
    readonly events: ChatEvent[];
  }> {
    await this.connect();
    const health = await this.health();
    const send = await this.send({ text });
    const events: ChatEvent[] = [];
    for await (const event of this.subscribe({ turnId: send.turnId })) {
      events.push(event);
    }
    return { health, send, events };
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
        this.supervisor.send(
          JSON.stringify({
            type: "req",
            id,
            method,
            payload,
          }),
        );
      } catch (error) {
        if (timeout) {
          clearTimeout(timeout);
        }
        this.pending.delete(id);
        reject(error instanceof Error ? error : new Error(String(error)));
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
    if (!message || typeof message !== "object") {
      return;
    }
    const envelope = message as {
      type?: string;
      id?: string;
      ok?: boolean;
      result?: unknown;
      error?: { message?: string };
      event?: ChatEvent;
    };
    if (typeof envelope.id !== "string") {
      return;
    }

    if (envelope.type === "res") {
      const pending = this.pending.get(envelope.id);
      if (!pending) {
        return;
      }
      this.pending.delete(envelope.id);
      if (pending.timeout) {
        clearTimeout(pending.timeout);
      }
      if (envelope.ok) {
        pending.resolve(envelope.result);
      } else {
        pending.reject(new Error(envelope.error?.message ?? "RPC error"));
      }
      return;
    }

    if (envelope.type === "event") {
      const sub = this.subscriptions.get(envelope.id);
      if (sub && envelope.event) {
        sub.push(envelope.event);
      }
      return;
    }

    if (envelope.type === "done") {
      this.subscriptions.get(envelope.id)?.end();
    }
  }
}
