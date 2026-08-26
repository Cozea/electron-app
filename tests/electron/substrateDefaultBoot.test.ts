import { describe, expect, it } from "vitest";

import {
  readSubstrateFeatureFlags,
  shouldStartInProcessAssistantRuntime,
} from "../../electron/substrate/flags";

describe("default boot (flags off)", () => {
  it("keeps all substrate spine flags disabled with empty env", () => {
    const flags = readSubstrateFeatureFlags({});
    expect(flags.shadowServer.enabled).toBe(false);
    expect(flags.rpcChat).toBe(false);
    expect(flags.providers).toBe(false);
    expect(flags.vcs).toBe(false);
    expect(flags.primary).toBe(false);
    expect(flags.obsNdjson).toBe(false);
    expect(shouldStartInProcessAssistantRuntime(flags)).toBe(true);
  });
});
