import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * `GitSyncService.getRepoMetadata` memoizes per project path for 500ms. The TTL
 * bounds staleness between reads, but says nothing about a write landing inside
 * the same window — and `ensureRepo` does exactly that: it reads metadata, runs
 * `git init`, then reads again, all well within 500ms. Without explicit
 * invalidation the second read replays the pre-init entry and the call reports
 * `isRepo: false` for a repo it just created.
 */

const runGitCommand = vi.hoisted(() => vi.fn());

vi.mock("../../apps/desktop/electron/gitRuntime", () => ({ runGitCommand }));

const ok = (stdout = "") => ({
  success: true,
  exitCode: 0,
  stdout,
  stderr: "",
  executablePath: "/usr/bin/git",
  source: "system" as const,
});

describe("GitSyncService repo metadata cache", () => {
  let projectPath: string;
  /** Flipped by `git init`, reported by `rev-parse --is-inside-work-tree`. */
  let isRepo: boolean;

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-gitsync-"));
    isRepo = false;

    runGitCommand.mockImplementation(async (args: string[]) => {
      const subcommand = args.find((arg) => !arg.startsWith("-")) ?? "";

      if (subcommand === "init") {
        isRepo = true;
        return ok();
      }
      if (args.includes("--is-inside-work-tree")) return ok(isRepo ? "true" : "false");
      if (args.includes("--git-dir")) return ok(path.join(projectPath, ".git"));
      if (args.includes("--show-toplevel")) return ok(projectPath);
      if (args.includes("--show-current")) return ok("main");
      if (subcommand === "rev-parse") return ok("abc123");
      return ok();
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  async function loadService() {
    // Re-imported per test so the singleton's cache never leaks across cases.
    vi.resetModules();
    const { GitSyncService } = await import(
      "../../apps/desktop/electron/services/gitSyncService"
    );
    return GitSyncService.getInstance();
  }

  it("reports isRepo after initializing a repo in the same TTL window", async () => {
    const service = await loadService();

    const result = await service.ensureRepo({ projectPath });

    expect(result.success).toBe(true);
    expect(result.isRepo).toBe(true);
  });

  it("does not serve pre-init metadata to a later call", async () => {
    const service = await loadService();

    await service.ensureRepo({ projectPath });
    // Same 500ms window as the ensureRepo above; commitAll bails out early when
    // it reads a stale `isRepo: false`.
    const commit = await service.commitAll({ projectPath, message: "sync" });

    expect(commit.error ?? "").not.toMatch(/not a git repository/i);
    expect(commit.success).toBe(true);
  });

  it("still caches read-only metadata lookups within the TTL", async () => {
    const service = await loadService();
    await service.ensureRepo({ projectPath });

    const before = runGitCommand.mock.calls.length;
    await service.getStatus({ projectPath });
    await service.getStatus({ projectPath });
    const probes = runGitCommand.mock.calls
      .slice(before)
      .filter(([args]: [string[]]) => args.includes("--is-inside-work-tree"));

    // Two getStatus calls; both read-only, so they share the entry ensureRepo
    // left behind. Invalidating too eagerly would probe once per call.
    expect(probes.length).toBeLessThanOrEqual(1);
  });
});
