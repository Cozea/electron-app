import { describe, expect, it } from "vitest";

import {
  createCodexSubstrateDriver,
  defaultCodexDriverHooks,
} from "../../apps/desktop/electron/substrate/providers/drivers/codexDriver";

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

  it("deepProbe populates skills when COZEA_SUBSTRATE_CODEX_DEEP_PROBE=1", async () => {
    const previous = process.env.COZEA_SUBSTRATE_CODEX_DEEP_PROBE;
    process.env.COZEA_SUBSTRATE_CODEX_DEEP_PROBE = "1";
    try {
      const driver = createCodexSubstrateDriver({
        probe: async () => ({
          installed: true,
          version: "0.37.0",
          authenticated: true,
        }),
        deepProbe: async () => ({
          skills: [{ name: "review", path: "/skills/review.md", enabled: true }],
        }),
        loadInventory: async (config) => {
          const discovery = await defaultCodexDriverHooks.deepProbe?.(config);
          const base = {
            models: [{ slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" }],
            skills: [] as Array<{ name: string; path: string; enabled?: boolean }>,
            slashCommands: [],
          };
          if (discovery?.skills.length) {
            return { ...base, skills: discovery.skills };
          }
          return base;
        },
      });

      const instance = await driver.create({
        instanceId: "codex-deep",
        enabled: true,
        config: { binaryPath: "codex", deepProbe: true },
      });
      const ready = await instance.snapshot.run();
      expect(ready.snapshot.skills.some((skill) => skill.name === "review")).toBe(true);
    } finally {
      if (previous === undefined) {
        delete process.env.COZEA_SUBSTRATE_CODEX_DEEP_PROBE;
      } else {
        process.env.COZEA_SUBSTRATE_CODEX_DEEP_PROBE = previous;
      }
    }
  });
});
