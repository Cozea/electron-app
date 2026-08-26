export type ConnectionPhase =
  | "idle"
  | "connecting"
  | "ready"
  | "reconnecting"
  | "error"
  | "closed";

export interface ConnectionSupervisorOptions {
  readonly url: string;
  readonly WebSocketImpl?: typeof WebSocket;
  readonly reconnectDelaysMs?: readonly number[];
  readonly onPhaseChange?: (phase: ConnectionPhase, detail?: string) => void;
  readonly onMessage?: (data: string) => void;
}

/**
 * Lite connection supervisor for the Phase 2 substrate RPC WebSocket.
 * Mirrors the T3 client-runtime reconnect shape without the full Effect stack.
 */
export class ConnectionSupervisor {
  private readonly url: string;
  private readonly WebSocketImpl: typeof WebSocket;
  private readonly reconnectDelaysMs: readonly number[];
  private readonly onPhaseChange?: (phase: ConnectionPhase, detail?: string) => void;
  private readonly onMessage?: (data: string) => void;

  private socket: WebSocket | null = null;
  private phase: ConnectionPhase = "idle";
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private disposed = false;
  private readyPromise: Promise<void> | null = null;
  private readyResolve: (() => void) | null = null;
  private readyReject: ((error: Error) => void) | null = null;

  constructor(options: ConnectionSupervisorOptions) {
    this.url = options.url;
    this.WebSocketImpl = options.WebSocketImpl ?? WebSocket;
    this.reconnectDelaysMs = options.reconnectDelaysMs ?? [250, 500, 1_000, 2_000, 4_000];
    this.onPhaseChange = options.onPhaseChange;
    this.onMessage = options.onMessage;
  }

  getPhase(): ConnectionPhase {
    return this.phase;
  }

  getUrl(): string {
    return this.url;
  }

  async connect(): Promise<void> {
    if (this.disposed) {
      throw new Error("ConnectionSupervisor is disposed");
    }
    if (this.phase === "ready" && this.socket?.readyState === this.WebSocketImpl.OPEN) {
      return;
    }
    if (this.readyPromise) {
      return this.readyPromise;
    }

    this.readyPromise = new Promise<void>((resolve, reject) => {
      this.readyResolve = resolve;
      this.readyReject = reject;
    });
    this.openSocket();
    return this.readyPromise;
  }

  send(data: string): void {
    if (!this.socket || this.socket.readyState !== this.WebSocketImpl.OPEN) {
      throw new Error(`Cannot send while connection is ${this.phase}`);
    }
    this.socket.send(data);
  }

  async close(): Promise<void> {
    this.disposed = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    const socket = this.socket;
    this.socket = null;
    this.setPhase("closed");
    if (socket && socket.readyState === this.WebSocketImpl.OPEN) {
      socket.close();
    }
    this.failReady(new Error("Connection closed"));
  }

  private openSocket(): void {
    if (this.disposed) {
      return;
    }
    this.setPhase(this.reconnectAttempt > 0 ? "reconnecting" : "connecting");
    const socket = new this.WebSocketImpl(this.url);
    this.socket = socket;

    socket.addEventListener("open", () => {
      if (this.socket !== socket || this.disposed) {
        return;
      }
      this.reconnectAttempt = 0;
      this.setPhase("ready");
      this.readyResolve?.();
      this.readyResolve = null;
      this.readyReject = null;
      this.readyPromise = null;
    });

    socket.addEventListener("message", (event) => {
      if (this.socket !== socket) {
        return;
      }
      const data = typeof event.data === "string" ? event.data : String(event.data);
      this.onMessage?.(data);
    });

    socket.addEventListener("error", () => {
      if (this.socket !== socket) {
        return;
      }
      this.setPhase("error", "websocket error");
    });

    socket.addEventListener("close", () => {
      if (this.socket !== socket) {
        return;
      }
      this.socket = null;
      if (this.disposed) {
        this.setPhase("closed");
        return;
      }
      this.failReady(new Error("WebSocket closed before ready"));
      this.scheduleReconnect();
    });
  }

  private scheduleReconnect(): void {
    if (this.disposed) {
      return;
    }
    const delay =
      this.reconnectDelaysMs[
        Math.min(this.reconnectAttempt, this.reconnectDelaysMs.length - 1)
      ] ?? 4_000;
    this.reconnectAttempt += 1;
    this.setPhase("reconnecting", `retry in ${delay}ms`);
    this.reconnectTimer = setTimeout(() => {
      this.reconnectTimer = null;
      this.readyPromise = new Promise<void>((resolve, reject) => {
        this.readyResolve = resolve;
        this.readyReject = reject;
      });
      this.openSocket();
    }, delay);
  }

  private failReady(error: Error): void {
    this.readyReject?.(error);
    this.readyResolve = null;
    this.readyReject = null;
    this.readyPromise = null;
  }

  private setPhase(phase: ConnectionPhase, detail?: string): void {
    this.phase = phase;
    this.onPhaseChange?.(phase, detail);
  }
}
