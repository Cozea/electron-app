/**
 * Cozea Phase 4a scaffold — capability-shaped VCS driver (T3 `VcsDriver` / `GitVcsDriver`).
 *
 * This is the **agent/runtime substrate** contract. Collab overlay (journal, conflicts,
 * lanes) stays outside the driver but must call `invalidateVcsStatus` after cwd mutations
 * (Phase 4c/4d). Do not grow a permanent second status broadcaster.
 *
 * @see docs/substrate-phase4-vcs.md
 * @see docs/t3code-upgrade-path.md §3.8
 */

export interface VcsDriverCapabilities {
  readonly status: boolean;
  readonly refs: boolean;
  readonly worktrees: boolean;
  readonly checkpoints: boolean;
  readonly push: boolean;
  readonly ignore: boolean;
  readonly init: boolean;
}

export interface VcsStatusDetails {
  readonly isRepo: boolean;
  readonly branch: string | null;
  readonly upstreamRef: string | null;
  readonly hasUpstream: boolean;
  readonly aheadCount: number;
  readonly behindCount: number;
  readonly hasWorkingTreeChanges: boolean;
}

export interface VcsPushResult {
  readonly status: "pushed" | "skipped_up_to_date" | "refused_mismatched_upstream";
  readonly branch: string;
  readonly upstreamBranch?: string;
  readonly setUpstream?: boolean;
  readonly refusalReason?: string;
  /** When refusal suggests publishing the feature branch instead. */
  readonly suggestedPublishBranch?: string;
  /** Upstream head name to record as `branch.<name>.gh-merge-base` (T3 parity). */
  readonly mergeBaseToRecord?: string;
}

export interface VcsCaptureCheckpointInput {
  readonly cwd: string;
  readonly checkpointId: string;
  readonly authorName: string;
  readonly authorEmail?: string;
}

export interface VcsCheckpointCaptureResult {
  readonly success: boolean;
  readonly ref?: string;
  readonly commitOid?: string;
  readonly error?: string;
}

export interface VcsDiffCheckpointsInput {
  readonly cwd: string;
  readonly fromCheckpointId: string;
  readonly toCheckpointId: string;
}

export interface VcsCheckpointDiffResult {
  readonly success: boolean;
  readonly diff?: string;
  readonly error?: string;
}

export interface VcsDeleteCheckpointRefsInput {
  readonly cwd: string;
  readonly checkpointIds: ReadonlyArray<string>;
}

export interface VcsCheckpointDeleteResult {
  readonly success: boolean;
  readonly deletedRefs?: string[];
  readonly error?: string;
}

export type VcsChangesScope = "current" | "branch";

export interface VcsChangesReadInput {
  readonly cwd: string;
  readonly scope: VcsChangesScope;
}

export interface VcsChangesReadResult {
  readonly success: boolean;
  readonly scope: VcsChangesScope;
  readonly files: ReadonlyArray<{
    readonly path: string;
    readonly oldPath?: string;
    readonly status: "added" | "modified" | "deleted" | "renamed";
  }>;
  readonly diff?: string;
  readonly baseRef?: string;
  readonly headRef?: string;
  readonly error?: string;
}

export interface VcsHeadDiffStatsInput {
  readonly cwd: string;
  readonly authorName: string;
}

export interface VcsHeadDiffStatsResult {
  readonly success: boolean;
  readonly additions: number;
  readonly deletions: number;
  readonly changedFiles: number;
  readonly error?: string;
}

/**
 * Checkpoint capability on the driver — single capture/read owner for Phase 4b.
 * Orchestration CheckpointStore and Changes UI should converge here.
 */
export interface VcsCheckpointOps {
  readonly captureCheckpoint: (
    input: VcsCaptureCheckpointInput,
  ) => Promise<VcsCheckpointCaptureResult>;
  readonly diffCheckpoints: (
    input: VcsDiffCheckpointsInput,
  ) => Promise<VcsCheckpointDiffResult>;
  readonly deleteCheckpointRefs: (
    input: VcsDeleteCheckpointRefsInput,
  ) => Promise<VcsCheckpointDeleteResult>;
  /** Changes UI reads — same owner as capture (no third stack). */
  readonly readChanges: (input: VcsChangesReadInput) => Promise<VcsChangesReadResult>;
  readonly getHeadDiffStats: (
    input: VcsHeadDiffStatsInput,
  ) => Promise<VcsHeadDiffStatsResult>;
}

export interface VcsRemoveWorktreeInput {
  readonly cwd: string;
  readonly worktreePath: string;
  readonly force?: boolean;
}

export interface VcsDriver {
  readonly capabilities: VcsDriverCapabilities;

  /**
   * Local-first status details (no network). Remote refresh stays gated elsewhere
   * until Phase 4c `VcsStatusBroadcaster` lands.
   */
  readonly statusDetails: (cwd: string) => Promise<VcsStatusDetails>;

  /**
   * Push with Phase 4e safety: refuse mismatched feature→upstream
   * (`HEAD:<shared-base>`) instead of Cozea's legacy unsafe refspec.
   */
  readonly pushCurrentBranch: (
    cwd: string,
    fallbackBranch: string | null,
  ) => Promise<VcsPushResult>;

  /**
   * Fan-in status invalidation for agent + Changes + (documented) collab overlay.
   * Prefer `invalidateVcsStatus` from `statusInvalidation.ts` so all callers share one bus.
   */
  readonly invalidateStatus: (cwd: string) => void;

  readonly checkpoints?: VcsCheckpointOps;

  readonly removeWorktree?: (input: VcsRemoveWorktreeInput) => Promise<void>;

  /** Pull current branch (local-first). */
  readonly pullCurrentBranch?: (cwd: string) => Promise<{ readonly status: string; readonly branch?: string }>;

  /** List branches in repo. */
  readonly listBranches?: (input: {
    readonly cwd: string;
    readonly includeRemote?: boolean;
  }) => Promise<unknown>;

  readonly createWorktree?: (input: unknown) => Promise<unknown>;
  readonly createBranch?: (input: unknown) => Promise<unknown>;
  readonly checkoutBranch?: (input: unknown) => Promise<unknown>;
  readonly initRepo?: (input: unknown) => Promise<unknown>;
}
