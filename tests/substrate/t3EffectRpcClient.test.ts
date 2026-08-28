import { describe, expect, it } from "vitest";

import { T3EffectRpcClient, T3OrchestrationClient } from "@cozea/client-runtime";

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
