/**
 * @deprecated Legacy :3773 WebSocket orchestration bridge. Production paths require
 * the vendored T3 server backend (`T3OrchestrationRpcProxy`). Kept for unit tests.
 */
import { randomUUID } from "node:crypto";

import {
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  type OrchestrationEvent,
  type WsPush,
  WS_CHANNELS,
} from "@cozea/assistant-contracts";
import WebSocket from "ws";

const DEFAULT_ASSISTANT_WS_URL = "ws://127.0.0.1:3773";
const DEFAULT_REQUEST_TIMEOUT_MS = 60_000;

export interface OrchestrationRpcProxyOptions {
  readonly assistantWsUrl?: string;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly requestTimeoutMs?: number;
}

interface WebSocketResponse {
  readonly id: string;
  readonly result?: unknown;
  readonly error?: { readonly message?: string };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  return value as Record<string, unknown>;
}

function isPushEnvelope(message: unknown): message is WsPush {
  return (
    typeof message === "object" &&
    message !== null &&
    "type" in message &&
    (message as { type?: unknown }).type === "push"
  );
}

function asWebSocketResponse(message: unknown): WebSocketResponse | null {
  if (typeof message !== "object" || message === null || !("id" in message)) {
    return null;
  }
  const id = (message as { id?: unknown }).id;
  return typeof id === "string" ? (message as WebSocketResponse) : null;
}

class OrchestrationWsSession {
  private readonly ws: WebSocket;
  private readonly pushQueue: WsPush[] = [];
  private readonly responseQueue: WebSocketResponse[] = [];
  private readonly pushWaiters: Array<(value: WsPush) => void> = [];
  private readonly responseWaiters: Array<(value: WebSocketResponse) => void> = [];
  private readonly domainEventListeners = new Set<(event: OrchestrationEvent) => void>();
  private welcomeReceived = false;

  constructor(ws: WebSocket) {
    this.ws = ws;
    ws.on("message", (raw) => {
      let parsed: unknown;
      try {
        parsed = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (isPushEnvelope(parsed)) {
        if (parsed.channel === ORCHESTRATION_WS_CHANNELS.domainEvent) {
          const event = parsed.data as OrchestrationEvent;
          for (const listener of this.domainEventListeners) {
            listener(event);
          }
        }
        const waiter = this.pushWaiters.shift();
        if (waiter) {
          waiter(parsed);
        } else {
          this.pushQueue.push(parsed);
        }
        return;
      }
      const response = asWebSocketResponse(parsed);
      if (!response) {
        return;
      }
      const responseWaiter = this.responseWaiters.shift();
      if (responseWaiter) {
        responseWaiter(response);
      } else {
        this.responseQueue.push(response);
      }
    });
  }

  close(): void {
    if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
      this.ws.close();
    }
  }

  onDomainEvent(listener: (event: OrchestrationEvent) => void): () => void {
    this.domainEventListeners.add(listener);
    return () => {
      this.domainEventListeners.delete(listener);
    };
  }

