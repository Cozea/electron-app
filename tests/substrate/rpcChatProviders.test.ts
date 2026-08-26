import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import WebSocket from "ws";

import { SubstrateChatClient } from "@cozea/client-runtime";
import { createShadowHttpServer } from "../../electron/substrate-shadow-server/createShadowHttpServer";
import { attachRpcChat } from "../../electron/substrate-shadow-server/rpcChat";
import {
  getSharedSubstrateNdjsonWriter,
  resetSharedSubstrateNdjsonWriterForTests,
} from "../../electron/substrate/obs";
import {
  bootstrapSubstrateProviderRegistry,
  SubstrateProviderDriverRegistry,
} from "../../electron/substrate/providers";

describe("rpc chat provider-backed mode (phase 2+3)", () => {
  const cleanup: Array<() => Promise<void>> = [];

  afterEach(async () => {
    while (cleanup.length > 0) {
      await cleanup.pop()?.();
    }
    resetSharedSubstrateNdjsonWriterForTests();
  });

  it("keeps echo/bridge when providers flag is off", async () => {
    const handle = createShadowHttpServer({
      host: "127.0.0.1",
      port: 0,
      pin: "testpin",
      rpcChatEnabled: true,
      providersEnabled: false,
    });
    cleanup.push(() => handle.stop());
    const { port } = await handle.start();

    const client = new SubstrateChatClient({
      baseUrl: `http://127.0.0.1:${port}`,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      requestTimeoutMs: 10_000,
    });
    cleanup.push(() => client.close());

    const smoke = await client.smokeRoundtrip("hello-echo");
    expect(smoke.health.providers ?? false).toBe(false);
    expect(smoke.health.phase).toBe(2);
    expect(["echo", "bridged"]).toContain(smoke.send.mode);
    expect(smoke.send.accepted).toBe(true);
  });

  it("routes chat.send through provider registry when providers enabled", async () => {
    const ndjsonPath = path.join(
      os.tmpdir(),
      `cozea-substrate-obs-test-${Date.now()}.ndjson`,
    );
    cleanup.push(async () => {
      fs.rmSync(ndjsonPath, { force: true });
    });

    resetSharedSubstrateNdjsonWriterForTests();
    getSharedSubstrateNdjsonWriter({
      forceEnable: true,
      filePath: ndjsonPath,
      env: { COZEA_OBS_NDJSON: "1" },
    });

    const registry = bootstrapSubstrateProviderRegistry({
      forceEnable: true,
      openCodeHooks: {
        probe: async () => ({
          installed: true,
          version: "test",
          authenticated: true,
        }),
        loadInventory: async () => ({
          models: [{ slug: "opencode/default", name: "Default" }],
          skills: [],
          slashCommands: [],
        }),
      },
    });
    cleanup.push(() => registry.disposeAll());

    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
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
      providersEnabled: true,
      providerRegistry: registry,
      env: { COZEA_SUBSTRATE_PROVIDERS: "1", COZEA_OBS_NDJSON: "1" },
    });
    cleanup.push(async () => {
      rpc.dispose();
    });

    const client = new SubstrateChatClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      requestTimeoutMs: 10_000,
    });
    cleanup.push(() => client.close());

    expect(rpc.providersEnabled).toBe(true);
    const smoke = await client.smokeRoundtrip("hello-provider");
    expect(smoke.health.phase).toBe(3);
    expect(smoke.health.providers).toBe(true);
    expect(smoke.send.mode).toBe("provider");
    expect(smoke.send.providerId).toBe("opencode");
    expect(smoke.send.replyPreview).toContain("substrate-provider:opencode");
    expect(smoke.events.some((event) => event._tag === "completed")).toBe(true);

    await new Promise((resolve) => setTimeout(resolve, 50));
    const ndjson = fs.readFileSync(ndjsonPath, "utf8");
    expect(ndjson).toContain("substrate.provider.materialize");
    expect(ndjson).toContain("substrate.rpc.chat.send_accepted");
  });

  it("falls back to echo/bridge when materialize fails", async () => {
    const bare = new SubstrateProviderDriverRegistry(true);

    const server = createServer((_req, res) => {
      res.writeHead(200);
      res.end("ok");
    });
    await new Promise<void>((resolve) => {
      server.listen(0, "127.0.0.1", () => resolve());
    });
    const address = server.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP address");
    }
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
      providersEnabled: true,
      providerRegistry: bare,
    });
    cleanup.push(async () => {
      rpc.dispose();
    });

    const client = new SubstrateChatClient({
      baseUrl: `http://127.0.0.1:${address.port}`,
      WebSocketImpl: WebSocket as unknown as typeof globalThis.WebSocket,
      requestTimeoutMs: 10_000,
    });
    cleanup.push(() => client.close());

    const smoke = await client.smokeRoundtrip("fallback-please");
    expect(["echo", "bridged"]).toContain(smoke.send.mode);
    expect(smoke.send.todo).toMatch(/fallback/i);
  });
});
