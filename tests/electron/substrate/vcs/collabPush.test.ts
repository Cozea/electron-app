import { describe, expect, it } from "vitest";

import { pushWithSafety } from "../../../../apps/desktop/electron/substrate/vcs/collabPush";

describe("pushWithSafety (collab overlay)", () => {
  it("refuses mismatched feature→upstream pushes", async () => {
    const result = await pushWithSafety({
      projectPath: "/tmp/repo",
      remote: "origin",
      branch: "main",
      runner: {
        getCurrentBranch: async () => "feature/login",
        getUpstreamRef: async () => "origin/dev",
        runGit: async () => ({ success: true }),
      },
    });

    expect(result.success).toBe(false);
    expect(result.refused).toBe(true);
    expect(result.suggestedPublishBranch).toBe("feature/login");
    expect(result.error).toMatch(/Refusing to push/);
  });

  it("pushes safely when local branch matches upstream", async () => {
    const pushes: string[][] = [];
    const result = await pushWithSafety({
      projectPath: "/tmp/repo",
      remote: "origin",
      branch: "main",
      runner: {
        getCurrentBranch: async () => "main",
        getUpstreamRef: async () => "origin/main",
        runGit: async (args) => {
          pushes.push(args);
          return { success: true };
        },
      },
    });

    expect(result.success).toBe(true);
    expect(result.pushed).toBe(true);
    expect(pushes).toEqual([["push", "origin", "HEAD:refs/heads/main"]]);
  });
});
