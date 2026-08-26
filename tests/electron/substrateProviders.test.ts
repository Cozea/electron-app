import { describe, expect, it } from "vitest";

import { SUBSTRATE_PROVIDERS_FLAG } from "../../electron/substrate/constants";
import { readSubstrateProvidersFlags } from "../../electron/substrate/flags";
import {
  assertManagedSnapshotTransition,
  beginManagedSnapshotRefresh,
  bootstrapSubstrateProviderRegistry,
  canTransitionManagedSnapshot,
  createManagedSnapshotState,
  createOpenCodeSubstrateDriver,
  createPendingSnapshot,
  MANAGED_SNAPSHOT_TRANSITIONS,
  runManagedSnapshotPipeline,
  SubstrateProviderDriverRegistry,
  SubstrateProviderRegistryError,
  transitionManagedSnapshot,
  type OpenCodeDriverHooks,
} from "../../electron/substrate/providers";

describe("readSubstrateProvidersFlags", () => {
  it("defaults to disabled", () => {
    const flags = readSubstrateProvidersFlags({});
    expect(flags.enabled).toBe(false);
    expect(flags.flagId).toBe(SUBSTRATE_PROVIDERS_FLAG);
    expect(flags.flagId).toBe("cozea.substrate.providers");
  });

  it("enables via COZEA_SUBSTRATE_PROVIDERS=1", () => {
    const flags = readSubstrateProvidersFlags({
      COZEA_SUBSTRATE_PROVIDERS: "1",
    });
    expect(flags.enabled).toBe(true);
  });
});

describe("managed snapshot state machine", () => {
  it("allows the canonical pending → enrich → ready path", () => {
    expect(canTransitionManagedSnapshot("pending", "probing")).toBe(true);
    expect(canTransitionManagedSnapshot("probing", "enriching_capabilities")).toBe(true);
    expect(canTransitionManagedSnapshot("enriching_capabilities", "enriching_skills")).toBe(true);
    expect(canTransitionManagedSnapshot("enriching_skills", "enriching_slash")).toBe(true);
    expect(canTransitionManagedSnapshot("enriching_slash", "enriching_account_models")).toBe(true);
    expect(canTransitionManagedSnapshot("enriching_account_models", "ready")).toBe(true);
  });

  it("rejects illegal transitions", () => {
    expect(canTransitionManagedSnapshot("pending", "ready")).toBe(false);
    expect(() => assertManagedSnapshotTransition("ready", "enriching_skills")).toThrow(
      /Invalid managed snapshot transition/,
    );
  });

  it("lists a complete transition table for every phase", () => {
    expect(Object.keys(MANAGED_SNAPSHOT_TRANSITIONS)).toEqual(
      expect.arrayContaining([
        "pending",
        "probing",
        "enriching_capabilities",
        "enriching_skills",
        "enriching_slash",
        "enriching_account_models",
        "ready",
        "error",
        "unavailable",
      ]),
    );
  });

  it("runs the enrichment pipeline to ready", async () => {
    const pending = createPendingSnapshot({
      driver: "opencode",
      instanceId: "opencode",
      displayName: "OpenCode",
      enabled: true,
    });
    const initial = createManagedSnapshotState(pending);
    expect(initial.phase).toBe("pending");

    const next = await runManagedSnapshotPipeline(initial, {
      probe: async () => ({
        installed: true,
        version: "1.2.3",
        auth: { status: "authenticated", type: "opencode" },
        availability: "available",
      }),
      capabilities: async () => ({
        models: [{ slug: "opencode/fast", name: "Fast", capabilities: { tools: true } }],
      }),
      skills: async () => ({
        skills: [{ name: "review", path: "/skills/review.md", enabled: true }],
      }),
      slash: async () => ({
        slashCommands: [{ name: "compact", description: "Compact context" }],
      }),
      accountModels: async () => ({
        models: [
          { slug: "opencode/fast", name: "Fast", capabilities: { tools: true } },
          { slug: "opencode/pro", name: "Pro" },
        ],
      }),
    });

    expect(next.phase).toBe("ready");
    expect(next.snapshot.status).toBe("ready");
    expect(next.snapshot.installed).toBe(true);
    expect(next.snapshot.version).toBe("1.2.3");
    expect(next.snapshot.models.map((model) => model.slug)).toEqual([
      "opencode/fast",
      "opencode/pro",
    ]);
    expect(next.snapshot.skills).toHaveLength(1);
    expect(next.snapshot.slashCommands).toHaveLength(1);
  });

  it("bumps generation on refresh and resets to pending", () => {
    const pending = createPendingSnapshot({
      driver: "opencode",
      instanceId: "opencode",
      displayName: "OpenCode",
      enabled: true,
    });
    let state = createManagedSnapshotState(pending);
    state = transitionManagedSnapshot(state, "probing");
    state = transitionManagedSnapshot(state, "ready", { status: "ready", installed: true });
    expect(state.phase).toBe("ready");
    expect(state.generation).toBe(0);

    const refreshed = beginManagedSnapshotRefresh(state);
    expect(refreshed.phase).toBe("pending");
    expect(refreshed.generation).toBe(1);
  });

  it("marks disabled instances unavailable without probing", async () => {
    const pending = createPendingSnapshot({
      driver: "opencode",
      instanceId: "opencode",
      displayName: "OpenCode",
      enabled: false,
    });
    const next = await runManagedSnapshotPipeline(createManagedSnapshotState(pending), {
      probe: async () => {
        throw new Error("probe should not run for disabled instances");
      },
    });
    expect(next.phase).toBe("unavailable");
    expect(next.snapshot.status).toBe("disabled");
  });
});

