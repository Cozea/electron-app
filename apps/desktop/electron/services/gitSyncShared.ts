export const DEFAULT_BRANCH = "main";
export const DEFAULT_REMOTE = "origin";
export const DEFAULT_GIT_USER_NAME = "Cozea Sync";
export const DEFAULT_GIT_USER_EMAIL = "sync@cozea.local";

export interface RepoMetadata {
  repoExists: boolean;
  isRepo: boolean;
  gitDir?: string;
  topLevelPath?: string;
  currentBranch?: string;
  headCommit?: string;
}

export interface ParsedStatus {
  clean: boolean;
  ahead: number;
  behind: number;
  upstreamBranch: string | null;
  hasConflicts: boolean;
  hasStagedChanges: boolean;
  hasUnstagedChanges: boolean;
  hasUntrackedChanges: boolean;
  deletedCount: number;
  changedPaths: string[];
  conflictedPaths: string[];
}

export function parseGitStatus(stdout: string): ParsedStatus {
  const lines = stdout.split(/\r?\n/).filter(Boolean);
  let ahead = 0;
  let behind = 0;
  let upstreamBranch: string | null = null;
  let hasConflicts = false;
  let hasStagedChanges = false;
  let hasUnstagedChanges = false;
  let hasUntrackedChanges = false;
  let deletedCount = 0;
  const changedPaths: string[] = [];
  const conflictedPaths = new Set<string>();

  for (const line of lines) {
    if (line.startsWith("## ")) {
      const branchInfo = line.slice(3);
      const upstreamMatch = branchInfo.match(/\.{3}([^\s]+)(?:\s|$)/);
      if (upstreamMatch) {
        upstreamBranch = upstreamMatch[1];
      }
      const aheadMatch = branchInfo.match(/ahead (\d+)/);
      const behindMatch = branchInfo.match(/behind (\d+)/);
      ahead = aheadMatch ? Number(aheadMatch[1]) : 0;
      behind = behindMatch ? Number(behindMatch[1]) : 0;
      continue;
    }

    const code = line.slice(0, 2);
    const rawPath = line.slice(3).trim();
    const normalizedPath = rawPath.includes(" -> ")
      ? rawPath.split(" -> ").pop()?.trim() ?? rawPath
      : rawPath;
    if (normalizedPath) {
      changedPaths.push(normalizedPath);
    }

    const staged = code[0];
    const unstaged = code[1];
    if (staged === "?" && unstaged === "?") {
      hasUntrackedChanges = true;
      continue;
    }
    if (staged === "D" || unstaged === "D") {
      deletedCount += 1;
    }
    if ("UADRC".includes(staged) || "UADRC".includes(unstaged)) {
      const isConflict = staged === "U" || unstaged === "U" || code === "AA" || code === "DD";
      hasConflicts = hasConflicts || isConflict;
      if (isConflict && normalizedPath) {
        conflictedPaths.add(normalizedPath);
      }
    }
    if (staged !== " ") hasStagedChanges = true;
    if (unstaged !== " ") hasUnstagedChanges = true;
  }

  return {
    clean: !hasConflicts && !hasStagedChanges && !hasUnstagedChanges && !hasUntrackedChanges,
    ahead,
    behind,
    upstreamBranch,
    hasConflicts,
    hasStagedChanges,
    hasUnstagedChanges,
    hasUntrackedChanges,
    deletedCount,
    changedPaths,
    conflictedPaths: Array.from(conflictedPaths),
  };
}

export function normalizeGitBranch(branch?: string): string {
  return branch?.trim() || DEFAULT_BRANCH;
}

export function normalizeGitRemote(remote?: string): string {
  return remote?.trim() || DEFAULT_REMOTE;
}

export function normalizeGitRemoteUrl(repoUrl: string): string {
  return repoUrl.trim();
}

export function isShallowUpdateRejected(error: string | undefined): boolean {
  if (!error) {
    return false;
  }

  return /shallow update not allowed/i.test(error);
}

export function isMissingRemoteBranchError(error: string | undefined): boolean {
  const message = error?.toLowerCase() ?? "";
  if (!message) return false;
  return (
    message.includes("couldn't find remote ref") ||
    (message.includes("remote branch") && message.includes("not found")) ||
    message.includes("remote head refers to nonexistent ref") ||
    message.includes("no such ref was fetched")
  );
}

export function isEmptyCherryPickError(error: string | undefined): boolean {
  const message = error?.toLowerCase() ?? "";
  if (!message) {
    return false;
  }

  return (
    message.includes("the previous cherry-pick is now empty") ||
    message.includes("nothing to commit") ||
    message.includes("previous cherry-pick is now empty")
  );
}
