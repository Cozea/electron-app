import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";
import WebSocket from "ws";

import { ORCHESTRATION_RPC_METHODS } from "@cozea/contracts";

import { attachRpcChat } from "../../electron/substrate-shadow-server/rpcChat";
import {
  getSharedOrchestrationRpcProxy,
  resetSharedOrchestrationRpcProxyForTests,
} from "../../electron/substrate-shadow-server/orchestrationRpcProxy";

describe("orchestration RPC handlers", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    resetSharedOrchestrationRpcProxyForTests();
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
  });

  it("routes orchestration.getSnapshot over /rpc", async () => {
    const proxy = getSharedOrchestrationRpcProxy();
    vi.spyOn(proxy, "getSnapshot").mockResolvedValue({ threads: [], projects: [] });

    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => resolve()));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("expected address");
    cleanup.push(
      () =>
        new Promise<void>((resolve, reject) => {
          server.close((error) => (error ? reject(error) : resolve()));
        }),
    );

    const rpc = attachRpcChat({
      server,
      pin: "testpin",
      rpcChatEnabled: true,
      providersEnabled: false,
      providerRegistry: null,
    });
    cleanup.push(async () => {
      rpc.dispose();
    });

    const ws = new WebSocket(`ws://127.0.0.1:${address.port}/rpc`);
    await new Promise<void>((resolve, reject) => {
      ws.once("open", () => resolve());
      ws.once("error", reject);
    });

    const result = await new Promise<unknown>((resolve, reject) => {
      ws.on("message", (raw) => {
        const msg = JSON.parse(String(raw));
        if (msg?.type === "res" && msg.id === "snap-1") {
          if (msg.ok) resolve(msg.result);
          else reject(new Error(msg.error?.message));
        }
      });
      ws.send(
        JSON.stringify({
          type: "req",
          id: "snap-1",
          method: ORCHESTRATION_RPC_METHODS.getSnapshot,
          payload: {},
        }),
      );
    });

    expect(result).toEqual({ threads: [], projects: [] });
    ws.close();
  });
});
