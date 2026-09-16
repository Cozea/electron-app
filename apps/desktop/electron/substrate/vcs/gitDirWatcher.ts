/**
 * Watches a repository's Git directory so work done outside Cozea is noticed.
 *
 * Status invalidation otherwise fires only where Cozea itself writes a file, so
 * committing, checking out or rebasing in a terminal leaves the Changes list
 * and the header counts showing a moment that has passed. A commit does not
 * touch the working tree at all, so watching files would miss it either way;
 * the evidence is inside `.git`, where the branch ref moves, the index is
 * rewritten, and HEAD changes on a checkout.
 */

import fs from "node:fs";
import path from "node:path";

/**
 * Quiet period before reporting. One Git command touches several paths, and a
 * rebase touches them repeatedly, so this collapses a burst into one report and
 * holds off until the repository has stopped moving.
 */
const SETTLE_MS = 150;

/**
 * The real Git directory for a checkout, or null outside a repository.
 *
 * In a linked worktree or a submodule, `.git` is a file holding `gitdir: <path>`
 * rather than a directory, and the refs that move live at that path instead.
 */
export function resolveGitDir(repoPath: string): string | null {
  const dotGit = path.join(repoPath, ".git");

  let stat: fs.Stats | undefined;
  try {
    stat = fs.statSync(dotGit, { throwIfNoEntry: false });
  } catch {
    return null;
  }
  if (!stat) return null;
  if (stat.isDirectory()) return dotGit;
  if (!stat.isFile()) return null;

  try {
    const pointer = /^gitdir:\s*(.+)$/m.exec(fs.readFileSync(dotGit, "utf8"));
    if (!pointer) return null;
    const target = pointer[1].trim();
    if (!target) return null;
    return path.isAbsolute(target) ? target : path.resolve(repoPath, target);
  } catch {
    return null;
  }
}

/**
 * Reports Git activity in `repoPath` until the returned function is called.
 *
 * Returns a no-op disposer when the path is not a repository, or when the
 * platform refuses every watch, so callers need no special case for either.
 */
export function watchGitDir(repoPath: string, onChange: () => void): () => void {
  const gitDir = resolveGitDir(repoPath);
  if (!gitDir) return () => {};

  const watchers: fs.FSWatcher[] = [];
  let settleTimer: NodeJS.Timeout | null = null;
  let disposed = false;

  const report = (): void => {
    if (disposed) return;
    if (settleTimer) clearTimeout(settleTimer);
    settleTimer = setTimeout(() => {
      settleTimer = null;
      if (!disposed) onChange();
    }, SETTLE_MS);
  };

  const watch = (target: string, recursive: boolean): boolean => {
    try {
      // `persistent: false` keeps a watcher from holding the process open.
      const watcher = fs.watch(target, { recursive, persistent: false }, report);
      // A watched directory can be replaced or removed mid-operation; losing one
      // watcher must not take down the rest.
      watcher.on("error", () => {
        try {
          watcher.close();
        } catch {
          // already closed
        }
      });
      watchers.push(watcher);
      return true;
    } catch {
      return false;
    }
  };

  // The top level carries HEAD (checkout), index (staging), ORIG_HEAD and
  // packed-refs.
  watch(gitDir, false);

  // A commit moves refs/heads/<branch>, which a non-recursive watch of the top
  // level never reports. Recursive watching is macOS and Windows only, so fall
  // back to the directories that actually hold branch refs.
  const refsRoot = path.join(gitDir, "refs");
  if (!watch(refsRoot, true)) {
    watch(refsRoot, false);
    watch(path.join(refsRoot, "heads"), false);
    watch(path.join(refsRoot, "remotes"), false);
  }

  return () => {
    disposed = true;
    if (settleTimer) {
      clearTimeout(settleTimer);
      settleTimer = null;
    }
    for (const watcher of watchers) {
      try {
        watcher.close();
      } catch {
        // already closed
      }
    }
    watchers.length = 0;
  };
}
