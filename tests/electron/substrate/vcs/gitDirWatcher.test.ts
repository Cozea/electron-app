import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";

import {
  resolveGitDir,
  watchGitDir,
} from "../../../../apps/desktop/electron/substrate/vcs/gitDirWatcher";

/**
 * Committing in a terminal changes nothing in the working tree, so the only
 * evidence Cozea can see is inside `.git`. These cover finding that directory
 * — including the linked-worktree case where `.git` is a file — and reporting
 * a ref moving underneath it.
 */
describe("resolveGitDir", () => {
  let root: string;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-gitdir-"));
  });

  afterEach(() => {
    fs.rmSync(root, { recursive: true, force: true });
  });

  it("finds a normal repository's .git directory", () => {
    const gitDir = path.join(root, ".git");
    fs.mkdirSync(gitDir);

    expect(resolveGitDir(root)).toBe(gitDir);
  });

  it("follows the gitdir pointer a linked worktree leaves behind", () => {
    const real = path.join(root, "actual-git-dir");
    fs.mkdirSync(real);
    fs.writeFileSync(path.join(root, ".git"), `gitdir: ${real}\n`);

    expect(resolveGitDir(root)).toBe(real);
  });

  it("resolves a relative gitdir pointer against the checkout", () => {
    fs.mkdirSync(path.join(root, "nested"));
    fs.writeFileSync(path.join(root, ".git"), "gitdir: ./nested\n");

    expect(resolveGitDir(root)).toBe(path.join(root, "nested"));
  });

  it("returns null outside a repository", () => {
    expect(resolveGitDir(root)).toBeNull();
  });

  it("returns null for a .git file that points nowhere", () => {
    fs.writeFileSync(path.join(root, ".git"), "not a pointer\n");

    expect(resolveGitDir(root)).toBeNull();
  });
});

describe("watchGitDir", () => {
  let root: string;
  let disposers: Array<() => void>;

  beforeEach(() => {
    root = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-gitwatch-"));
    fs.mkdirSync(path.join(root, ".git", "refs", "heads"), { recursive: true });
    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/main\n");
    disposers = [];
  });

  afterEach(() => {
    for (const dispose of disposers) dispose();
    fs.rmSync(root, { recursive: true, force: true });
  });

  function watch(): { changes: () => number } {
    let count = 0;
    disposers.push(
      watchGitDir(root, () => {
        count += 1;
      }),
    );
    return { changes: () => count };
  }

  async function waitFor(
    predicate: () => boolean,
    poke?: () => void,
    timeoutMs = 8000,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      if (predicate()) return true;
      poke?.();
      // Wider than the watcher's settle window: a quicker poke would keep
      // resetting the debounce it is waiting on and nothing would ever fire.
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    return predicate();
  }

  it("reports a branch ref moving, as a commit does", async () => {
    const watcher = watch();
    const ref = path.join(root, ".git", "refs", "heads", "main");

    // Writing once and waiting flaked here, sitting silent for the whole
    // timeout in roughly half of runs under vitest. It reproduced neither in a
    // plain process nor in a worker thread, with `persistent` set either way,
    // so the cause was never pinned down -- do not read this retry as evidence
    // of a known race. Poking until the change is noticed holds whatever the
    // cause turns out to be. Keep the interval wider than SETTLE_MS, or the
    // pokes reset the debounce they are waiting on and nothing ever fires.
    const noticed = await waitFor(
      () => watcher.changes() > 0,
      () => fs.writeFileSync(ref, `${"1".repeat(40)}\n`),
    );

    expect(noticed).toBe(true);
  });

  it("stops reporting once disposed", async () => {
    let count = 0;
    const dispose = watchGitDir(root, () => {
      count += 1;
    });
    dispose();

    fs.writeFileSync(path.join(root, ".git", "HEAD"), "ref: refs/heads/other\n");
    await new Promise((resolve) => setTimeout(resolve, 400));

    expect(count).toBe(0);
  });

  it("hands back a usable disposer outside a repository", () => {
    const plain = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-notrepo-"));
    try {
      const dispose = watchGitDir(plain, () => {});
      expect(() => dispose()).not.toThrow();
    } finally {
      fs.rmSync(plain, { recursive: true, force: true });
    }
  });
});
