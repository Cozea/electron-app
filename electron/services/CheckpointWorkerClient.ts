/**
 * In-process checkpoint client (Phase 4b).
 *
 * Replaces the forked `checkpoint-worker` child — same API, direct calls into
 * `checkpointOps.ts` via `inProcessCheckpointOps`.
 */

import type {
  CheckpointWorkerMethod,
  CheckpointWorkerParams,
  CheckpointWorkerResult,
} from "../substrate/vcs/checkpointProtocol";
import { executeInProcessCheckpointOp } from "../substrate/vcs/inProcessCheckpointOps";

export class CheckpointWorkerClient {
  private static instance: CheckpointWorkerClient | null = null;

  public static getInstance(): CheckpointWorkerClient {
    if (!CheckpointWorkerClient.instance) {
      CheckpointWorkerClient.instance = new CheckpointWorkerClient();
    }
    return CheckpointWorkerClient.instance;
  }

  private constructor() {}

  public async captureCheckpoint(
    params: CheckpointWorkerParams<"captureCheckpoint">,
  ): Promise<CheckpointWorkerResult<"captureCheckpoint">> {
    return this.request("captureCheckpoint", params);
  }

  public async diffCheckpoints(
    params: CheckpointWorkerParams<"diffCheckpoints">,
  ): Promise<CheckpointWorkerResult<"diffCheckpoints">> {
    return this.request("diffCheckpoints", params);
  }

  public async readCheckpointFilePair(
    params: CheckpointWorkerParams<"readCheckpointFilePair">,
  ): Promise<CheckpointWorkerResult<"readCheckpointFilePair">> {
    return this.request("readCheckpointFilePair", params);
  }

  public async deleteCheckpointRefs(
    params: CheckpointWorkerParams<"deleteCheckpointRefs">,
  ): Promise<CheckpointWorkerResult<"deleteCheckpointRefs">> {
    return this.request("deleteCheckpointRefs", params);
  }

  public async deleteAllCheckpointRefs(
    params: CheckpointWorkerParams<"deleteAllCheckpointRefs">,
  ): Promise<CheckpointWorkerResult<"deleteAllCheckpointRefs">> {
    return this.request("deleteAllCheckpointRefs", params);
  }

  public async getHeadDiffStats(
    params: CheckpointWorkerParams<"getHeadDiffStats">,
  ): Promise<CheckpointWorkerResult<"getHeadDiffStats">> {
    return this.request("getHeadDiffStats", params);
  }

  public async listChanges(
    params: CheckpointWorkerParams<"listChanges">,
  ): Promise<CheckpointWorkerResult<"listChanges">> {
    return this.request("listChanges", params);
  }

  public async readChangesPatch(
    params: CheckpointWorkerParams<"readChangesPatch">,
  ): Promise<CheckpointWorkerResult<"readChangesPatch">> {
    return this.request("readChangesPatch", params);
  }

  public async readChanges(
    params: CheckpointWorkerParams<"readChanges">,
  ): Promise<CheckpointWorkerResult<"readChanges">> {
    return this.request("readChanges", params);
  }

  public async request<TMethod extends CheckpointWorkerMethod>(
    method: TMethod,
    params: CheckpointWorkerParams<TMethod>,
  ): Promise<CheckpointWorkerResult<TMethod>> {
    return executeInProcessCheckpointOp(method, params);
  }

  /** No-op — retained for API compatibility after worker removal. */
  public dispose(): void {
    // in-process; nothing to tear down
  }
}
