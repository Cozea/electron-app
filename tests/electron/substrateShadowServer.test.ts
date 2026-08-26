import { createServer } from "node:http";
import { afterEach, describe, expect, it, vi } from "vitest";

import { SUBSTRATE_SHADOW_READY_PATH } from "../../electron/substrate/constants";
import { createShadowHttpServer } from "../../electron/substrate-shadow-server/createShadowHttpServer";
import { readSubstrateShadowServerFlags } from "../../electron/substrate/flags";
import { ShadowServerManager } from "../../electron/substrate/ShadowServerManager";

describe("readSubstrateShadowServerFlags", () => {
  it("defaults to enabled on a dedicated port", () => {
    const flags = readSubstrateShadowServerFlags({});
    expect(flags.enabled).toBe(true);
    expect(flags.port).toBe(4783);
    expect(flags.flagId).toBe("cozea.substrate.shadowServer");
  });

  it("can disable via COZEA_SUBSTRATE_SHADOW_SERVER=0", () => {
    const flags = readSubstrateShadowServerFlags({
      COZEA_SUBSTRATE_SHADOW_SERVER: "0",
    });
    expect(flags.enabled).toBe(false);
  });

  it("respects custom port when enabled", () => {
    const flags = readSubstrateShadowServerFlags({
      COZEA_SUBSTRATE_SHADOW_SERVER: "1",
      COZEA_SUBSTRATE_SHADOW_PORT: "51234",
    });
    expect(flags.enabled).toBe(true);
    expect(flags.port).toBe(51234);
  });
});

describe("createShadowHttpServer", () => {
  const servers: Array<{ stop: () => Promise<void> }> = [];

  afterEach(async () => {
    while (servers.length > 0) {
      const handle = servers.pop();
      await handle?.stop();
    }
  });

  it("serves readiness JSON on the canonical path", async () => {
    const handle = createShadowHttpServer({
      host: "127.0.0.1",
      port: 0,
      pin: "deadbeef",
      pid: 42,
      startedAtMs: 100,
    });
    servers.push(handle);
    const { port } = await handle.start();

    const response = await fetch(`http://127.0.0.1:${port}${SUBSTRATE_SHADOW_READY_PATH}`);
    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      ok: boolean;
      role: string;
      phase: number;
      pin: string;
      pid: number;
    };
    expect(body).toMatchObject({
      ok: true,
      role: "shadow",
      phase: 1,
      pin: "deadbeef",
      pid: 42,
    });
  });
});

describe("ShadowServerManager", () => {
  it("no-ops when the shadow flag is disabled", async () => {
    const forkImpl = vi.fn();
    const manager = new ShadowServerManager({
      entryPath: "/tmp/missing-substrate-shadow-server.js",
      logDirectory: "/tmp/cozea-substrate-shadow-test-logs",
      flags: {
        flagId: "cozea.substrate.shadowServer",
        enabled: false,
        host: "127.0.0.1",
        port: 4783,
      },
      forkImpl: forkImpl as never,
    });

    const status = await manager.start();
    expect(status.phase).toBe("stopped");
    expect(forkImpl).not.toHaveBeenCalled();
  });

  it("waits for readiness after forking when enabled", async () => {
    const readyServer = createServer((request, response) => {
      if (request.url === SUBSTRATE_SHADOW_READY_PATH) {
        response.writeHead(200, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: true }));
        return;
      }
      response.writeHead(404);
      response.end();
    });

    await new Promise<void>((resolve) => {
      readyServer.listen(0, "127.0.0.1", () => resolve());
    });
    const address = readyServer.address();
    if (!address || typeof address === "string") {
      throw new Error("expected TCP listen address");
    }

    const fakeChild = {
      pid: 99,
      killed: false,
      exitCode: null as number | null,
      stdout: { on: vi.fn() },
      stderr: { on: vi.fn() },
      once: vi.fn(),
      kill: vi.fn(() => {
        fakeChild.killed = true;
        fakeChild.exitCode = 0;
        return true;
      }),
    };

    const forkImpl = vi.fn(() => fakeChild);
    const manager = new ShadowServerManager({
      entryPath: "/tmp/fake-substrate-shadow-server.js",
      logDirectory: "/tmp/cozea-substrate-shadow-test-logs",
      flags: {
        flagId: "cozea.substrate.shadowServer",
        enabled: true,
        host: "127.0.0.1",
        port: address.port,
      },
      forkImpl: forkImpl as never,
      readinessTimeoutMs: 5_000,
    });

    // Pretend the entry exists without touching disk layout: monkey-patch existsSync via fork only after
    // we stub fs by writing a tiny file.
    const fs = await import("node:fs");
    fs.writeFileSync("/tmp/fake-substrate-shadow-server.js", "console.log('fake')\n");

    try {
      const status = await manager.start();
      expect(forkImpl).toHaveBeenCalledTimes(1);
      expect(status.phase).toBe("ready");
      expect(status.pid).toBe(99);
      expect(status.port).toBe(address.port);
    } finally {
      await manager.stop();
      await new Promise<void>((resolve, reject) => {
        readyServer.close((error) => (error ? reject(error) : resolve()));
      });
      fs.rmSync("/tmp/fake-substrate-shadow-server.js", { force: true });
    }
  });
});
