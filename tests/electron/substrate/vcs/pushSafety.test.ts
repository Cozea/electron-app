import { describe, expect, it } from "vitest";

import {
  evaluatePushSafety,
  isAliasOfUpstreamHead,
  legacyUnsafeUpstreamRefspec,
} from "../../../../apps/desktop/electron/substrate/vcs/pushSafety";

describe("evaluatePushSafety (Phase 4e)", () => {
  it("allows push when local branch matches upstream head name", () => {
    const decision = evaluatePushSafety({
      localBranch: "main",
      upstreamRemoteName: "origin",
      upstreamBranchName: "main",
      upstreamRef: "origin/main",
    });
    expect(decision).toEqual({
      action: "allow_upstream_push",
      remoteName: "origin",
      refspec: "HEAD:refs/heads/main",
    });
  });

  it("refuses mismatched feature→upstream (would publish onto shared base)", () => {
    const decision = evaluatePushSafety({
      localBranch: "feature/widgets",
      upstreamRemoteName: "origin",
      upstreamBranchName: "dev",
      upstreamRef: "origin/dev",
    });
    expect(decision.action).toBe("refuse_mismatched_upstream");
    if (decision.action !== "refuse_mismatched_upstream") {
      return;
    }
    expect(decision.suggestedPublishBranch).toBe("feature/widgets");
    expect(decision.mergeBaseToRecord).toBe("dev");
    expect(decision.remoteName).toBe("origin");
    expect(decision.reason).toContain("feature/widgets");
    expect(decision.reason).toContain("origin/dev");
  });

  it("allows git-mangled alias tracking (T3 alias rule)", () => {
    const decision = evaluatePushSafety({
      localBranch: "upstream/effect-atom",
      upstreamRemoteName: "my-org",
      upstreamBranchName: "effect-atom",
      upstreamRef: "my-org/upstream/effect-atom",
    });
    expect(decision.action).toBe("allow_upstream_push");
  });

  it("documents the unsafe legacy refspec Cozea must not use on mismatch", () => {
    expect(legacyUnsafeUpstreamRefspec("dev")).toBe("HEAD:dev");
  });
});

describe("isAliasOfUpstreamHead", () => {
  it("treats exact name match as alias", () => {
    expect(isAliasOfUpstreamHead("main", "main", "origin/main")).toBe(true);
  });

  it("rejects plain feature tracking base branch", () => {
    expect(isAliasOfUpstreamHead("feature/x", "main", "origin/main")).toBe(false);
  });
});
