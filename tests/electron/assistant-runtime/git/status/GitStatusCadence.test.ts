import { describe, expect, it } from "vitest";

import {
  DEFAULT_REMOTE_STATUS_REFRESH_MS,
  GitStatusCadenceController,
} from "../../../../../electron/assistant-runtime/git/status/GitStatusCadence.ts";
import {
  getGitStatusCadence,
  invalidateGitStatus,
  resetGitStatusCadenceForTests,
} from "../../../../../electron/assistant-runtime/git/status/gitStatusInvalidation.ts";

describe("GitStatusCadenceController", () => {
  it("always allows local refresh", () => {
    const cadence = new GitStatusCadenceController({ remoteRefreshIntervalMs: 30_000 });
    expect(cadence.shouldRefreshLocal("/repo")).toBe(true);
  });

  it("allows remote refresh when never fetched, then gates until interval elapses", () => {
    let now = 1_000;
    const cadence = new GitStatusCadenceController({
      remoteRefreshIntervalMs: 30_000,
      now: () => now,
    });

    expect(cadence.shouldRefreshRemote("/repo/a")).toBe(true);
    cadence.markRemoteRefreshed("/repo/a");
    expect(cadence.shouldRefreshRemote("/repo/a")).toBe(false);

    now += 29_999;
    expect(cadence.shouldRefreshRemote("/repo/a")).toBe(false);

    now += 1;
    expect(cadence.shouldRefreshRemote("/repo/a")).toBe(true);
  });

  it("force bypasses interval gating", () => {
    const cadence = new GitStatusCadenceController({ remoteRefreshIntervalMs: 60_000 });
    cadence.markRemoteRefreshed("/repo");
    expect(cadence.shouldRefreshRemote("/repo")).toBe(false);
    expect(cadence.shouldRefreshRemote("/repo", { force: true })).toBe(true);
  });

  it("invalidate(remote|all) makes remote refresh eligible immediately", () => {
    const cadence = new GitStatusCadenceController({
      remoteRefreshIntervalMs: DEFAULT_REMOTE_STATUS_REFRESH_MS,
    });
    cadence.markRemoteRefreshed("/repo");
    expect(cadence.shouldRefreshRemote("/repo")).toBe(false);

    cadence.invalidate("/repo", "remote");
    expect(cadence.shouldRefreshRemote("/repo")).toBe(true);

    cadence.markRemoteRefreshed("/repo");
    cadence.invalidate("/repo", "all");
    expect(cadence.shouldRefreshRemote("/repo")).toBe(true);
    expect(cadence.isLocalInvalidated("/repo")).toBe(true);
  });

  it("invalidate(local) does not unlock remote refresh", () => {
    const cadence = new GitStatusCadenceController({ remoteRefreshIntervalMs: 30_000 });
    cadence.markRemoteRefreshed("/repo");
    cadence.invalidate("/repo", "local");
    expect(cadence.isLocalInvalidated("/repo")).toBe(true);
    expect(cadence.shouldRefreshRemote("/repo")).toBe(false);
  });

  it("normalizes trailing slashes for cwd keys", () => {
    const cadence = new GitStatusCadenceController({ remoteRefreshIntervalMs: 30_000 });
    cadence.markRemoteRefreshed("/repo/");
    expect(cadence.shouldRefreshRemote("/repo")).toBe(false);
    cadence.invalidate("/repo");
    expect(cadence.shouldRefreshRemote("/repo/")).toBe(true);
  });
});

describe("invalidateGitStatus helper", () => {
  it("uses the shared cadence singleton other services can call", () => {
    resetGitStatusCadenceForTests();
    const cadence = getGitStatusCadence();
    cadence.markRemoteRefreshed("/workspace/project");
    expect(cadence.shouldRefreshRemote("/workspace/project")).toBe(false);

    invalidateGitStatus("/workspace/project");
    expect(cadence.shouldRefreshRemote("/workspace/project")).toBe(true);

    invalidateGitStatus("/workspace/project", "local");
    expect(cadence.isLocalInvalidated("/workspace/project")).toBe(true);

    resetGitStatusCadenceForTests();
  });
});
