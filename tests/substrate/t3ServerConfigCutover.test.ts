import { describe, expect, it, vi } from "vitest";

import {
  applyServerConfigProjection,
  T3EffectRpcClient,
  T3ServerConfigClient,
  T3TerminalClient,
  T3VcsClient,
} from "@cozea/client-runtime";
import type { ServerConfig } from "@cozea/assistant-contracts";

const BASE_CONFIG = {
  cwd: "/repo",
  issues: [],
  providers: [{ id: "codex", name: "Codex", state: "ready", models: [] }],
  keybindings: { rules: [] },
  settings: {},
} as unknown as ServerConfig;

describe("applyServerConfigProjection", () => {
  it("replaces config on snapshot events", () => {
    const next = applyServerConfigProjection(BASE_CONFIG, {
      version: 1,
      type: "snapshot",
      config: {
        ...BASE_CONFIG,
        cwd: "/next",
      },
    });
    expect(next?.cwd).toBe("/next");
  });

  it("merges provider status updates", () => {
    const next = applyServerConfigProjection(BASE_CONFIG, {
      version: 1,
      type: "providerStatuses",
      payload: {
        providers: [{ id: "cursor", name: "Cursor", state: "ready", models: [] }],
      },
    });
    expect(next?.providers).toHaveLength(1);
    expect(next?.providers[0]?.id).toBe("cursor");
  });
});

describe("T3 server config cutover client", () => {
  it("T3ServerConfigClient exposes config RPC surface", () => {
    const client = new T3ServerConfigClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
    });

    expect(typeof client.getConfig).toBe("function");
    expect(typeof client.refreshProviders).toBe("function");
    expect(typeof client.updateProvider).toBe("function");
    expect(typeof client.subscribeServerConfig).toBe("function");
  });

  it("returns the provider update payload so command outcomes reach the UI", async () => {
    const payload = {
      providers: [
        {
          instanceId: "codex",
          driver: "codex",
          updateState: {
            status: "unchanged",
            startedAt: "2026-08-29T10:00:00.000Z",
            finishedAt: "2026-08-29T10:00:01.000Z",
            message: "The installed provider version did not change.",
            output: "Already up-to-date.",
          },
        },
      ],
    };
    const callUnary = vi.fn().mockResolvedValue(payload);
    const client = new T3ServerConfigClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
      client: { callUnary } as unknown as T3EffectRpcClient,
    });

    await expect(client.updateProvider("codex", "codex")).resolves.toBe(payload);
    expect(callUnary).toHaveBeenCalledWith("server.updateProvider", {
      provider: "codex",
      instanceId: "codex",
    });
  });
});

describe("T3 VCS + terminal clients", () => {
  it("T3VcsClient and T3TerminalClient expose RPC surfaces", () => {
    const rpc = new T3EffectRpcClient({
      baseUrl: "http://127.0.0.1:13773",
      wsTicket: "test-ticket",
    });
    const vcs = new T3VcsClient({ client: rpc });
    const terminal = new T3TerminalClient({ client: rpc });

    expect(typeof vcs.pull).toBe("function");
    expect(typeof vcs.status).toBe("function");
    expect(typeof terminal.open).toBe("function");
    expect(typeof terminal.close).toBe("function");
  });
});
