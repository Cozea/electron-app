/**
 * Phase 4b — in-process checkpoint ops (replaces forked checkpoint-worker).
 *
 * Single owner entrypoint for Changes UI capture/read/delete. Delegates to
 * `checkpointOps.ts` — unified ref namespace under `refs/cozea/checkpoints`.
 */

import {
  captureCheckpoint,
  deleteAllCheckpointRefs,
  deleteCheckpointRefs,
  diffCheckpoints,
  getHeadDiffStats,
  listChanges,
  readChanges,
  readChangesPatch,
  readCheckpointFilePair,
} from "./checkpointOps";

import type {
  CheckpointWorkerMethod,
  CheckpointWorkerParams,
  CheckpointWorkerResult,
} from "./checkpointProtocol";

export async function executeInProcessCheckpointOp<TMethod extends CheckpointWorkerMethod>(
  method: TMethod,
  params: CheckpointWorkerParams<TMethod>,
): Promise<CheckpointWorkerResult<TMethod>> {
  switch (method) {
    case "captureCheckpoint": {
      const p = params as CheckpointWorkerParams<"captureCheckpoint">;
      return (await captureCheckpoint(
        p.cwd,
        p.checkpointId,
        p.authorName,
        p.authorEmail,
      )) as CheckpointWorkerResult<TMethod>;
    }
    case "diffCheckpoints":
      return (await diffCheckpoints(
        params as CheckpointWorkerParams<"diffCheckpoints">,
      )) as CheckpointWorkerResult<TMethod>;
    case "readCheckpointFilePair":
      return (await readCheckpointFilePair(
        params as CheckpointWorkerParams<"readCheckpointFilePair">,
      )) as CheckpointWorkerResult<TMethod>;
    case "deleteCheckpointRefs": {
      const p = params as CheckpointWorkerParams<"deleteCheckpointRefs">;
      return (await deleteCheckpointRefs({
        cwd: p.cwd,
        checkpointIds: p.checkpointIds,
      })) as CheckpointWorkerResult<TMethod>;
    }
    case "deleteAllCheckpointRefs": {
      const p = params as CheckpointWorkerParams<"deleteAllCheckpointRefs">;
      return (await deleteAllCheckpointRefs(p.cwd)) as CheckpointWorkerResult<TMethod>;
    }
    case "getHeadDiffStats": {
      const p = params as CheckpointWorkerParams<"getHeadDiffStats">;
      return (await getHeadDiffStats(p.cwd, p.authorName)) as CheckpointWorkerResult<TMethod>;
    }
    case "listChanges":
      return (await listChanges(
        params as CheckpointWorkerParams<"listChanges">,
      )) as CheckpointWorkerResult<TMethod>;
    case "readChangesPatch":
      return (await readChangesPatch(
        params as CheckpointWorkerParams<"readChangesPatch">,
      )) as CheckpointWorkerResult<TMethod>;
    case "readChanges":
      return (await readChanges(
        params as CheckpointWorkerParams<"readChanges">,
      )) as CheckpointWorkerResult<TMethod>;
    default: {
      const _exhaustive: never = method;
      throw new Error(`Unknown checkpoint op: ${String(_exhaustive)}`);
    }
  }
}
