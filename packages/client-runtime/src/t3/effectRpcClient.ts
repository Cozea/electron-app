function createRequestId(): string {
  return globalThis.crypto.randomUUID();
}

export interface T3EffectRpcClientOptions {
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

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

/** Minimal Effect RPC wire client for upstream T3 apps/server WebSocket. */
export class T3EffectRpcClient {
  private readonly wsUrl: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly requestTimeoutMs: number;
  private ws: WebSocket | null = null;
  private connectPromise: Promise<WebSocket> | null = null;
  private readonly exitWaiters = new Map<
    string,
    { resolve: (value: unknown) => void; reject: (error: Error) => void; timer: ReturnType<typeof setTimeout> }
  >();
  private readonly chunkListeners = new Map<string, Set<(value: unknown) => void>>();
  private readonly streamDisconnectListeners = new Map<string, () => void>();

  constructor(options: T3EffectRpcClientOptions) {
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
    if (this.ws && this.ws.readyState === this.WebSocketImpl.OPEN) {
      return this.ws;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = new Promise<WebSocket>((resolve, reject) => {
      const ws = new this.WebSocketImpl(this.wsUrl);
      const timer = setTimeout(() => {
        ws.close();
        reject(new Error(`T3 WebSocket connect timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);

      ws.addEventListener("open", () => {
        clearTimeout(timer);
        this.ws = ws;
        resolve(ws);
      });
      ws.addEventListener("error", () => {
        clearTimeout(timer);
        reject(new Error("T3 WebSocket connection error"));
      });
      ws.addEventListener("message", (event) => {
        this.handleMessage(event.data);
      });
      ws.addEventListener("close", () => {
        this.ws = null;
        this.connectPromise = null;
        const disconnectListeners = [...this.streamDisconnectListeners.values()];
        this.streamDisconnectListeners.clear();
        this.chunkListeners.clear();
        for (const listener of disconnectListeners) {
          listener();
        }
      });
    });

    try {
      return await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  private handleMessage(raw: unknown): void {
    let parsed: unknown;
    try {
      parsed = JSON.parse(String(raw));
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
        this.chunkListeners.delete(requestId);
        const onDisconnect = this.streamDisconnectListeners.get(requestId);
        this.streamDisconnectListeners.delete(requestId);
        onDisconnect?.();
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
      const requestId = String(message.requestId);
      const listeners = this.chunkListeners.get(requestId);
      if (!listeners) {
        return;
      }

      try {
        for (const value of message.values) {
          for (const listener of listeners) {
            listener(value);
          }
        }
      } finally {
        // Effect RPC applies backpressure to streams until the client confirms
        // that it consumed the preceding chunk. Without this frame a stream
        // delivers its initial snapshot and then stalls indefinitely.
        if (this.ws?.readyState === this.WebSocketImpl.OPEN) {
          this.ws.send(JSON.stringify({ _tag: "Ack", requestId }));
        }
      }
    }
  }

  async callUnary(tag: string, payload: unknown = {}): Promise<unknown> {
    const ws = await this.connect();
    const requestId = createRequestId();
    return await new Promise<unknown>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.exitWaiters.delete(requestId);
        reject(new Error(`T3 RPC ${tag} timed out after ${this.requestTimeoutMs}ms`));
      }, this.requestTimeoutMs);
      this.exitWaiters.set(requestId, { resolve, reject, timer });
      ws.send(JSON.stringify({ _tag: "Request", id: requestId, tag, payload, headers: [] }));
    });
  }

  async openStream(
    tag: string,
    payload: unknown,
    onValue: (value: unknown) => void,
    onDisconnect?: () => void,
  ): Promise<() => Promise<void>> {
    const ws = await this.connect();
    const requestId = createRequestId();
    const listeners = new Set<(value: unknown) => void>([onValue]);
    this.chunkListeners.set(requestId, listeners);
    if (onDisconnect) {
      this.streamDisconnectListeners.set(requestId, onDisconnect);
    }
    ws.send(JSON.stringify({ _tag: "Request", id: requestId, tag, payload, headers: [] }));

    return async () => {
      this.chunkListeners.delete(requestId);
      this.streamDisconnectListeners.delete(requestId);
      if (ws.readyState === this.WebSocketImpl.OPEN) {
        ws.send(JSON.stringify({ _tag: "Interrupt", requestId }));
      }
    };
  }
}
