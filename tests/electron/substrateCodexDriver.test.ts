import { describe, expect, it } from "vitest";

import {
  createCodexSubstrateDriver,
  defaultCodexDriverHooks,
} from "../../electron/substrate/providers/drivers/codexDriver";

describe("createCodexSubstrateDriver", () => {
  it("runs the full managed snapshot pipeline with injected hooks", async () => {
    const driver = createCodexSubstrateDriver({
      probe: async () => ({
        installed: true,
        version: "0.37.0",
        authenticated: true,
      }),
      loadInventory: async () => ({
        models: [{ slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" }],
        skills: [{ name: "review", path: "/skills/review", enabled: true }],
        slashCommands: [{ name: "/review", description: "Review changes" }],
      }),
    });

    expect(driver.metadata.implementation).toBe("full");
    const instance = await driver.create({
      instanceId: "codex",
      enabled: true,
      config: driver.defaultConfig(),
    });
    const ready = await instance.snapshot.run();
    expect(ready.phase).toBe("ready");
    expect(ready.snapshot.models.some((m) => m.slug === "gpt-5.3-codex")).toBe(true);
    expect(ready.snapshot.skills.length).toBe(1);
  });

  it("default hooks are safe stubs (no throw)", async () => {
    const driver = createCodexSubstrateDriver(defaultCodexDriverHooks);
    const probe = await defaultCodexDriverHooks.probe({ binaryPath: "__missing_codex_binary__" });
    expect(probe.installed).toBe(false);

    const instance = await driver.create({
      instanceId: "codex-test",
      enabled: true,
      config: { binaryPath: "__missing_codex_binary__" },
    });
    const state = await instance.snapshot.run();
    expect(["error", "unavailable", "ready"]).toContain(state.phase);
  });
});
