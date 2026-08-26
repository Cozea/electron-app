import {
  beginManagedSnapshotRefresh,
  createManagedSnapshotState,
  createPendingSnapshot,
  runManagedSnapshotPipeline,
  type SnapshotEnrichmentPatch,
} from "../managedSnapshot";
import type {
  ManagedSnapshotState,
  SubstrateDriverCreateInput,
  SubstrateDriverKind,
  SubstrateManagedSnapshotHandle,
  SubstrateProviderDriver,
  SubstrateProviderInstance,
} from "../types";

interface LegacyAdapterSpec {
  readonly driverKind: SubstrateDriverKind;
  readonly displayName: string;
  readonly legacyRuntimeNote: string;
}

function createLegacySnapshotHandle(
  initial: ManagedSnapshotState,
  probePatch: SnapshotEnrichmentPatch,
): SubstrateManagedSnapshotHandle {
  let state = initial;
  let inFlight: Promise<ManagedSnapshotState> | null = null;

  const runPipeline = async (): Promise<ManagedSnapshotState> => {
    if (inFlight) {
      return inFlight;
    }
    inFlight = runManagedSnapshotPipeline(state, {
      probe: async () => probePatch,
      // Thin adapters skip deep enrichment — real work stays on the legacy path.
      capabilities: async () => ({}),
      skills: async () => ({}),
      slash: async () => ({}),
      accountModels: async () => ({ status: "ready" }),
    }).then((next) => {
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

function createLegacyAdapterDriver(spec: LegacyAdapterSpec): SubstrateProviderDriver {
  return {
    driverKind: spec.driverKind,
    metadata: {
      displayName: spec.displayName,
      supportsMultipleInstances: true,
      implementation: "legacy-adapter",
    },
    defaultConfig: () => ({}),
    create: async (input: SubstrateDriverCreateInput): Promise<SubstrateProviderInstance> => {
      const displayName = input.displayName ?? spec.displayName;
      const pending = createPendingSnapshot({
        driver: spec.driverKind,
        instanceId: input.instanceId,
        displayName,
        enabled: input.enabled,
      });
      const handle = createLegacySnapshotHandle(createManagedSnapshotState(pending), {
        installed: true,
        version: null,
        status: "ready",
        auth: { status: "unknown" },
        availability: "available",
        message: spec.legacyRuntimeNote,
        models: [],
      });

      return {
        instanceId: input.instanceId,
        driverKind: spec.driverKind,
        displayName,
        enabled: input.enabled,
        implementation: "legacy-adapter",
        snapshot: handle,
        dispose: async () => undefined,
      };
    },
  };
}

/** Cursor — historically closest to T3; thin adapter until a full substrate port. */
export const cursorLegacyAdapterDriver = createLegacyAdapterDriver({
  driverKind: "cursor",
  displayName: "Cursor",
  legacyRuntimeNote:
    "Substrate Cursor driver is a legacy adapter; live sessions still use assistant-runtime Cursor ACP.",
});

/** Claude — thin adapter wrapping the existing Claude Agent SDK path. */
export const claudeLegacyAdapterDriver = createLegacyAdapterDriver({
  driverKind: "claudeAgent",
  displayName: "Claude",
  legacyRuntimeNote:
    "Substrate Claude driver is a legacy adapter; live sessions still use assistant-runtime ClaudeAdapter.",
});

/**
 * Codex — thin adapter only. Deep parity (session runtime, home layout, app-server)
 * remains the largest Phase 3 gap — see docs/substrate-phase3-providers.md.
 */
export const codexLegacyAdapterDriver = createLegacyAdapterDriver({
  driverKind: "codex",
  displayName: "Codex",
  legacyRuntimeNote:
    "Substrate Codex driver is a legacy adapter; Codex deep parity is not on the flagged path yet.",
});

export const LEGACY_ADAPTER_DRIVERS: ReadonlyArray<SubstrateProviderDriver> = [
  cursorLegacyAdapterDriver,
  claudeLegacyAdapterDriver,
];
