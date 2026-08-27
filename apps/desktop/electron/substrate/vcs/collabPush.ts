/**
 * Phase 4d — collab overlay push through GitVcsDriver push-safety.
 */

import type { GitSyncPushResult } from "../../../../../shared/electronApiTypes";
import { evaluatePushSafety } from "./pushSafety";

export interface CollabPushGitRunner {
  readonly runGit: (
    args: string[],
    options: {
      cwd: string;
      extraHeader?: string;
      timeoutMs?: number;
    },
  ) => Promise<{ success: boolean; error?: string; stdout?: string; stderr?: string }>;
  readonly getCurrentBranch: (projectPath: string) => Promise<string | null>;
  readonly getUpstreamRef: (projectPath: string) => Promise<string | null>;
}

export interface CollabPushWithSafetyInput {
  readonly projectPath: string;
  readonly remote: string;
  readonly branch: string;
  readonly extraHeader?: string;
  readonly runner: CollabPushGitRunner;
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

/**
 * Push with Phase 4e safety — refuses mismatched feature→upstream refspecs.
 */
export async function pushWithSafety(input: CollabPushWithSafetyInput): Promise<GitSyncPushResult> {
  const { projectPath, remote, branch, extraHeader, runner } = input;
  const currentBranch = (await runner.getCurrentBranch(projectPath)) ?? branch;
  const upstreamRef = await runner.getUpstreamRef(projectPath);

  if (!upstreamRef) {
    const push = await runner.runGit(["push", "-u", remote, `HEAD:refs/heads/${currentBranch}`], {
      cwd: projectPath,
      extraHeader,
      timeoutMs: 120_000,
    });
    if (!push.success) {
      return { success: false, remote, branch, error: push.error };
    }
    return {
      success: true,
      remote,
      branch: currentBranch,
      currentBranch,
      pushed: true,
    };
  }

  const parsed = parseUpstreamRef(upstreamRef);
  if (!parsed) {
    return {
      success: false,
      remote,
      branch,
      error: `Cannot parse upstream ref "${upstreamRef}".`,
    };
  }

  const decision = evaluatePushSafety({
    localBranch: currentBranch,
    upstreamRemoteName: parsed.remoteName,
    upstreamBranchName: parsed.branchName,
    upstreamRef,
  });

  if (decision.action === "refuse_mismatched_upstream") {
    return {
      success: false,
      remote,
      branch: currentBranch,
      currentBranch,
      error: decision.reason,
      refused: true,
      refusalReason: decision.reason,
      suggestedPublishBranch: decision.suggestedPublishBranch,
    };
  }

  const push = await runner.runGit(
    ["push", decision.remoteName, decision.refspec],
    { cwd: projectPath, extraHeader, timeoutMs: 120_000 },
  );
  if (!push.success) {
    return { success: false, remote: decision.remoteName, branch: currentBranch, error: push.error };
  }
  return {
    success: true,
    remote: decision.remoteName,
    branch: currentBranch,
    currentBranch,
    pushed: true,
  };
}
