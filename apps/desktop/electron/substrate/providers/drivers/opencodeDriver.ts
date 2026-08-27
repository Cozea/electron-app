import {
  beginManagedSnapshotRefresh,
  createManagedSnapshotState,
  createPendingSnapshot,
  runManagedSnapshotPipeline,
  type ManagedSnapshotEnrichers,
  type SnapshotEnrichmentPatch,
} from "../managedSnapshot";
import type {
  ManagedSnapshotState,
  SubstrateDriverCreateInput,
  SubstrateManagedSnapshotHandle,
  SubstrateProviderDriver,
  SubstrateProviderInstance,
  SubstrateProviderModel,
  SubstrateProviderSkill,
  SubstrateProviderSlashCommand,
} from "../types";

export interface OpenCodeProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly authenticated: boolean;
  readonly message?: string;
}

export interface OpenCodeInventoryResult {
  readonly models: ReadonlyArray<SubstrateProviderModel>;
  readonly skills: ReadonlyArray<SubstrateProviderSkill>;
  readonly slashCommands: ReadonlyArray<SubstrateProviderSlashCommand>;
  /** Optional capability metadata keyed by model slug. */
  readonly capabilitiesBySlug?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface OpenCodeDriverHooks {
  readonly probe: (config: Readonly<Record<string, unknown>>) => Promise<OpenCodeProbeResult>;
  readonly loadInventory: (
    config: Readonly<Record<string, unknown>>,
  ) => Promise<OpenCodeInventoryResult>;
}

const DEFAULT_OPENCODE_MODELS: ReadonlyArray<SubstrateProviderModel> = [
  { slug: "opencode/default", name: "OpenCode Default" },
];

/**
 * Default hooks used outside tests. They avoid spawning CLIs in the substrate
 * scaffold — real probe wiring lands when Phase 3 cuts over the live path.
 * Tests inject deterministic hooks.
 */
export const defaultOpenCodeDriverHooks: OpenCodeDriverHooks = {
  probe: async () => ({
    installed: true,
    version: "substrate-stub",
    authenticated: false,
    message: "Substrate OpenCode driver stub probe (flagged path; not the live provider).",
  }),
  loadInventory: async () => ({
    models: DEFAULT_OPENCODE_MODELS,
    skills: [],
    slashCommands: [],
  }),
};

function buildEnrichers(
  config: Readonly<Record<string, unknown>>,
  hooks: OpenCodeDriverHooks,
): ManagedSnapshotEnrichers {
  let inventory: OpenCodeInventoryResult | null = null;

  const ensureInventory = async (): Promise<OpenCodeInventoryResult> => {
    if (!inventory) {
      inventory = await hooks.loadInventory(config);
    }
    return inventory;
  };

  return {
    probe: async (): Promise<SnapshotEnrichmentPatch> => {
      const result = await hooks.probe(config);
      if (!result.installed) {
        return {
          installed: false,
          version: result.version,
          status: "error",
          availability: "unavailable",
          unavailableReason: result.message ?? "OpenCode CLI is not installed.",
          message: result.message ?? "OpenCode CLI is not installed.",
          auth: { status: "unknown" },
        };
      }
      return {
        installed: true,
        version: result.version,
        status: "initializing",
        auth: {
          status: result.authenticated ? "authenticated" : "unauthenticated",
          type: "opencode",
        },
        message: result.message,
        availability: "available",
      };
    },
    capabilities: async (): Promise<SnapshotEnrichmentPatch> => {
      const loaded = await ensureInventory();
      const models = loaded.models.map((model) => {
        const capabilities = loaded.capabilitiesBySlug?.[model.slug];
        return capabilities ? { ...model, capabilities } : model;
      });
      return { models };
    },
    skills: async (): Promise<SnapshotEnrichmentPatch> => {
      const loaded = await ensureInventory();
      return { skills: loaded.skills };
    },
    slash: async (): Promise<SnapshotEnrichmentPatch> => {
      const loaded = await ensureInventory();
      return { slashCommands: loaded.slashCommands };
    },
    accountModels: async (): Promise<SnapshotEnrichmentPatch> => {
      const loaded = await ensureInventory();
      const models = loaded.models.map((model) => {
        const capabilities = loaded.capabilitiesBySlug?.[model.slug];
        return capabilities ? { ...model, capabilities } : model;
      });
      return {
        models,
        status: "ready",
      };
    },
  };
}

function createSnapshotHandle(
  initial: ManagedSnapshotState,
  enrichers: ManagedSnapshotEnrichers,
): SubstrateManagedSnapshotHandle {
  let state = initial;
  let inFlight: Promise<ManagedSnapshotState> | null = null;

  const runPipeline = async (): Promise<ManagedSnapshotState> => {
    if (inFlight) {
      return inFlight;
    }
    inFlight = runManagedSnapshotPipeline(state, enrichers).then((next) => {
      state = next;
      inFlight = null;
      return next;
    });
    return inFlight;
  };

  return {
    getState: () => state,
    run: () => runPipeline(),
    refresh: async () => {
      state = beginManagedSnapshotRefresh(state);
      return runPipeline();
    },
  };
}

/**
 * Full substrate OpenCode ProviderDriver — first real driver on the flagged path.
 * Implements the T3 managed snapshot lifecycle (pending → enrich →
 * capabilities / skills / slash / account models).
 */
export function createOpenCodeSubstrateDriver(
  hooks: OpenCodeDriverHooks = defaultOpenCodeDriverHooks,
): SubstrateProviderDriver {
  return {
    driverKind: "opencode",
    metadata: {
      displayName: "OpenCode",
      supportsMultipleInstances: true,
      implementation: "full",
    },
    defaultConfig: () => ({}),
    create: async (input: SubstrateDriverCreateInput): Promise<SubstrateProviderInstance> => {
      const displayName = input.displayName ?? "OpenCode";
      const pending = createPendingSnapshot({
        driver: "opencode",
        instanceId: input.instanceId,
        displayName,
        enabled: input.enabled,
      });
      const handle = createSnapshotHandle(
        createManagedSnapshotState(pending),
        buildEnrichers(input.config, hooks),
      );

      return {
        instanceId: input.instanceId,
        driverKind: "opencode",
        displayName,
        enabled: input.enabled,
        implementation: "full",
        snapshot: handle,
        dispose: async () => {
          // No long-lived processes in the Phase 3 scaffold.
        },
      };
    },
  };
}
