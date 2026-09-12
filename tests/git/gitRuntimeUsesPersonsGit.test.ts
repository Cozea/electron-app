import fs from "node:fs";
import os from "node:os";
import path from "node:path";

import { afterEach, beforeEach, describe, expect, it } from "vitest";

import { mergeTreeWithGit, runGitCommand } from "../../apps/desktop/electron/gitRuntime";

/**
 * The app runs Git with the person's own setup, as their terminal does, so cloning a
 * private repository uses their credential helper. Cozea's scratch repositories still
 * never sign or run hooks, whatever the person's config says.
 */

const ENV_KEYS = ["HOME", "XDG_CONFIG_HOME", "GIT_CONFIG_GLOBAL"] as const;

describe("the app's Git", () => {
  const saved = new Map<string, string | undefined>();
  let home: string;

  beforeEach(() => {
    for (const key of ENV_KEYS) saved.set(key, process.env[key]);
    home = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-git-home-"));
    process.env.HOME = home;
    delete process.env.XDG_CONFIG_HOME;
    delete process.env.GIT_CONFIG_GLOBAL;
  });

  afterEach(() => {
    for (const [key, value] of saved) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
    fs.rmSync(home, { recursive: true, force: true });
  });

  it("reads the person's own Git config, credential helper included", async () => {
    fs.writeFileSync(
      path.join(home, ".gitconfig"),
      '[user]\n\tname = Person From Home\n[credential "https://example.test"]\n\thelper = store\n',
    );

    const name = await runGitCommand(["config", "--global", "--get", "user.name"], { cwd: home });
    expect(name.stdout.trim()).toBe("Person From Home");
    const helper = await runGitCommand(
      ["config", "--get-urlmatch", "credential.helper", "https://example.test/team/app.git"],
      { cwd: home },
    );
    expect(helper.stdout.trim()).toBe("store");
  });

  it("never signs or runs hooks in its own scratch repositories", async () => {
    const hooks = path.join(home, "hooks");
    fs.mkdirSync(hooks);
    fs.writeFileSync(path.join(hooks, "pre-commit"), "#!/bin/sh\nexit 1\n", { mode: 0o755 });
    fs.writeFileSync(
      path.join(home, ".gitconfig"),
      `[commit]\n\tgpgsign = true\n[gpg]\n\tprogram = false\n[core]\n\thooksPath = ${hooks}\n`,
    );

    // Edits far enough apart that Git merges them cleanly.
    const preview = await mergeTreeWithGit({
      baseFiles: [{ path: "notes.md", content: "a\nb\nc\nd\ne\n" }],
      localFiles: [{ path: "notes.md", content: "A\nb\nc\nd\ne\n" }],
      cloudFiles: [{ path: "notes.md", content: "a\nb\nc\nd\nE\n" }],
    });
    expect(preview.error).toBeUndefined();
    expect(preview.success).toBe(true);
    expect(preview.mergedFiles).toEqual([{ path: "notes.md", content: "A\nb\nc\nd\nE\n" }]);
  });
});
