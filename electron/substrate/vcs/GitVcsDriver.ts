/**
 * `GitVcsDriver` — Phase 4a adapter wrapping existing Cozea `GitCore` (do not delete GitCore yet).
 *
 * Capability stubs for checkpoints route through the shared Changes capture path
 * so we do not leave a third stack. Push uses `evaluatePushSafety` before any
 * `HEAD:<upstream>` refspec.
 */

import type {
  VcsChangesReadInput,
  VcsChangesReadResult,
  VcsCheckpointCaptureResult,
  VcsCheckpointDeleteResult,
  VcsCheckpointDiffResult,
  VcsCheckpointOps,
  VcsCaptureCheckpointInput,
  VcsDeleteCheckpointRefsInput,
  VcsDiffCheckpointsInput,
  VcsDriver,
  VcsDriverCapabilities,
  VcsHeadDiffStatsInput,
  VcsHeadDiffStatsResult,
  VcsPushResult,
  VcsRemoveWorktreeInput,
  VcsStatusDetails,
} from "./VcsDriver";
import { evaluatePushSafety } from "./pushSafety";
import { invalidateVcsStatus } from "./statusInvalidation";

/**
 * Minimal port over Cozea GitCore / desktop git helpers.
 * Kept Promise-based so Electron main and tests can inject without Effect.
 */
export interface GitCorePort {
  readonly statusDetails: (cwd: string) => Promise<{
    branch: string | null;
    upstreamRef: string | null;
    hasUpstream: boolean;
    aheadCount: number;
    behindCount: number;
    hasWorkingTreeChanges?: boolean;
    isRepo?: boolean;
  }>;
  /**
   * Low-level push. Adapter applies push-safety before calling when upstream is set.
   * `refspec` is omitted for bare `git push` / `-u` publish flows.
   */
  readonly push: (input: {
    cwd: string;
    remoteName?: string;
    refspec?: string;
    setUpstream?: boolean;
    branch?: string;
  }) => Promise<{
    status: "pushed" | "skipped_up_to_date";
    branch: string;
    upstreamBranch?: string;
    setUpstream?: boolean;
  }>;
  readonly removeWorktree?: (input: VcsRemoveWorktreeInput) => Promise<void>;
  readonly resolvePushRemoteName?: (cwd: string, branch: string) => Promise<string | null>;
  readonly pullCurrentBranch?: (cwd: string) => Promise<{ readonly status: string; readonly branch?: string }>;
  readonly listBranches?: (input: { readonly cwd: string; readonly includeRemote?: boolean }) => Promise<unknown>;
  readonly createWorktree?: (input: unknown) => Promise<unknown>;
  readonly createBranch?: (input: unknown) => Promise<unknown>;
  readonly checkoutBranch?: (input: unknown) => Promise<unknown>;
  readonly initRepo?: (input: unknown) => Promise<unknown>;
}

export interface GitVcsCheckpointBackend {
  readonly captureCheckpoint: (
    input: VcsCaptureCheckpointInput,
  ) => Promise<VcsCheckpointCaptureResult>;
  readonly diffCheckpoints: (
    input: VcsDiffCheckpointsInput,
  ) => Promise<VcsCheckpointDiffResult>;
  readonly deleteCheckpointRefs: (
    input: VcsDeleteCheckpointRefsInput,
  ) => Promise<VcsCheckpointDeleteResult>;
  readonly readChanges: (input: VcsChangesReadInput) => Promise<VcsChangesReadResult>;
  readonly getHeadDiffStats: (
    input: VcsHeadDiffStatsInput,
  ) => Promise<VcsHeadDiffStatsResult>;
}

export interface GitVcsDriverOptions {
  readonly git: GitCorePort;
  readonly checkpoints?: GitVcsCheckpointBackend;
  readonly capabilities?: Partial<VcsDriverCapabilities>;
}

function parseUpstreamRef(
  upstreamRef: string,
): { remoteName: string; branchName: string } | null {
  const trimmed = upstreamRef.trim();
  const separatorIndex = trimmed.indexOf("/");
  if (separatorIndex <= 0 || separatorIndex === trimmed.length - 1) {
    return null;
  }
  const remoteName = trimmed.slice(0, separatorIndex).trim();
  const branchName = trimmed.slice(separatorIndex + 1).trim();
  if (!remoteName || !branchName) {
    return null;
  }
  return { remoteName, branchName };
}

const DEFAULT_CAPABILITIES: VcsDriverCapabilities = {
  status: true,
  refs: false,
  worktrees: true,
  checkpoints: true,
  push: true,
  ignore: false,
  init: false,
};

/**
 * Adapter implementing `VcsDriver` on top of existing GitCore-shaped ops.
 */
export class GitVcsDriver implements VcsDriver {
  readonly capabilities: VcsDriverCapabilities;
  readonly checkpoints?: VcsCheckpointOps;

  private readonly git: GitCorePort;

  constructor(options: GitVcsDriverOptions) {
    this.git = options.git;
    this.capabilities = {
      ...DEFAULT_CAPABILITIES,
      ...options.capabilities,
      checkpoints: Boolean(options.checkpoints) && (options.capabilities?.checkpoints ?? true),
      worktrees: Boolean(options.git.removeWorktree) && (options.capabilities?.worktrees ?? true),
    };
    if (options.checkpoints) {
      this.checkpoints = options.checkpoints;
    }
  }

  invalidateStatus(cwd: string): void {
    invalidateVcsStatus(cwd, "all");
  }