describe("SubstrateProviderDriverRegistry", () => {
  it("throws when the flag is disabled", () => {
    const registry = new SubstrateProviderDriverRegistry(false);
    expect(registry.enabled).toBe(false);
    expect(() => registry.register(createOpenCodeSubstrateDriver())).toThrow(
      SubstrateProviderRegistryError,
    );
    expect(registry.getStatus()).toEqual({
      flagId: "cozea.substrate.providers",
      enabled: false,
      registeredDrivers: [],
      liveInstances: [],
    });
  });

  it("registers drivers and materializes OpenCode through managed snapshots", async () => {
    const hooks: OpenCodeDriverHooks = {
      probe: async () => ({
        installed: true,
        version: "9.9.9",
        authenticated: true,
        message: "ok",
      }),
      loadInventory: async () => ({
        models: [{ slug: "opencode/default", name: "Default" }],
        skills: [{ name: "ship", path: "/skills/ship.md" }],
        slashCommands: [{ name: "test", description: "Run tests" }],
        capabilitiesBySlug: {
          "opencode/default": { tools: true },
        },
      }),
    };

    const registry = new SubstrateProviderDriverRegistry(true);
    registry.register(createOpenCodeSubstrateDriver(hooks));

    const instance = await registry.materialize({ driverKind: "opencode" });
    expect(instance.implementation).toBe("full");
    expect(instance.snapshot.getState().phase).toBe("pending");

    const ready = await instance.snapshot.run();
    expect(ready.phase).toBe("ready");
    expect(ready.snapshot.version).toBe("9.9.9");
    expect(ready.snapshot.models[0]?.capabilities).toEqual({ tools: true });
    expect(ready.snapshot.skills).toHaveLength(1);
    expect(ready.snapshot.slashCommands).toHaveLength(1);

    const status = registry.getStatus();
    expect(status.registeredDrivers.map((driver) => driver.driverKind)).toEqual(["opencode"]);
    expect(status.liveInstances).toEqual([
      { instanceId: "opencode", driverKind: "opencode", phase: "ready" },
    ]);
  });
});

describe("bootstrapSubstrateProviderRegistry", () => {
  it("stays empty when the flag is off", () => {
    const registry = bootstrapSubstrateProviderRegistry({ env: {} });
    expect(registry.enabled).toBe(false);
    expect(registry.getStatus().registeredDrivers).toEqual([]);
  });

  it("registers OpenCode (full) plus legacy adapters when force-enabled", async () => {
    const registry = bootstrapSubstrateProviderRegistry({
      env: {},
      forceEnable: true,
      openCodeHooks: {
        probe: async () => ({
          installed: true,
          version: "1.0.0",
          authenticated: false,
        }),
        loadInventory: async () => ({
          models: [{ slug: "opencode/default", name: "Default" }],
          skills: [],
          slashCommands: [],
        }),
      },
    });

    expect(registry.enabled).toBe(true);
    const kinds = registry.listDrivers().map((driver) => driver.driverKind);
    expect(kinds).toEqual(
      expect.arrayContaining(["opencode", "cursor", "claudeAgent", "codex"]),
    );

    const openCode = registry.resolveDriver("opencode");
    expect(openCode.metadata.implementation).toBe("full");

    const codex = registry.resolveDriver("codex");
    expect(codex.metadata.implementation).toBe("full");

    const instance = await registry.materialize({ driverKind: "opencode" });
    const ready = await instance.snapshot.run();
    expect(ready.phase).toBe("ready");
  });

  it("enables via COZEA_SUBSTRATE_PROVIDERS without forceEnable", () => {
    const registry = bootstrapSubstrateProviderRegistry({
      env: { COZEA_SUBSTRATE_PROVIDERS: "1" },
    });
    expect(registry.enabled).toBe(true);
    expect(registry.listDrivers().length).toBeGreaterThanOrEqual(4);
  });
});
