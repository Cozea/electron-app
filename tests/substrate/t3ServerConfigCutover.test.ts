import { describe, expect, it } from "vitest";

import {
  applyServerConfigProjection,
  T3ServerConfigClient,
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
    expect(typeof client.subscribeServerConfig).toBe("function");
  });
});
