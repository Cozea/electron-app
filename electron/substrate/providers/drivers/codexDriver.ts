import { spawnSync } from "node:child_process";

import {
  formatCodexCliUpgradeMessage,
  isCodexCliVersionSupported,
  parseCodexCliVersion,
} from "../../../assistant-runtime/provider/codexCliVersion.ts";
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

export interface CodexProbeResult {
  readonly installed: boolean;
  readonly version: string | null;
  readonly authenticated: boolean;
  readonly message?: string;
}

export interface CodexInventoryResult {
  readonly models: ReadonlyArray<SubstrateProviderModel>;
  readonly skills: ReadonlyArray<SubstrateProviderSkill>;
  readonly slashCommands: ReadonlyArray<SubstrateProviderSlashCommand>;
  readonly capabilitiesBySlug?: Readonly<Record<string, Readonly<Record<string, unknown>>>>;
}

export interface CodexDriverHooks {
  readonly probe: (config: Readonly<Record<string, unknown>>) => Promise<CodexProbeResult>;
  readonly loadInventory: (
    config: Readonly<Record<string, unknown>>,
  ) => Promise<CodexInventoryResult>;
}

const DEFAULT_CODEX_MODELS: ReadonlyArray<SubstrateProviderModel> = [
  { slug: "gpt-5.4", name: "GPT-5.4" },
  { slug: "gpt-5.4-mini", name: "GPT-5.4 Mini" },
  { slug: "gpt-5.3-codex", name: "GPT-5.3 Codex" },
  { slug: "gpt-5.3-codex-spark", name: "GPT-5.3 Codex Spark" },
  { slug: "gpt-5.2-codex", name: "GPT-5.2 Codex" },
  { slug: "gpt-5.2", name: "GPT-5.2" },
];

function resolveBinaryPath(config: Readonly<Record<string, unknown>>): string {
  const fromConfig = config.binaryPath;
  if (typeof fromConfig === "string" && fromConfig.trim().length > 0) {
    return fromConfig.trim();
  }
  return "codex";
}

function probeCodexCli(binaryPath: string): CodexProbeResult {
  const result = spawnSync(binaryPath, ["--version"], {
    encoding: "utf8",
    timeout: 5_000,
    shell: process.platform === "win32",
  });
  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`.trim();
  if (result.error || result.status !== 0) {
    return {
      installed: false,
      version: null,
      authenticated: false,
      message: result.error?.message ?? (output || "Codex CLI probe failed."),
    };
  }
  const version = parseCodexCliVersion(output);
  if (!version) {
    return {
      installed: true,
      version: null,
      authenticated: false,
      message: "Could not parse Codex CLI version.",
    };
  }
  if (!isCodexCliVersionSupported(version)) {
    return {
      installed: true,
      version,
      authenticated: false,
      message: formatCodexCliUpgradeMessage(version),
    };
  }
  return {
    installed: true,
    version,
    authenticated: false,
    message: "Codex CLI detected on substrate path (auth/session via app-server on live turn).",
  };
}

/** Default hooks: CLI version probe + static model inventory (no app-server spawn). */
export const defaultCodexDriverHooks: CodexDriverHooks = {
  probe: async (config) => probeCodexCli(resolveBinaryPath(config)),
  loadInventory: async () => ({
    models: DEFAULT_CODEX_MODELS,
    skills: [],
    slashCommands: [],
  }),
};

function buildEnrichers(
  config: Readonly<Record<string, unknown>>,
  hooks: CodexDriverHooks,
): ManagedSnapshotEnrichers {
  let inventory: CodexInventoryResult | null = null;

  const ensureInventory = async (): Promise<CodexInventoryResult> => {
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
          unavailableReason: result.message ?? "Codex CLI is not installed.",
          message: result.message ?? "Codex CLI is not installed.",
          auth: { status: "unknown" },
        };
      }
      if (result.message && result.message.includes("too old")) {
        return {
          installed: true,
          version: result.version,
          status: "warning",
          availability: "unavailable",
          unavailableReason: result.message,
          message: result.message,
          auth: { status: "unknown" },
        };
      }
      return {
        installed: true,
        version: result.version,
        status: "initializing",
        auth: {
          status: result.authenticated ? "authenticated" : "unauthenticated",
          type: "codex",
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
      return {
        models: loaded.models,
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
 * Full substrate Codex ProviderDriver — managed snapshot lifecycle with CLI probe
 * and model inventory. Live app-server sessions remain on assistant-runtime until
 * primary cutover; substrate RPC uses snapshot state for routing metadata.
 */
export function createCodexSubstrateDriver(
  hooks: CodexDriverHooks = defaultCodexDriverHooks,
): SubstrateProviderDriver {
  return {
    driverKind: "codex",
    metadata: {
      displayName: "Codex",
      supportsMultipleInstances: true,
      implementation: "full",
    },
    defaultConfig: () => ({ binaryPath: "codex" }),
    create: async (input: SubstrateDriverCreateInput): Promise<SubstrateProviderInstance> => {
      const displayName = input.displayName ?? "Codex";
      const pending = createPendingSnapshot({
        driver: "codex",
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
        driverKind: "codex",
        displayName,
        enabled: input.enabled,
        implementation: "full",
        snapshot: handle,
        dispose: async () => undefined,
      };
    },
  };
}
