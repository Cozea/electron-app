import { describe, expect, it } from "vitest";

import { classifyIpcChannel } from "../../electron/substrate/ipcAllowlist";
import {
  readSubstrateFeatureFlags,
  shouldStartInProcessAssistantRuntime,
} from "../../electron/substrate/flags";
import { listSubstrateRemoteEnvironmentStubs } from "../../electron/substrate/remoteEnvironments";

describe("substrate feature flags (phases 5–6)", () => {
  it("defaults all spine flags off", () => {
    const flags = readSubstrateFeatureFlags({});
    expect(flags.shadowServer.enabled).toBe(false);
    expect(flags.rpcChat).toBe(false);
    expect(flags.providers).toBe(false);
    expect(flags.vcs).toBe(false);
    expect(flags.primary).toBe(false);
    expect(flags.obsNdjson).toBe(false);
    expect(shouldStartInProcessAssistantRuntime(flags)).toBe(true);
  });

  it("skips in-process runtime when primary + shadow are enabled", () => {
    const flags = readSubstrateFeatureFlags({
      COZEA_SUBSTRATE_SHADOW_SERVER: "1",
      COZEA_SUBSTRATE_PRIMARY: "1",
    });
    expect(flags.primary).toBe(true);
    expect(flags.shadowServer.enabled).toBe(true);
    expect(shouldStartInProcessAssistantRuntime(flags)).toBe(false);
  });

  it("status features report inProcessAssistant false under primary+shadow", () => {
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
      inProcessAssistant: shouldStartInProcessAssistantRuntime(flags),
    };
    expect(features.inProcessAssistant).toBe(false);
    expect(features.primary).toBe(true);
    expect(features.obsNdjson).toBe(true);
    expect(flags.shadowServer.enabled).toBe(true);
  });

  it("keeps in-process runtime if primary is on but shadow is off", () => {
    const flags = readSubstrateFeatureFlags({
      COZEA_SUBSTRATE_PRIMARY: "1",
    });
    expect(shouldStartInProcessAssistantRuntime(flags)).toBe(true);
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
  it("lists local as ready and remotes as placeholders", () => {
    const envs = listSubstrateRemoteEnvironmentStubs();
    expect(envs.some((env) => env.kind === "local" && env.ready)).toBe(true);
    expect(envs.some((env) => env.kind === "ssh" && !env.ready)).toBe(true);
  });
});
