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
