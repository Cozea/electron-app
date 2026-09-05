import { describe, expect, it, vi } from "vitest";

import {
  T3EffectRpcClient,
  T3OrchestrationClient,
  T3ServerConfigClient,
} from "@cozea/client-runtime";

type SocketEventType = "open" | "error" | "message" | "close";
type SocketListener = (event: { readonly data?: unknown }) => void;

class FakeWebSocket {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  static instances: FakeWebSocket[] = [];

  readonly sent: string[] = [];
  readyState = FakeWebSocket.CONNECTING;
  private readonly listeners = new Map<SocketEventType, SocketListener[]>();

  constructor(readonly url: string) {
    FakeWebSocket.instances.push(this);
    queueMicrotask(() => {
      this.readyState = FakeWebSocket.OPEN;
      this.emit("open", {});
    });
  }

  addEventListener(type: SocketEventType, listener: SocketListener): void {
    const listeners = this.listeners.get(type) ?? [];
    listeners.push(listener);
    this.listeners.set(type, listeners);
  }

  send(data: string): void {
    this.sent.push(data);
  }

  close(): void {
    this.readyState = FakeWebSocket.CLOSED;
    this.emit("close", {});
  }

  receive(message: unknown): void {
    this.emit("message", { data: JSON.stringify(message) });
  }

  private emit(type: SocketEventType, event: { readonly data?: unknown }): void {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event);
    }
  }
}

describe("T3EffectRpcClient stream protocol", () => {
  it("allows a slow provider update while ordinary requests retain their deadline", async () => {
    vi.useFakeTimers();
    FakeWebSocket.instances = [];
    const rpc = new T3EffectRpcClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const config = new T3ServerConfigClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
      client: rpc,
    });
    try {
      let updateSettled = false;
      const update = config.updateProvider("codex").then(
        (value) => {
          updateSettled = true;
          return { value };
        },
        (error) => {
          updateSettled = true;
          return { error };
        },
      );
      const ordinary = rpc.callUnary("server.getConfig").catch((error) => error);
      await vi.advanceTimersByTimeAsync(61_000);
      expect(await ordinary).toBeInstanceOf(Error);
      expect(updateSettled).toBe(false);
      await vi.advanceTimersByTimeAsync(60_000);
      const socket = FakeWebSocket.instances[0]!;
      const request = socket.sent
        .map((raw) => JSON.parse(raw) as { id: string; tag: string })
        .find((entry) => entry.tag === "server.updateProvider")!;
      socket.receive({
        _tag: "Exit",
        requestId: request.id,
        exit: { _tag: "Success", value: { providers: [] } },
      });
      await expect(update).resolves.toEqual({ value: { providers: [] } });
    } finally {
      await rpc.close();
      vi.useRealTimers();
    }
  });

  it("acknowledges each chunk and interrupts with the protocol requestId", async () => {
    FakeWebSocket.instances = [];
    const client = new T3EffectRpcClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const values: unknown[] = [];

    const unsubscribe = await client.openStream(
      "orchestration.subscribeThread",
      { threadId: "thread-1" },
      (value) => values.push(value),
    );

    const socket = FakeWebSocket.instances[0]!;
    const request = JSON.parse(socket.sent[0]!) as { readonly id: string };
    socket.receive({
      _tag: "Chunk",
      requestId: request.id,
      values: [{ kind: "snapshot" }, { kind: "event" }],
    });

    expect(values).toEqual([{ kind: "snapshot" }, { kind: "event" }]);
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      _tag: "Ack",
      requestId: request.id,
    });

    await unsubscribe();
    expect(JSON.parse(socket.sent[2]!)).toEqual({
      _tag: "Interrupt",
      requestId: request.id,
    });
    await client.close();
  });

  it("notifies a stream owner when the server completes its request", async () => {
    FakeWebSocket.instances = [];
    const client = new T3EffectRpcClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    let disconnectCount = 0;

    await client.openStream(
      "previewAutomation.connect",
      { clientId: "cozea-desktop-dev-server" },
      () => {},
      () => {
        disconnectCount += 1;
      },
    );

    const socket = FakeWebSocket.instances[0]!;
    const request = JSON.parse(socket.sent[0]!) as { readonly id: string };
    socket.receive({
      _tag: "Exit",
      requestId: request.id,
      exit: { _tag: "Success", value: undefined },
    });

    expect(disconnectCount).toBe(1);
    await client.close();
    expect(disconnectCount).toBe(1);
  });
});