  private dequeuePush(timeoutMs: number): Promise<WsPush> {
    const queued = this.pushQueue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.pushWaiters.indexOf(resolve);
        if (index >= 0) {
          this.pushWaiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for assistant push after ${timeoutMs}ms`));
      }, timeoutMs);
      this.pushWaiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  private dequeueResponse(timeoutMs: number): Promise<WebSocketResponse> {
    const queued = this.responseQueue.shift();
    if (queued) {
      return Promise.resolve(queued);
    }
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        const index = this.responseWaiters.indexOf(resolve);
        if (index >= 0) {
          this.responseWaiters.splice(index, 1);
        }
        reject(new Error(`Timed out waiting for assistant response after ${timeoutMs}ms`));
      }, timeoutMs);
      this.responseWaiters.push((value) => {
        clearTimeout(timer);
        resolve(value);
      });
    });
  }

  async waitForWelcome(timeoutMs: number): Promise<Record<string, unknown>> {
    if (this.welcomeReceived) {
      return {};
    }
    const push = await this.dequeuePush(timeoutMs);
    if (push.channel !== WS_CHANNELS.serverWelcome) {
      throw new Error(`Expected ${WS_CHANNELS.serverWelcome}, got ${push.channel}`);
    }
    this.welcomeReceived = true;
    return asRecord(push.data) ?? {};
  }

  async sendRequest(method: string, params: unknown, timeoutMs: number): Promise<WebSocketResponse> {
    const id = randomUUID();
    const body =
      method === ORCHESTRATION_WS_METHODS.dispatchCommand
        ? { _tag: method, command: params }
        : { _tag: method, ...(asRecord(params) ?? {}) };
    this.ws.send(JSON.stringify({ id, body }));

    while (true) {
      const response = await this.dequeueResponse(timeoutMs);
      if (response.id === id || response.id === "unknown") {
        return response;
      }
    }
  }
}

/**
 * Persistent assistant-runtime WebSocket proxy for substrate RPC orchestration.
 * Replaces per-turn `assistantWsBridge` with a reusable session.
 */
export class OrchestrationRpcProxy {
  private session: OrchestrationWsSession | null = null;
  private connectPromise: Promise<OrchestrationWsSession> | null = null;
  private readonly assistantWsUrl: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly requestTimeoutMs: number;

  constructor(options: OrchestrationRpcProxyOptions = {}) {
    this.assistantWsUrl =
      options.assistantWsUrl?.trim() ||
      process.env.COZEA_ASSISTANT_RUNTIME_WS_URL?.trim() ||
      DEFAULT_ASSISTANT_WS_URL;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    this.requestTimeoutMs = options.requestTimeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;
  }

  async connect(): Promise<OrchestrationWsSession> {
    if (this.session) {
      return this.session;
    }
    if (this.connectPromise) {
      return this.connectPromise;
    }

    this.connectPromise = (async () => {
      const token = process.env.COZEA_ASSISTANT_RUNTIME_TOKEN?.trim();
      const url = token
        ? `${this.assistantWsUrl}${this.assistantWsUrl.includes("?") ? "&" : "?"}token=${encodeURIComponent(token)}`
        : this.assistantWsUrl;

      const ws = await new Promise<WebSocket>((resolve, reject) => {
        const socket = new this.WebSocketImpl(url);
        const timer = setTimeout(() => {
          socket.close();
          reject(new Error(`Assistant WebSocket connect timed out after ${this.requestTimeoutMs}ms`));
        }, this.requestTimeoutMs);
        socket.once("open", () => {
          clearTimeout(timer);
          resolve(socket);
        });
        socket.once("error", (error) => {
          clearTimeout(timer);
          reject(error instanceof Error ? error : new Error(String(error)));
        });
      });

      const session = new OrchestrationWsSession(ws);
      await session.waitForWelcome(this.requestTimeoutMs);
      this.session = session;
      return session;
    })();

    try {
      return await this.connectPromise;
    } catch (error) {
      this.connectPromise = null;
      throw error;
    }
  }

  async close(): Promise<void> {
    this.session?.close();
    this.session = null;
    this.connectPromise = null;
  }

  async getSnapshot(): Promise<unknown> {
    const session = await this.connect();
    const response = await session.sendRequest(
      ORCHESTRATION_WS_METHODS.getSnapshot,
      {},
      this.requestTimeoutMs,
    );
    if (response.error) {
      throw new Error(response.error.message ?? "orchestration.getSnapshot failed");
    }
    return response.result;
  }

  async dispatchCommand(command: unknown): Promise<unknown> {
    const session = await this.connect();
    const response = await session.sendRequest(
      ORCHESTRATION_WS_METHODS.dispatchCommand,
      command,
      this.requestTimeoutMs,
    );
    if (response.error) {
      throw new Error(response.error.message ?? "orchestration.dispatchCommand failed");
    }
    return response.result;
  }

  async getTurnDiff(params: unknown): Promise<unknown> {
    const session = await this.connect();
    const response = await session.sendRequest(
      ORCHESTRATION_WS_METHODS.getTurnDiff,
      params,
      this.requestTimeoutMs,
    );
    if (response.error) {
      throw new Error(response.error.message ?? "orchestration.getTurnDiff failed");
    }
    return response.result;
  }

  async getFullThreadDiff(params: unknown): Promise<unknown> {
    const session = await this.connect();
    const response = await session.sendRequest(
      ORCHESTRATION_WS_METHODS.getFullThreadDiff,
      params,
      this.requestTimeoutMs,
    );
    if (response.error) {
      throw new Error(response.error.message ?? "orchestration.getFullThreadDiff failed");
    }
    return response.result;
  }

  async replayEvents(params: unknown): Promise<unknown> {
    const session = await this.connect();
    const response = await session.sendRequest(
      ORCHESTRATION_WS_METHODS.replayEvents,
      params,
      this.requestTimeoutMs,
    );
    if (response.error) {
      throw new Error(response.error.message ?? "orchestration.replayEvents failed");
    }
    return response.result;
  }

  async subscribeDomainEvents(
    listener: (event: OrchestrationEvent) => void,
  ): Promise<() => void> {
    const session = await this.connect();
    return session.onDomainEvent(listener);
  }
}

let sharedProxy: OrchestrationRpcProxy | null = null;

export function getSharedOrchestrationRpcProxy(
  options?: OrchestrationRpcProxyOptions,
): OrchestrationRpcProxy {
  if (!sharedProxy) {
    sharedProxy = new OrchestrationRpcProxy(options);
  }
  return sharedProxy;
}

export function resetSharedOrchestrationRpcProxyForTests(): void {
  void sharedProxy?.close();
  sharedProxy = null;
}
