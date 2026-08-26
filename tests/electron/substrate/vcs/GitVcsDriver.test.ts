import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createGitVcsDriver,
  type GitCorePort,
} from "../../../../electron/substrate/vcs/GitVcsDriver";
import {
  invalidateVcsStatus,
  resetVcsStatusInvalidationForTests,
  subscribeVcsStatusInvalidation,
} from "../../../../electron/substrate/vcs/statusInvalidation";
import { readSubstrateVcsFlags } from "../../../../electron/substrate/flags";
import { SUBSTRATE_VCS_FLAG } from "../../../../electron/substrate/constants";

describe("readSubstrateVcsFlags", () => {
  it("defaults off", () => {
    const flags = readSubstrateVcsFlags({});
    expect(flags.enabled).toBe(false);
    expect(flags.flagId).toBe(SUBSTRATE_VCS_FLAG);
  });

  it("enables via COZEA_SUBSTRATE_VCS=1", () => {
    expect(readSubstrateVcsFlags({ COZEA_SUBSTRATE_VCS: "1" }).enabled).toBe(true);
  });
});

describe("invalidateVcsStatus", () => {
  afterEach(() => {
    resetVcsStatusInvalidationForTests();
  });

  it("notifies all subscribers (single bus for agent + Changes + collab)", () => {
    const a = vi.fn();
    const b = vi.fn();
    const unsubA = subscribeVcsStatusInvalidation(a);
    subscribeVcsStatusInvalidation(b);

    invalidateVcsStatus("/tmp/repo", "local");

    expect(a).toHaveBeenCalledWith("/tmp/repo", "local");
    expect(b).toHaveBeenCalledWith("/tmp/repo", "local");
    unsubA();
    invalidateVcsStatus("/tmp/repo", "all");
    expect(a).toHaveBeenCalledTimes(1);
    expect(b).toHaveBeenCalledTimes(2);
  });
});

describe("GitVcsDriver.pushCurrentBranch push-safety", () => {
  afterEach(() => {
    resetVcsStatusInvalidationForTests();
  });

  it("refuses mismatched feature→upstream without calling git.push", async () => {
    const push = vi.fn();
    const git: GitCorePort = {
      statusDetails: async () => ({
        branch: "feature/widgets",
        upstreamRef: "origin/main",
        hasUpstream: true,
        aheadCount: 2,
        behindCount: 0,
        hasWorkingTreeChanges: false,
        isRepo: true,
      }),
      push,
    };

    const driver = createGitVcsDriver({ git });
    const result = await driver.pushCurrentBranch("/tmp/repo", null);

    expect(result.status).toBe("refused_mismatched_upstream");
    expect(result.suggestedPublishBranch).toBe("feature/widgets");
    expect(result.mergeBaseToRecord).toBe("main");
    expect(push).not.toHaveBeenCalled();
  });

  it("pushes matching upstream and invalidates status", async () => {
    const push = vi.fn(async () => ({
      status: "pushed" as const,
      branch: "main",
      upstreamBranch: "origin/main",
    }));
    const git: GitCorePort = {
      statusDetails: async () => ({
        branch: "main",
        upstreamRef: "origin/main",
        hasUpstream: true,
        aheadCount: 1,
        behindCount: 0,
        isRepo: true,
      }),
      push,
    };

    const invalidations: string[] = [];
    subscribeVcsStatusInvalidation((cwd) => {
      invalidations.push(cwd);
    });

    const driver = createGitVcsDriver({ git });
    const result = await driver.pushCurrentBranch("/tmp/repo", null);

    expect(result.status).toBe("pushed");
    expect(push).toHaveBeenCalledWith({
      cwd: "/tmp/repo",
      remoteName: "origin",
      refspec: "HEAD:refs/heads/main",
      branch: "main",
    });
    expect(invalidations).toEqual(["/tmp/repo"]);
  });
});
