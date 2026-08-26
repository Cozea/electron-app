import { randomUUID } from "node:crypto";

import WebSocket from "ws";

export interface T3RpcClientOptions {
  readonly baseUrl: string;
  readonly wsTicket: string;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly requestTimeoutMs?: number;
}

interface RpcExitSuccess {
  readonly _tag: "Exit";
  readonly requestId: string | number;
  readonly exit: { readonly _tag: "Success"; readonly value: unknown };
}

interface RpcExitFailure {
  readonly _tag: "Exit";
  readonly requestId: string | number;
  readonly exit: { readonly _tag: "Failure"; readonly cause: unknown };
}

interface RpcChunk {
  readonly _tag: "Chunk";
  readonly requestId: string | number;
  readonly values: ReadonlyArray<unknown>;
}

type RpcInbound = RpcExitSuccess | RpcExitFailure | RpcChunk;

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

export class T3EffectRpcClient {
  private readonly wsUrl: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly requestTimeoutMs: number;
  private ws: WebSocket | null = null;
  private connectPromise: Promise<WebSocket> | null = null;
  private readonly exitWaiters = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: NodeJS.Timeout }
  >();
  private readonly chunkListeners = new Map<string, Set<(value: unknown) => void>>();

  constructor(options: T3RpcClientOptions) {
    const url = new URL("/ws", options.baseUrl);
    url.searchParams.set("wsTicket", options.wsTicket);
    url.searchParams.set("clientSurface", "web");
    this.wsUrl = url.toString();
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 60_000;
  }

  async close(): Promise<void> {
    this.connectPromise = null;
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
    for (const waiter of this.exitWaiters.values()) {
      clearTimeout(waiter.timer);
      waiter.reject(new Error("T3 RPC client closed"));
    }
    this.exitWaiters.clear();
    this.chunkListeners.clear();
  }

  private async connect(): Promise<WebSocket> {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      return this.ws;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.wsUrl, { perMessageDeflate: true });
      const timer = setTimeout(() => {
        ws.terminate();
        reject(new Error(`T3 WebSocket connect timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      ws.on("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve(ws);
      });
      ws.on("error", (error) => {
        clearTimeout(timer);
        reject(error instanceof Error ? error : new Error(String(error)));
      });
      ws.on("message", (raw) => {
        this.handleMessage(raw);
      });
      ws.on("close", () => {
        this.ws = null;
        this.connectPromise = null;
      });
    });

    try {
      return await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  private handleMessage(raw: WebSocket.RawData): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw.toString());
    } catch {
      return;
    }
    const record = asRecord(parsed);
    if (!record || typeof record._tag !== "string") {
      return;
    }

    if (record._tag === "Exit") {
      const message = parsed as RpcExitSuccess | RpcExitFailure;
      const requestId = String(message.requestId);
      const waiter = this.exitWaiters.get(requestId);
      if (!waiter) {
        return;
      }
      clearTimeout(waiter.timer);
      this.exitWaiters.delete(requestId);
      if (message.exit._tag === "Success") {
        waiter.resolve(message.exit.value);
      } else {
        waiter.reject(new Error(`T3 RPC failed: ${JSON.stringify(message.exit.cause).slice(0, 400)}`));
      }
      return;
    }

    if (record._tag === "Chunk") {
      const message = parsed as RpcChunk;
      const listeners = this.chunkListeners.get(String(message.requestId));
      if (!listeners) {
        return;
      }
      for (const value of message.values) {
        for (const listener of listeners) {
          listener(value);
        }
      }
    }
  }

  async callUnary(tag: string, payload: unknown = {}): Promise<unknown> {
    const ws = await this.connect();
    const requestId = randomUUID();
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.exitWaiters.delete(requestId);
        reject(new Error(`T3 RPC ${tag} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.exitWaiters.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ _tag: "Request", id: requestId, tag, payload, headers: [] }));
    });
  }

  async callStream(
    tag: string,
    payload: unknown,
    onValue: (value: unknown) => void,
  ): Promise<void> {
    const ws = await this.connect();
    const requestId = randomUUID();
    const listeners = new Set<(value: unknown) => void>([onValue]);
    this.chunkListeners.set(requestId, listeners);

    await new Promise<void>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.exitWaiters.delete(requestId);
        this.chunkListeners.delete(requestId);
        reject(new Error(`T3 RPC stream ${tag} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.exitWaiters.set(requestId, {
        resolve: () => resolve(),
        reject,
        timer,
      });
      ws.send(JSON.stringify({ _tag: "Request", id: requestId, tag, payload, headers: [] }));
    });

    this.chunkListeners.delete(requestId);
  }

  async openStream(
    tag: string,
    payload: unknown,
    onValue: (value: unknown) => void,
  ): Promise<() => Promise<void>> {
    const ws = await this.connect();
    const requestId = randomUUID();
    const listeners = new Set<(value: unknown) => void>([onValue]);
    this.chunkListeners.set(requestId, listeners);
    ws.send(JSON.stringify({ _tag: "Request", id: requestId, tag, payload, headers: [] }));

    return async () => {
      this.chunkListeners.delete(requestId);
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ _tag: "Interrupt", id: requestId }));
      }
    };
  }
}
