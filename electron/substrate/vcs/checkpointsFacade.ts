/**
 * Phase 4b checkpoint consolidation facade.
 *
 * Cozea today has two capture stacks:
 * 1. Orchestration `CheckpointStore` (via GitCore execute)
 * 2. Changes UI `gitCheckpoints.ts` + `checkpoint-worker`
 *
 * This facade is the **single entry** Changes UI should use for reads while
 * 4b completes. When `cozea.substrate.vcs` is on, reads go through driver
 * checkpoint capability stubs (same underlying capture implementation —
 * no third stack). Prefer deprecation + facade over big-bang delete.
 *
 * @deprecated Direct `CheckpointWorkerClient` / `gitCheckpoints` imports from
 * product UI paths — route through `getChangesCheckpointReads()` instead.
 */

import type {
  VcsChangesReadInput,
  VcsChangesReadResult,
  VcsCheckpointOps,
  VcsHeadDiffStatsInput,
  VcsHeadDiffStatsResult,
} from "./VcsDriver";
import { isSubstrateVcsEnabled } from "../flags";

export interface ChangesCheckpointReads {
  readonly readChanges: (input: VcsChangesReadInput) => Promise<VcsChangesReadResult>;
  readonly getHeadDiffStats: (
    input: VcsHeadDiffStatsInput,
  ) => Promise<VcsHeadDiffStatsResult>;
}

export interface ChangesCheckpointBackend extends ChangesCheckpointReads {
  readonly captureCheckpoint?: VcsCheckpointOps["captureCheckpoint"];
  readonly diffCheckpoints?: VcsCheckpointOps["diffCheckpoints"];
  readonly deleteCheckpointRefs?: VcsCheckpointOps["deleteCheckpointRefs"];
}

let legacyBackend: ChangesCheckpointBackend | null = null;
let driverCheckpointOps: VcsCheckpointOps | null = null;

/**
 * Register the legacy Changes worker/gitCheckpoints backend (called once from Electron main).
 */
export function registerLegacyChangesCheckpointBackend(
  backend: ChangesCheckpointBackend,
): void {
  legacyBackend = backend;
}

/**
 * Register driver checkpoint ops when the flagged VcsDriver path is active.
 * Stubs may still delegate to the legacy backend — ownership is the entrypoint.
 */
export function registerDriverCheckpointOps(ops: VcsCheckpointOps | null): void {
  driverCheckpointOps = ops;
}

function requireLegacyBackend(): ChangesCheckpointBackend {
  if (!legacyBackend) {
    throw new Error(
      "Changes checkpoint backend is not registered. Call registerLegacyChangesCheckpointBackend during Electron boot.",
    );
  }
  return legacyBackend;
}

/**
 * Resolve the single Changes-UI checkpoint read port.
 * Flag off → legacy worker. Flag on → driver capability (stubs OK).
 */
export function getChangesCheckpointReads(
  env: NodeJS.ProcessEnv = process.env,
): ChangesCheckpointReads {
  if (isSubstrateVcsEnabled(env) && driverCheckpointOps) {
    return {
      readChanges: (input) => driverCheckpointOps!.readChanges(input),
      getHeadDiffStats: (input) => driverCheckpointOps!.getHeadDiffStats(input),
    };
  }
  return requireLegacyBackend();
}

/**
 * Build driver checkpoint stubs that delegate to the registered legacy backend.
 * Used so the flagged path has one owner without forking capture logic yet.
 */
export function createDelegatingCheckpointOps(
  backend: ChangesCheckpointBackend = requireLegacyBackend(),
): VcsCheckpointOps {
  return {
    captureCheckpoint: async (input) => {
      if (!backend.captureCheckpoint) {
        return { success: false, error: "captureCheckpoint not available on legacy backend." };
      }
      return backend.captureCheckpoint(input);
    },
    diffCheckpoints: async (input) => {
      if (!backend.diffCheckpoints) {
        return { success: false, error: "diffCheckpoints not available on legacy backend." };
      }
      return backend.diffCheckpoints(input);
    },
    deleteCheckpointRefs: async (input) => {
      if (!backend.deleteCheckpointRefs) {
        return { success: false, error: "deleteCheckpointRefs not available on legacy backend." };
      }
      return backend.deleteCheckpointRefs(input);
    },
    readChanges: (input) => backend.readChanges(input),
    getHeadDiffStats: (input) => backend.getHeadDiffStats(input),
  };
}

/** @internal test helper */
export function resetCheckpointFacadeForTests(): void {
  legacyBackend = null;
  driverCheckpointOps = null;
}
