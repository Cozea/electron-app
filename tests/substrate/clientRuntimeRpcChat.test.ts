import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { SubstrateChatClient, readSubstrateRpcChatFlags } from "@cozea/client-runtime";
import { createShadowHttpServer } from "../../electron/substrate-shadow-server/createShadowHttpServer";

describe("readSubstrateRpcChatFlags", () => {
  it("defaults off", () => {
    const flags = readSubstrateRpcChatFlags({});
    expect(flags.enabled).toBe(false);
    expect(flags.flagId).toBe("cozea.substrate.rpcChat");
  });

  it("enables via COZEA_SUBSTRATE_RPC_CHAT=1", () => {
    expect(
      readSubstrateRpcChatFlags({ COZEA_SUBSTRATE_RPC_CHAT: "1" }).enabled,
    ).toBe(true);
  });
});

describe("SubstrateChatClient connect + ready", () => {
  const handles: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    while (handles.length > 0) {
      await handles.pop()?.stop();
    }
  });

  it("connects to shadow /rpc and completes a smoke roundtrip", async () => {
    const handle = createShadowHttpServer({
      host: "127.0.0.1",
      port: 0,
      pin: "testpin",
      rpcChatEnabled: true,
    });
    handles.push(handle);
    const { port } = await handle.start();

    const client = new SubstrateChatClient({
      baseUrl: `http://127.0.0.1:${port}`,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      requestTimeoutMs: 10_000,
    });

    try {
      await client.connect();
      expect(client.getPhase()).toBe("ready");
      expect(client.getUrl()).toContain("/rpc");

      const smoke = await client.smokeRoundtrip("hello-phase2");
      expect(smoke.health.ok).toBe(true);
      expect(smoke.health.phase).toBe(2);
      expect(smoke.health.rpcChat).toBe(true);
      expect(smoke.send.accepted).toBe(true);
      expect(smoke.send.turnId.length).toBeGreaterThan(0);
      expect(smoke.events.some((event) => event._tag === "completed")).toBe(true);
    } finally {
      await client.close();
    }
  });
});
