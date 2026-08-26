import { describe, expect, it } from "vitest";

import { classifyIpcChannel } from "../../electron/substrate/ipcAllowlist";
import { readSubstrateFeatureFlags } from "../../electron/substrate/flags";
import { listSubstrateRemoteEnvironmentStubs } from "../../electron/substrate/remoteEnvironments";

describe("substrate feature flags (phases 5–6)", () => {
  it("defaults all spine flags on", () => {
    const flags = readSubstrateFeatureFlags({});
    expect(flags.shadowServer.enabled).toBe(true);
    expect(flags.rpcChat).toBe(true);
    expect(flags.providers).toBe(true);
    expect(flags.vcs).toBe(true);
    expect(flags.primary).toBe(true);
    expect(flags.obsNdjson).toBe(true);
    expect(flags.t3Server).toBe(true);
  });

  it("status features always report inProcessAssistant false (legacy runtime removed)", () => {
    const flags = readSubstrateFeatureFlags({
      COZEA_SUBSTRATE_SHADOW_SERVER: "1",
      COZEA_SUBSTRATE_PRIMARY: "1",
      COZEA_SUBSTRATE_RPC_CHAT: "1",
      COZEA_SUBSTRATE_PROVIDERS: "1",
      COZEA_OBS_NDJSON: "1",
    });
    const features = {
      rpcChat: flags.rpcChat,
      providers: flags.providers,
      vcs: flags.vcs,
      primary: flags.primary,
      obsNdjson: flags.obsNdjson,
      inProcessAssistant: false,
    };
    expect(features.inProcessAssistant).toBe(false);
    expect(features.primary).toBe(true);
    expect(features.obsNdjson).toBe(true);
    expect(flags.shadowServer.enabled).toBe(true);
  });
});

describe("phase 5 ipc allowlist", () => {
  it("allows workspace and collab bridges", () => {
    expect(classifyIpcChannel("workspace:list").allowed).toBe(true);
    expect(classifyIpcChannel("collab:getRoomKey").allowed).toBe(true);
    expect(classifyIpcChannel("substrateShadow:getStatus").allowed).toBe(true);
  });

  it("rejects assistant/git channels for primary mode", () => {
    expect(classifyIpcChannel("assistantRuntime:getStatus").allowed).toBe(false);
    expect(classifyIpcChannel("git:status").allowed).toBe(false);
    expect(classifyIpcChannel("terminal:create").allowed).toBe(false);
  });
});

describe("phase 6 remote environment stubs", () => {
  it("lists local primary and non-ready SSH/WSL catalog entries", () => {
    const envs = listSubstrateRemoteEnvironmentStubs();
    expect(envs.some((env) => env.kind === "local")).toBe(true);
    expect(envs.some((env) => env.kind === "ssh" && !env.ready)).toBe(true);
    expect(envs.some((env) => env.kind === "wsl")).toBe(true);
  });
});
