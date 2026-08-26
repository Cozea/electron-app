import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { SubstrateChatClient } from "@cozea/client-runtime";
import * as orchestrationChat from "../../electron/substrate-shadow-server/rpcOrchestrationChat";
import { attachRpcChat } from "../../electron/substrate-shadow-server/rpcChat";

describe("rpc chat assistant WS bridge (primary mode)", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
    vi.clearAllMocks();
  });

  it("uses assistant bridge when primary is on and runtime is reachable", async () => {
    const bridgeSpy = vi.spyOn(orchestrationChat, "executeRpcBridgedChatTurn").mockResolvedValue({
      replyText: "mock-bridged:bridge-me",
      mode: "orchestration-rpc",
    });
    const readinessServer = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      readinessServer.listen(0, "127.0.0.1", () => resolve());
    });
    const readinessAddress = readinessServer.address();
    if (!readinessAddress || typeof readinessAddress === "string") {
      throw new Error("expected TCP address");
    }
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          readinessServer.close((error) => (error ? reject(error) : resolve()));
        }),
    );

    const rpcServer = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      rpcServer.listen(0, "127.0.0.1", () => resolve());
    });
    const rpcAddress = rpcServer.address();
    if (!rpcAddress || typeof rpcAddress === "string") {
      throw new Error("expected TCP address");
    }
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          rpcServer.close((error) => (error ? reject(error) : resolve()));
        }),
    );

    const assistantOrigin = `http://127.0.0.1:${readinessAddress.port}`;
    const rpc = attachRpcChat({
      server: rpcServer,
      pin: "testpin",
      rpcChatEnabled: true,
      providersEnabled: false,
      primaryEnabled: true,
      assistantHttpOrigin: assistantOrigin,
    });
    cleanup.push(async () => {
      rpc.dispose();
    });

    const client = new SubstrateChatClient({
      baseUrl: `http://127.0.0.1:${rpcAddress.port}`,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      requestTimeoutMs: 10_000,
    });
    cleanup.push(() => client.close());

    const smoke = await client.smokeRoundtrip("bridge-me");
    expect(smoke.send.mode).toBe("bridged");
    expect(smoke.send.replyPreview).toBe("mock-bridged:bridge-me");
    bridgeSpy.mockRestore();
  });
});
