import { describe, expect, it } from "vitest";

import { readSubstrateFeatureFlags } from "../../apps/desktop/electron/substrate/flags";

describe("default boot (flags on)", () => {
  it("enables all substrate spine flags with empty env", () => {
    const flags = readSubstrateFeatureFlags({});
    expect(flags.shadowServer.enabled).toBe(true);
    expect(flags.rpcChat).toBe(true);
    expect(flags.providers).toBe(true);
    expect(flags.vcs).toBe(true);
    expect(flags.primary).toBe(true);
    expect(flags.obsNdjson).toBe(true);
    expect(flags.t3Server).toBe(true);
  });

  it("allows opt-out via explicit env overrides", () => {
    const flags = readSubstrateFeatureFlags({
      COZEA_SUBSTRATE_SHADOW_SERVER: "0",
      COZEA_SUBSTRATE_RPC_CHAT: "0",
      COZEA_SUBSTRATE_PROVIDERS: "0",
      COZEA_SUBSTRATE_VCS: "0",
      COZEA_SUBSTRATE_PRIMARY: "0",
      COZEA_OBS_NDJSON: "0",
      COZEA_T3_SERVER: "0",
    });
    expect(flags.shadowServer.enabled).toBe(false);
    expect(flags.rpcChat).toBe(false);
    expect(flags.providers).toBe(false);
    expect(flags.vcs).toBe(false);
    expect(flags.primary).toBe(false);
    expect(flags.obsNdjson).toBe(false);
    expect(flags.t3Server).toBe(false);
  });
});
