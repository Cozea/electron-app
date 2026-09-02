import type { CozeaDevAppViewBridge, DevAppViewWorkerConnection } from "./shared/devAppViewBridge";
import type {
  DevAppWorkerError,
  DevAppWorkerEvent,
  DevAppWorkerMessage,
  DevAppWorkerRequest,
  DevAppWorkerResponse,
} from "./shared/devAppWorkerProtocol";

export type {
  DevAppPackage,
  DevAppPackageServiceSpec,
  DevAppPackageViewSpec,
  DevAppPackageWorkerSpec,
} from "./shared/devAppPackage";
export type { DevAppCapability, DevAppGrant } from "./shared/devAppCapabilities";

export interface DevAppMethodDefinition<Params = unknown, Result = unknown> {
  params: Params;
  result: Result;
}

export type DevAppMethodMap = Record<string, DevAppMethodDefinition>;

export interface DevAppClientOptions {
  bridge?: CozeaDevAppViewBridge;
  requestTimeoutMs?: number;
}

export class DevAppRequestError extends Error {
  readonly code: DevAppWorkerError["code"];
  readonly requiredCapability?: DevAppWorkerError["requiredCapability"];

  constructor(error: DevAppWorkerError) {
    super(error.message);
    this.name = "DevAppRequestError";
    this.code = error.code;
    this.requiredCapability = error.requiredCapability;
  }
}

export interface DevAppClient<
  Methods extends { [Method in keyof Methods]: DevAppMethodDefinition },
> {
  connect: () => Promise<void>;
  disconnect: () => void;
  request: <Method extends Extract<keyof Methods, string>>(
    method: Method,
    params: Methods[Method]["params"],
  ) => Promise<Methods[Method]["result"]>;
  on: (topic: string, listener: (payload: unknown) => void) => () => void;
}

export type DevAppWorkerMethodHandler<Params = unknown, Result = unknown> = (
  params: Params,
) => Result | Promise<Result>;

export type DevAppWorkerHandlers<
  Methods extends { [Method in keyof Methods]: DevAppMethodDefinition },
> = {
  [Method in keyof Methods]: DevAppWorkerMethodHandler<
    Methods[Method]["params"],
    Methods[Method]["result"]
  >;
};

export interface DevAppWorkerController {
  requestHost: <Result = unknown>(method: string, params?: unknown) => Promise<Result>;
  emit: (topic: string, payload?: unknown) => void;
  close: () => void;
}

interface WorkerRuntimeTransport {
  onHostMessage(listener: (message: unknown) => void): () => void;
  onViewMessage(
    listener: (connectionId: string, message: unknown, close: boolean) => void,
  ): () => void;
  sendHost(message: unknown): void;
  sendView(connectionId: string, message: unknown): void;
}

interface PortableMessagePort {
  postMessage(message: unknown): void;
  start?(): void;
  close?(): void;
  on?(event: "message" | "close", listener: (event: { data?: unknown }) => void): void;
  addEventListener?(
    event: "message" | "close",
    listener: (event: { data?: unknown }) => void,
  ): void;
}

function listenPort(
  port: PortableMessagePort,
  listener: (message: unknown) => void,
  onClose?: () => void,
): void {
  if (port.addEventListener) {
    port.addEventListener("message", (event) => listener(event.data));
    if (onClose) port.addEventListener("close", onClose);
  } else if (port.on) {
    port.on("message", (event) => listener(event.data));
    if (onClose) port.on("close", onClose);
  }
  port.start?.();
}

function utilityProcessTransport(): WorkerRuntimeTransport | null {
  const processLike = (globalThis as typeof globalThis & {
    process?: {
      parentPort?: {
        on(
          event: "message",
          listener: (event: { data?: unknown; ports?: PortableMessagePort[] }) => void,
        ): void;
      };
    };
  }).process;
  const parent = processLike?.parentPort;
  if (!parent) return null;
  const hostListeners = new Set<(message: unknown) => void>();
  const viewListeners = new Set<(connectionId: string, message: unknown, close: boolean) => void>();
  const views = new Map<string, PortableMessagePort>();
  let host: PortableMessagePort | null = null;
  parent.on("message", (event) => {
    const bootstrap = event.data as { kind?: unknown; connectionId?: unknown };
    const port = event.ports?.[0];
    if (!port) return;
    if (bootstrap?.kind === "cozea-devapp-port") {
      host?.close?.();
      host = port;
      listenPort(port, (message) => {
        for (const listener of hostListeners) listener(message);
      });
      return;
    }
    if (
      bootstrap?.kind === "cozea-devapp-view-port" &&
      typeof bootstrap.connectionId === "string"
    ) {
      views.get(bootstrap.connectionId)?.close?.();
      views.set(bootstrap.connectionId, port);
      listenPort(
        port,
        (message) => {
          for (const listener of viewListeners) {
            listener(bootstrap.connectionId as string, message, false);
          }
        },
        () => {
          views.delete(bootstrap.connectionId as string);
          for (const listener of viewListeners) {
            listener(bootstrap.connectionId as string, undefined, true);
          }
        },
      );
    }
  });
  return {
    onHostMessage: (listener) => {
      hostListeners.add(listener);
      return () => hostListeners.delete(listener);
    },
    onViewMessage: (listener) => {
      viewListeners.add(listener);
      return () => viewListeners.delete(listener);
    },
    sendHost: (message) => {
      if (!host) throw new Error("The Cozea host channel is unavailable.");
      host.postMessage(message);
    },
    sendView: (connectionId, message) => {
      const port = views.get(connectionId);
      if (!port) throw new Error("The DevApp view channel is unavailable.");
      port.postMessage(message);
    },
  };
}

