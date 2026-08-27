/**
 * Phase 4e push-safety — refuse mismatched feature→upstream pushes.
 *
 * T3 `GitVcsDriver.pushCurrentBranch` detects when a local branch tracks a
 * differently named upstream (e.g. `git checkout -b feature origin/dev`) and
 * refuses writing feature commits onto that shared base via `HEAD:<upstream>`.
 * Upstream T3 then redirects publish to the feature's own branch name and
 * records `branch.<name>.gh-merge-base`; this helper exposes the **refusal**
 * decision so Cozea can gate the unsafe pattern in CI before full cutover.
 *
 * @see docs/substrate-phase4-vcs.md
 */

export interface PushSafetyInput {
  /** Local branch name (not detached). */
  readonly localBranch: string;
  /** Remote name portion of upstream (e.g. `origin`). */
  readonly upstreamRemoteName: string;
  /** Upstream head name without remote prefix (e.g. `dev` or `main`). */
  readonly upstreamBranchName: string;
  /** Full upstream ref (e.g. `origin/dev`). */
  readonly upstreamRef: string;
}

/**
 * Same-repo tracking that legitimately differs — e.g. local
 * `upstream/effect-atom` tracking remote head `effect-atom` where the branch
 * name ends in the upstream head and the upstream ref ends in the branch name
 * (T3 alias rule).
 */
export function isAliasOfUpstreamHead(
  localBranch: string,
  upstreamBranchName: string,
  upstreamRef: string,
): boolean {
  if (localBranch === upstreamBranchName) {
    return true;
  }
  return (
    localBranch.endsWith(`/${upstreamBranchName}`) &&
    upstreamRef.endsWith(`/${localBranch}`)
  );
}

export type PushSafetyDecision =
  | {
      readonly action: "allow_upstream_push";
      readonly remoteName: string;
      /** Safe refspec when names match (or alias). Prefer heads form over bare `HEAD:branch`. */
      readonly refspec: string;
    }
  | {
      readonly action: "refuse_mismatched_upstream";
      readonly reason: string;
      readonly suggestedPublishBranch: string;
      readonly mergeBaseToRecord: string;
      readonly remoteName: string;
    };

/**
 * Evaluate whether pushing the current branch to its configured upstream is safe.
 *
 * - Matching names / alias → allow push to that upstream head.
 * - Mismatched feature→base (e.g. `feature` tracking `origin/dev`) → **refuse**
 *   the `HEAD:<upstream>` pattern that would publish onto the shared base.
 */
export function evaluatePushSafety(input: PushSafetyInput): PushSafetyDecision {
  const localBranch = input.localBranch.trim();
  const upstreamBranchName = input.upstreamBranchName.trim();
  const upstreamRemoteName = input.upstreamRemoteName.trim();
  const upstreamRef = input.upstreamRef.trim();

  if (!localBranch || !upstreamBranchName || !upstreamRemoteName || !upstreamRef) {
    return {
      action: "refuse_mismatched_upstream",
      reason: "Incomplete branch/upstream identity for push-safety evaluation.",
      suggestedPublishBranch: localBranch || "HEAD",
      mergeBaseToRecord: upstreamBranchName || "unknown",
      remoteName: upstreamRemoteName || "origin",
    };
  }

  if (isAliasOfUpstreamHead(localBranch, upstreamBranchName, upstreamRef)) {
    return {
      action: "allow_upstream_push",
      remoteName: upstreamRemoteName,
      refspec: `HEAD:refs/heads/${upstreamBranchName}`,
    };
  }

  return {
    action: "refuse_mismatched_upstream",
    reason:
      `Refusing to push local branch "${localBranch}" onto upstream "${upstreamRef}". ` +
      `That upstream is a base/tracking ref, not this branch's publish target ` +
      `(mismatched feature→upstream). Publish "${localBranch}" instead.`,
    suggestedPublishBranch: localBranch,
    mergeBaseToRecord: upstreamBranchName,
    remoteName: upstreamRemoteName,
  };
}

/**
 * Build the unsafe Cozea legacy refspec for documentation/tests only.
 * Production paths must not use this when `evaluatePushSafety` refuses.
 */
export function legacyUnsafeUpstreamRefspec(upstreamBranchName: string): string {
  return `HEAD:${upstreamBranchName}`;
}
