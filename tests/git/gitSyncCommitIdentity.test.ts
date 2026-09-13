import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

/**
 * Commits made through GitSyncService carry the person's own Git identity. When Git
 * names nobody, Cozea's identity goes to Cozea's commands through the environment: the
 * repository's config is never rewritten.
 */

const runGitCommand = vi.hoisted(() => vi.fn());

vi.mock("../../apps/desktop/electron/gitRuntime", () => ({ runGitCommand }));

const result = (success: boolean, stdout = "") => ({
  success,
  exitCode: success ? 0 : 1,
  stdout,
  stderr: "",
  executablePath: "/usr/bin/git",
  source: "system" as const,
});

describe("GitSyncService commit identity", () => {
  let projectPath: string;
  let identity: { name?: string; email?: string };

  beforeEach(() => {
    projectPath = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-gitsync-identity-"));
    identity = {};

    runGitCommand.mockImplementation(async (args: string[]) => {
      if (args[0] === "config" && args[1] === "--get") {
        const value = args[2] === "user.name" ? identity.name : identity.email;
        return value ? result(true, `${value}\n`) : result(false);
      }
      if (args.includes("--is-inside-work-tree")) return result(true, "true");
      if (args.includes("--git-dir")) return result(true, path.join(projectPath, ".git"));
      if (args.includes("--show-toplevel")) return result(true, projectPath);
      if (args.includes("--show-current")) return result(true, "main");
      if (args[0] === "status") return result(true, " M notes.md\n");
      if (args[0] === "rev-parse") return result(true, "abc123");
      return result(true);
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
    fs.rmSync(projectPath, { recursive: true, force: true });
  });

  async function loadService() {
    // Re-imported per test so the singleton's state never leaks across cases.
    vi.resetModules();
    const { GitSyncService } = await import("../../apps/desktop/electron/services/gitSyncService");
    return GitSyncService.getInstance();
  }

  function callsFor(subcommand: string) {
    return runGitCommand.mock.calls.filter(([args]) => args[0] === subcommand);
  }

  it("commits with the person's identity and never writes one into the repository", async () => {
    identity = { name: "Person", email: "person@example.com" };
    const service = await loadService();

    expect((await service.commitAll({ projectPath, message: "save" })).success).toBe(true);
    const [commit] = callsFor("commit");
    expect(commit).toBeDefined();
    expect(commit?.[1]?.env).toBeUndefined();
    expect(callsFor("config").every(([args]) => args[1] === "--get")).toBe(true);
  });

  it("gives Cozea's identity to its own commands when Git names nobody", async () => {
    const service = await loadService();

    expect((await service.commitAll({ projectPath, message: "save" })).success).toBe(true);
    const [commit] = callsFor("commit");
    expect(commit?.[1]?.env).toEqual({
      GIT_AUTHOR_NAME: "Cozea Sync",
      GIT_COMMITTER_NAME: "Cozea Sync",
      GIT_AUTHOR_EMAIL: "sync@cozea.local",
      GIT_COMMITTER_EMAIL: "sync@cozea.local",
    });
    expect(callsFor("config").every(([args]) => args[1] === "--get")).toBe(true);
  });
});
