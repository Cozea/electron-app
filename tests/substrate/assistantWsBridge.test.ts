import { EventEmitter } from "node:events";
import { describe, expect, it } from "vitest";

import {
  ORCHESTRATION_WS_CHANNELS,
  ORCHESTRATION_WS_METHODS,
  WS_CHANNELS,
} from "@cozea/assistant-contracts";

import { bridgeAssistantTurn } from "../../electron/substrate-shadow-server/assistantWsBridge";

class MockWebSocket extends EventEmitter {
  static readonly OPEN = 1;
  static readonly CONNECTING = 0;
  static readonly CLOSING = 2;
  static readonly CLOSED = 3;

  readonly readyState = MockWebSocket.OPEN;
  sent: string[] = [];
  private welcomeEmitted = false;

  constructor(_url: string) {
    super();
    this.on("newListener", (event) => {
      if (event === "message") {
        queueMicrotask(() => this.emitWelcomeOnce());
      }
    });
    queueMicrotask(() => {
      this.emit("open");
    });
  }

  send(data: string): void {
    this.sent.push(data);
    this.emitWelcomeOnce();

    const parsed = JSON.parse(data) as {
      readonly id: string;
      readonly body: { readonly _tag: string; readonly command?: unknown };
    };

    if (parsed.body._tag === ORCHESTRATION_WS_METHODS.getSnapshot) {
      this.emitMessage({
        id: parsed.id,
        result: {
          projects: [{ id: "project-1", deletedAt: null }],
          threads: [],
        },
      });
      return;
    }

    if (
      parsed.body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
      (parsed.body.command as { type?: string })?.type === "thread.create"
    ) {
      this.emitMessage({ id: parsed.id, result: { status: "accepted" } });
      return;
    }

    if (
      parsed.body._tag === ORCHESTRATION_WS_METHODS.dispatchCommand &&
      (parsed.body.command as { type?: string })?.type === "thread.turn.start"
    ) {
      this.emitMessage({ id: parsed.id, result: { status: "accepted" } });
      queueMicrotask(() => {
        this.emitPush({
          type: "push",
          sequence: 1,
          channel: ORCHESTRATION_WS_CHANNELS.domainEvent,
          data: {
            type: "thread.message-sent",
            payload: {
              threadId: "thread-bridge",
              messageId: "assistant:item-1",
              role: "assistant",
              text: "hello from mock assistant",
              streaming: false,
            },
          },
        });
      });
      return;
    }

    this.emitMessage({ id: parsed.id, result: {} });
  }

  close(): void {
    this.emit("close");
  }

  protected emitWelcomeOnce(): void {
    if (this.welcomeEmitted) {
      return;
    }
    this.welcomeEmitted = true;
    this.emitPush({
      type: "push",
      sequence: 0,
      channel: WS_CHANNELS.serverWelcome,
      data: {
        cwd: "/tmp/project",
        projectName: "project",
        bootstrapProjectId: "project-1",
        bootstrapThreadId: "thread-bridge",
      },
    });
  }

  protected emitMessage(message: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }

  protected emitPush(message: unknown): void {
    this.emit("message", Buffer.from(JSON.stringify(message)));
  }
}

describe("bridgeAssistantTurn", () => {
  it("collects assistant text from orchestration domain events", async () => {
    const result = await bridgeAssistantTurn({
      text: "hello bridge",
      threadId: "thread-bridge",
      assistantWsUrl: "ws://127.0.0.1:3773",
      timeoutMs: 5_000,
      WebSocketImpl: MockWebSocket as unknown as typeof WebSocket,
    });

    expect(result.mode).toBe("bridged");
    expect(result.replyText).toBe("hello from mock assistant");
  });

  it("returns acceptance fallback when no assistant message arrives", async () => {
    class SilentMockWebSocket extends MockWebSocket {
      override send(data: string): void {
        this.sent.push(data);
        this.emitWelcomeOnce();
        const parsed = JSON.parse(data) as { readonly id: string };
        this.emitMessage({ id: parsed.id, result: { status: "accepted" } });
      }
    }

    const result = await bridgeAssistantTurn({
      text: "silent turn",
      threadId: "thread-bridge",
      assistantWsUrl: "ws://127.0.0.1:3773",
      timeoutMs: 100,
      WebSocketImpl: SilentMockWebSocket as unknown as typeof WebSocket,
    });

    expect(result.mode).toBe("bridged");
    expect(result.replyText).toContain("silent turn");
  });
});