describe("T3OrchestrationClient snapshots", () => {
  it("applies sparse shell updates, preserves other rows and never fabricates domain events", async () => {
    FakeWebSocket.instances = [];
    const client = new T3OrchestrationClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
    });
    const snapshots: unknown[] = [];
    const domainEvents: unknown[] = [];
    try {
      await Promise.all([
        client.onSnapshot((snapshot) => snapshots.push(snapshot)),
        client.subscribeShellEvents((event) => domainEvents.push(event)),
      ]);
      const socket = FakeWebSocket.instances[0]!;
      const requests = socket.sent.map((raw) => JSON.parse(raw) as { id: string; tag: string });
      expect(
        requests.filter((request) => request.tag === "orchestration.subscribeShell"),
      ).toHaveLength(1);
      const request = requests[0]!;
      const emit = (...values: unknown[]) =>
        socket.receive({ _tag: "Chunk", requestId: request.id, values });
      const other = { id: "other" };
      const initial = {
        snapshotSequence: 10,
        projects: [],
        threads: [other],
        updatedAt: "2026-09-05T00:00:00Z",
      };
      const running = { id: "qa", session: { status: "running" }, updatedAt: initial.updatedAt };
      const ready = {
        ...running,
        session: { status: "ready" },
        latestTurn: { state: "completed" },
      };
      emit(
        { kind: "snapshot", snapshot: initial },
        { kind: "thread-upserted", sequence: 20, thread: running },
        { kind: "thread-upserted", sequence: 35, thread: ready },
      );
      expect(snapshots.at(-1)).toMatchObject({ snapshotSequence: 35, threads: [other, ready] });
      const settled = snapshots.at(-1) as { threads: unknown[] };
      expect(settled.threads[0]).toBe((snapshots[0] as { threads: unknown[] }).threads[0]);
      emit({ kind: "thread-upserted", sequence: 34, thread: running }, { kind: "synchronized" });
      expect(snapshots).toHaveLength(3);
      expect(domainEvents).toEqual([]);
      const late: unknown[] = [];
      await client.onSnapshot((snapshot) => late.push(snapshot));
      expect(late).toEqual([settled]);
      emit(
        {
          kind: "project-upserted",
          sequence: 40,
          project: { id: "p", updatedAt: initial.updatedAt },
        },
        { kind: "thread-removed", sequence: 50, threadId: "qa" },
        { kind: "project-removed", sequence: 60, projectId: "p" },
      );
      expect(snapshots.at(-1)).toMatchObject({
        snapshotSequence: 60,
        threads: [other],
        projects: [],
      });
      emit({ kind: "snapshot", snapshot: initial });
      expect(snapshots.at(-1)).toEqual(initial);
    } finally {
      await client.close();
    }
  });

  it("reads the current shell snapshot from the shell subscription", async () => {
    FakeWebSocket.instances = [];
    const client = new T3OrchestrationClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
      WebSocketImpl: FakeWebSocket as unknown as typeof WebSocket,
      requestTimeoutMs: 1_000,
    });

    const snapshotPromise = client.getSnapshot();
    await new Promise<void>((resolve) => queueMicrotask(resolve));
    await new Promise<void>((resolve) => queueMicrotask(resolve));

    const socket = FakeWebSocket.instances[0]!;
    const request = JSON.parse(socket.sent[0]!) as {
      readonly id: string;
      readonly tag: string;
    };
    expect(request.tag).toBe("orchestration.subscribeShell");

    const snapshot = {
      snapshotSequence: 42,
      projects: [{ id: "project-1" }],
      threads: [{ id: "thread-1" }],
      updatedAt: "2026-08-28T00:00:00.000Z",
    };
    socket.receive({
      _tag: "Chunk",
      requestId: request.id,
      values: [{ kind: "snapshot", snapshot }],
    });

    await expect(snapshotPromise).resolves.toEqual(snapshot);
    expect(JSON.parse(socket.sent[1]!)).toEqual({
      _tag: "Ack",
      requestId: request.id,
    });
    expect(JSON.parse(socket.sent[2]!)).toEqual({
      _tag: "Interrupt",
      requestId: request.id,
    });
    await client.close();
  });
});