function defaultWorkerTransport(): WorkerRuntimeTransport {
  const existing = (globalThis as typeof globalThis & {
    __cozeaDevAppWorkerTransport?: WorkerRuntimeTransport;
  }).__cozeaDevAppWorkerTransport;
  const transport = existing ?? utilityProcessTransport();
  if (!transport) throw new Error("This worker is not running inside Cozea.");
  return transport;
}

/**
 * Starts one transport-neutral worker implementation.
 *
 * The same package code runs in the powerful local development utility process and the
 * published Linux container. Only the transport adapter changes; host capability decisions
 * remain in Cozea main.
 */
export function createDevAppWorker<
  Methods extends { [Method in keyof Methods]: DevAppMethodDefinition },
>(
  handlers: DevAppWorkerHandlers<Methods>,
  options: { transport?: WorkerRuntimeTransport; requestTimeoutMs?: number } = {},
): DevAppWorkerController {
  const transport = options.transport ?? defaultWorkerTransport();
  const timeoutMs = Math.max(250, Math.min(options.requestTimeoutMs ?? 30_000, 60_000));
  const pending = new Map<string, PendingRequest>();
  const protocolVersion = 1;

  const dispatch = async (
    raw: unknown,
    respond: (message: DevAppWorkerMessage) => void,
  ): Promise<void> => {
    if (!raw || typeof raw !== "object") return;
    const message = raw as DevAppWorkerMessage;
    if (message.protocolVersion !== protocolVersion) return;
    if (message.kind === "response") {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new DevAppRequestError(message.error));
      else request.resolve(message.result);
      return;
    }
    if (message.kind !== "request" || typeof message.method !== "string") return;
    const handler = handlers[message.method as keyof Methods] as
      | DevAppWorkerMethodHandler
      | undefined;
    if (!handler) {
      respond({
        kind: "response",
        protocolVersion,
        id: message.id,
        error: { code: "unknown-method", message: `${message.method} is not implemented.` },
      });
      return;
    }
    try {
      const result = await handler(message.params);
      respond({ kind: "response", protocolVersion, id: message.id, result: result ?? null });
    } catch {
      respond({
        kind: "response",
        protocolVersion,
        id: message.id,
        error: { code: "internal-error", message: "The DevApp operation failed." },
      });
    }
  };
  const removeHost = transport.onHostMessage((message) => {
    void dispatch(message, (response) => transport.sendHost(response));
  });
  const removeView = transport.onViewMessage((connectionId, message, close) => {
    if (!close) void dispatch(message, (response) => transport.sendView(connectionId, response));
  });

  return {
    requestHost: async <Result>(method: string, params?: unknown): Promise<Result> => {
      const id = globalThis.crypto.randomUUID();
      const request: DevAppWorkerRequest = { kind: "request", protocolVersion, id, method, params };
      return await new Promise<Result>((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevApp host request ${method} timed out.`));
        }, timeoutMs);
        pending.set(id, { resolve: resolve as (value: unknown) => void, reject, timer });
        transport.sendHost(request);
      });
    },
    emit: (topic, payload) => {
      const event: DevAppWorkerEvent = { kind: "event", protocolVersion, topic, payload };
      transport.sendHost(event);
    },
    close: () => {
      removeHost();
      removeView();
      for (const request of pending.values()) {
        clearTimeout(request.timer);
        request.reject(new Error("The DevApp worker closed."));
      }
      pending.clear();
    },
  };
}

interface PendingRequest {
  resolve: (value: unknown) => void;
  reject: (reason: Error) => void;
  timer: ReturnType<typeof setTimeout>;
}

function defaultBridge(): CozeaDevAppViewBridge {
  const bridge = (globalThis as typeof globalThis & { cozeaDevApp?: CozeaDevAppViewBridge })
    .cozeaDevApp;
  if (!bridge) {
    throw new Error("This view is not running inside a Cozea DevApp preview.");
  }
  return bridge;
}

function isResponse(message: DevAppWorkerMessage): message is DevAppWorkerResponse {
  return message.kind === "response";
}

function isEvent(message: DevAppWorkerMessage): message is DevAppWorkerEvent {
  return message.kind === "event";
}

/**
 * Creates the typed view-side client for a package's private view/worker protocol.
 * The generic map belongs to the package author; Cozea supplies transport, correlation,
 * bounded timeouts, and structured host errors.
 */
export function createDevAppClient<
  Methods extends { [Method in keyof Methods]: DevAppMethodDefinition },
>(options: DevAppClientOptions = {}): DevAppClient<Methods> {
  const bridge = options.bridge ?? defaultBridge();
  const requestTimeoutMs = Math.max(250, Math.min(options.requestTimeoutMs ?? 10_000, 60_000));
  const pending = new Map<string, PendingRequest>();
  const eventListeners = new Map<string, Set<(payload: unknown) => void>>();
  let connection: DevAppViewWorkerConnection | null = null;
  let unsubscribeFromConnections: (() => void) | null = null;

  const rejectPending = (message: string) => {
    for (const request of pending.values()) {
      clearTimeout(request.timer);
      request.reject(new Error(message));
    }
    pending.clear();
  };

  const handleMessage = (event: MessageEvent<DevAppWorkerMessage>) => {
    const message = event.data;
    if (!message || typeof message !== "object") return;
    if (isResponse(message)) {
      const request = pending.get(message.id);
      if (!request) return;
      pending.delete(message.id);
      clearTimeout(request.timer);
      if (message.error) request.reject(new DevAppRequestError(message.error));
      else request.resolve(message.result);
      return;
    }
    if (isEvent(message)) {
      for (const listener of eventListeners.get(message.topic) ?? []) listener(message.payload);
    }
  };

  const installConnection = (next: DevAppViewWorkerConnection) => {
    if (connection?.bootstrap.connectionId === next.bootstrap.connectionId) return;
    if (connection) {
      connection.port.removeEventListener("message", handleMessage);
      connection.port.close();
      rejectPending("The DevApp worker connection was replaced.");
    }
    connection = next;
    connection.port.addEventListener("message", handleMessage);
    connection.port.start();
  };

  const observeConnections = () => {
    if (unsubscribeFromConnections) return;
    unsubscribeFromConnections = bridge.onWorkerConnection(installConnection);
  };

  const connect = async () => {
    observeConnections();
    const advertised = bridge.currentWorker();
    if (connection && advertised?.bootstrap.connectionId === connection.bootstrap.connectionId)
      return;
    if (advertised) {
      installConnection(advertised);
      return;
    }
    if (connection) {
      connection.port.removeEventListener("message", handleMessage);
      connection.port.close();
      connection = null;
      rejectPending("The DevApp worker connection was revoked.");
    }
    installConnection(await bridge.connectWorker({ timeoutMs: requestTimeoutMs }));
  };

  const disconnect = () => {
    unsubscribeFromConnections?.();
    unsubscribeFromConnections = null;
    if (connection) {
      connection.port.removeEventListener("message", handleMessage);
      connection.port.close();
      connection = null;
    }
    rejectPending("The DevApp worker connection closed.");
  };

  return {
    connect,
    disconnect,
    request: async (method, params) => {
      await connect();
      const active = connection;
      if (!active) throw new Error("The DevApp worker is unavailable.");
      const id = globalThis.crypto.randomUUID();
      const request: DevAppWorkerRequest = {
        kind: "request",
        protocolVersion: active.bootstrap.protocolVersion,
        id,
        method,
        params,
      };
      return (await new Promise((resolve, reject) => {
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new Error(`DevApp request ${method} timed out.`));
        }, requestTimeoutMs);
        pending.set(id, { resolve, reject, timer });
        active.port.postMessage(request);
      })) as Methods[typeof method]["result"];
    },
    on: (topic, listener) => {
      const listeners = eventListeners.get(topic) ?? new Set<(payload: unknown) => void>();
      listeners.add(listener);
      eventListeners.set(topic, listeners);
      return () => {
        listeners.delete(listener);
        if (listeners.size === 0) eventListeners.delete(topic);
      };
    },
  };
}