  async statusDetails(cwd: string): Promise<VcsStatusDetails> {
    const details = await this.git.statusDetails(cwd);
    return {
      isRepo: details.isRepo ?? true,
      branch: details.branch,
      upstreamRef: details.upstreamRef,
      hasUpstream: details.hasUpstream,
      aheadCount: details.aheadCount,
      behindCount: details.behindCount,
      hasWorkingTreeChanges: details.hasWorkingTreeChanges ?? false,
    };
  }

  async pushCurrentBranch(
    cwd: string,
    fallbackBranch: string | null,
  ): Promise<VcsPushResult> {
    const details = await this.statusDetails(cwd);
    const branch = details.branch ?? fallbackBranch;
    if (!branch) {
      return {
        status: "refused_mismatched_upstream",
        branch: fallbackBranch ?? "HEAD",
        refusalReason: "Cannot push from detached HEAD.",
      };
    }

    const hasNoLocalDelta = details.aheadCount === 0 && details.behindCount === 0;
    if (hasNoLocalDelta && details.hasUpstream) {
      return {
        status: "skipped_up_to_date",
        branch,
        ...(details.upstreamRef ? { upstreamBranch: details.upstreamRef } : {}),
      };
    }

    if (!details.hasUpstream || !details.upstreamRef) {
      const remoteName =
        (await this.git.resolvePushRemoteName?.(cwd, branch)) ?? "origin";
      const result = await this.git.push({
        cwd,
        remoteName,
        setUpstream: true,
        branch,
        refspec: `HEAD:refs/heads/${branch}`,
      });
      this.invalidateStatus(cwd);
      return {
        status: result.status,
        branch: result.branch,
        upstreamBranch: result.upstreamBranch ?? `${remoteName}/${branch}`,
        setUpstream: true,
      };
    }

    const parsed = parseUpstreamRef(details.upstreamRef);
    if (!parsed) {
      return {
        status: "refused_mismatched_upstream",
        branch,
        refusalReason: `Cannot parse upstream ref "${details.upstreamRef}".`,
      };
    }

    const decision = evaluatePushSafety({
      localBranch: branch,
      upstreamRemoteName: parsed.remoteName,
      upstreamBranchName: parsed.branchName,
      upstreamRef: details.upstreamRef,
    });

    if (decision.action === "refuse_mismatched_upstream") {
      return {
        status: "refused_mismatched_upstream",
        branch,
        upstreamBranch: details.upstreamRef,
        refusalReason: decision.reason,
        suggestedPublishBranch: decision.suggestedPublishBranch,
        mergeBaseToRecord: decision.mergeBaseToRecord,
      };
    }

    const result = await this.git.push({
      cwd,
      remoteName: decision.remoteName,
      refspec: decision.refspec,
      branch,
    });
    this.invalidateStatus(cwd);
    return {
      status: result.status,
      branch: result.branch,
      upstreamBranch: result.upstreamBranch ?? details.upstreamRef,
      setUpstream: false,
    };
  }

  async removeWorktree(input: VcsRemoveWorktreeInput): Promise<void> {
    if (!this.git.removeWorktree) {
      throw new Error("GitVcsDriver.removeWorktree is not wired to GitCore yet.");
    }
    await this.git.removeWorktree(input);
    this.invalidateStatus(input.cwd);
  }

  async pullCurrentBranch(cwd: string): Promise<{ readonly status: string; readonly branch?: string }> {
    if (!this.git.pullCurrentBranch) {
      throw new Error("GitVcsDriver.pullCurrentBranch is not wired.");
    }
    const result = await this.git.pullCurrentBranch(cwd);
    invalidateVcsStatus(cwd, "remote");
    return result;
  }

  async listBranches(input: { readonly cwd: string; readonly includeRemote?: boolean }): Promise<unknown> {
    if (!this.git.listBranches) {
      throw new Error("GitVcsDriver.listBranches is not wired.");
    }
    return this.git.listBranches(input);
  }

  async createWorktree(input: unknown): Promise<unknown> {
    if (!this.git.createWorktree) {
      throw new Error("GitVcsDriver.createWorktree is not wired.");
    }
    const result = await this.git.createWorktree(input);
    if (input && typeof input === "object" && "cwd" in input && typeof input.cwd === "string") {
      this.invalidateStatus(input.cwd);
    }
    return result;
  }

  async createBranch(input: unknown): Promise<unknown> {
    if (!this.git.createBranch) {
      throw new Error("GitVcsDriver.createBranch is not wired.");
    }
    const result = await this.git.createBranch(input);
    if (input && typeof input === "object" && "cwd" in input && typeof input.cwd === "string") {
      this.invalidateStatus(input.cwd);
    }
    return result;
  }

  async checkoutBranch(input: unknown): Promise<unknown> {
    if (!this.git.checkoutBranch) {
      throw new Error("GitVcsDriver.checkoutBranch is not wired.");
    }
    const result = await this.git.checkoutBranch(input);
    if (input && typeof input === "object" && "cwd" in input && typeof input.cwd === "string") {
      this.invalidateStatus(input.cwd);
    }
    return result;
  }

  async initRepo(input: unknown): Promise<unknown> {
    if (!this.git.initRepo) {
      throw new Error("GitVcsDriver.initRepo is not wired.");
    }
    const result = await this.git.initRepo(input);
    if (input && typeof input === "object" && "cwd" in input && typeof input.cwd === "string") {
      this.invalidateStatus(input.cwd);
    }
    return result;
  }
}

/** Factory helper for tests and Effect wiring layers. */
export function createGitVcsDriver(options: GitVcsDriverOptions): GitVcsDriver {
  return new GitVcsDriver(options);
}
