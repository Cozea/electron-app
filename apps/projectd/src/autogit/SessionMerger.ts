/**
 * Merges a live session into the branch its work is meant for (Section 22).
 *
 * Phase: P22
 * Invariants:
 * - C28: Merge operates on an immutable, reviewed Git checkpoint, not moving CRDT state.
 *
 * The preview merges the session's last save with the target in Git's object store
 * alone (`git merge-tree`), touching no working tree. Merging pushes a merge or squash
 * commit on top of the target as fetched, and never forces: when the target moved,
 * the merge is reviewed again, and when the remote refuses direct pushes, as a
 * protected branch does, a pull request is offered instead. Nothing deletes the
 * session's branch.
 */

import type { ProjectdMergePreview, ProjectdMergeResult, ProjectdMergeStrategy } from "@cozea/projectd-protocol"

import type { GitExecuteOptions } from "../git/GitProcess"
import type { GitService } from "../git/GitService"

const REMOTE_TIMEOUT_MS = 60_000
// Cozea's identity for a merge commit, only when the person's Git has none.
const FALLBACK_IDENTITY = { name: "Cozea", email: "merge@cozea.local" }

export class MergeError extends Error {
  readonly code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = "MergeError"
    this.code = code
  }
}

export interface SessionMergerOptions {
  workspaceRoot: string
  branchName: string
  targetBranch: string
  gitService: GitService
}

interface Repository {
  root: string
  remote: string
  remoteUrl: string | null
  targetRef: string
}

function firstLine(text: string): string {
  return (
    text
      .split("\n")
      .map((line) => line.replace(/^(fatal|error|remote|hint):\s*/, "").replace(/^error:\s*/, "").trim())
      .find(Boolean) ?? ""
  )
}

function countCommits(count: number): string {
  return `${count} ${count === 1 ? "commit" : "commits"}`
}

function listPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).join(", ")
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown
}

/** The host and repository path of a remote, whatever form it takes; null for local paths. */
function parseRemote(remoteUrl: string): { host: string; repositoryPath: string } | null {
  const value = remoteUrl.trim()
  let host: string
  let repositoryPath: string
  const scpLike = /^[^@\s/]+@([^:\s/]+):(.+)$/.exec(value)
  if (scpLike) {
    host = scpLike[1] ?? ""
    repositoryPath = scpLike[2] ?? ""
  } else {
    let url: URL
    try {
      url = new URL(value)
    } catch {
      return null
    }
    if (!["https:", "http:", "ssh:", "git:"].includes(url.protocol)) return null
    // Hostname and path only: sign-in details in the remote never reach the link.
    host = url.hostname
    repositoryPath = url.pathname
  }
  repositoryPath = repositoryPath.replace(/^\/+/, "").replace(/\/+$/, "").replace(/\.git$/, "")
  if (!host || !repositoryPath) return null
  return { host: host.toLowerCase(), repositoryPath }
}

/** Where a pull request from `branch` into `target` can be opened, for hosts with a page for it. */
export function pullRequestUrl(remoteUrl: string, branch: string, target: string): string | null {
  const parsed = parseRemote(remoteUrl)
  if (!parsed) return null
  const { host, repositoryPath } = parsed
  const inPath = (name: string) => name.split("/").map(encodeURIComponent).join("/")
  if (host.includes("github")) {
    return `https://${host}/${repositoryPath}/compare/${inPath(target)}...${inPath(branch)}?expand=1`
  }
  if (host.includes("gitlab")) {
    const source = encodeURIComponent(branch)
    return `https://${host}/${repositoryPath}/-/merge_requests/new?merge_request%5Bsource_branch%5D=${source}&merge_request%5Btarget_branch%5D=${encodeURIComponent(target)}`
  }
  if (host === "bitbucket.org") {
    return `https://${host}/${repositoryPath}/pull-requests/new?source=${encodeURIComponent(branch)}&dest=${encodeURIComponent(target)}`
  }
  return null
}

export class SessionMerger {
  private readonly options: SessionMergerOptions

  constructor(options: SessionMergerOptions) {
    this.options = options
  }

  /** Merges the session's last save with the target, in Git's object store only (Section 22.1). */
  async preview(input: { checkpointOid: string | null; unsavedChanges: number }): Promise<ProjectdMergePreview> {
    const { branchName, targetBranch } = this.options
    if (!input.checkpointOid) {
      throw new MergeError("NOT_SAVED", "The session hasn't been saved to Git yet. Save it, then merge.")
    }
    const repo = await this.repository()
    await this.fetch(repo)
    const checkpointOid = input.checkpointOid
    const hasCheckpoint = await this.git(repo.root, ["cat-file", "-e", `${checkpointOid}^{commit}`])
    if (!hasCheckpoint.success) {
      throw new MergeError(
        "CHECKPOINT_MISSING",
        `Git here doesn't have the session's last save (${checkpointOid.slice(0, 7)}) yet. Try again in a moment.`,
      )
    }
    const targetOid = await this.options.gitService.getCommitOid(repo.root, repo.targetRef)
    if (!targetOid) throw new MergeError("TARGET_MISSING", `${targetBranch} doesn't exist on ${repo.remote}.`)

    const counts = await this.git(repo.root, ["rev-list", "--left-right", "--count", `${targetOid}...${checkpointOid}`])
    const [behind = 0, ahead = 0] = counts.stdout.trim().split(/\s+/).map((value) => Number(value) || 0)
    const merged = await this.mergeTree(repo.root, targetOid, checkpointOid)
    return {
      branch: branchName,
      targetBranch,
      checkpointOid,
      targetOid,
      ahead,
      behind,
      clean: merged.clean,
      conflictingPaths: merged.conflicts,
      unsavedChanges: input.unsavedChanges,
      pullRequestUrl: repo.remoteUrl ? pullRequestUrl(repo.remoteUrl, branchName, targetBranch) : null,
    }
  }

  /** Merges the reviewed save into the target, or says why not (Section 22.2 - 22.3). */
  async merge(input: {
    checkpointOid: string | null
    reviewedCheckpointOid: string
    strategy: ProjectdMergeStrategy
    unsavedChanges: number
  }): Promise<ProjectdMergeResult> {
    const { branchName, targetBranch } = this.options
    const preview = await this.preview(input)
    const base = { pullRequestUrl: preview.pullRequestUrl }
    if (preview.checkpointOid !== input.reviewedCheckpointOid) {
      return {
        ...base,
        outcome: "moved",
        message: "The session was saved to Git again since you reviewed the merge. Review it again.",
      }
    }
    if (preview.ahead === 0) {
      return {
        ...base,
        outcome: "merged",
        mergeCommitOid: preview.targetOid,
        message: `${targetBranch} already has everything in the session's last save.`,
      }
    }
    if (!preview.clean) {
      return {
        ...base,
        outcome: "conflicts",
        message: `${listPaths(preview.conflictingPaths)} changed on both sides. Rebase the session from ${targetBranch} first, or resolve them in a pull request.`,
      }
    }

    const repo = await this.repository()
    const { tree } = await this.mergeTree(repo.root, preview.targetOid, preview.checkpointOid)
    if (!tree) throw new MergeError("MERGE_FAILED", "Git couldn't merge the session's last save.")
    const squash = input.strategy === "squash"
    const message = squash
      ? `${branchName}: changes from the live session\n\nSquashed from ${countCommits(preview.ahead)} up to ${preview.checkpointOid}.`
      : `Merge branch '${branchName}' into ${targetBranch}`
    const parents = squash ? [preview.targetOid] : [preview.targetOid, preview.checkpointOid]
    const commit = await this.git(
      repo.root,
      ["commit-tree", tree, ...parents.flatMap((parent) => ["-p", parent]), "-m", message],
      { env: await this.identityEnv(repo.root) },
    )
    if (!commit.success) {
      throw new MergeError("COMMIT_FAILED", firstLine(commit.stderr) || "Git couldn't create the merge commit.")
    }
    const mergeCommitOid = commit.stdout.trim()

    const pushed = await this.git(repo.root, ["push", "--porcelain", repo.remote, `${mergeCommitOid}:refs/heads/${targetBranch}`], {
      timeoutMs: REMOTE_TIMEOUT_MS,
    })
    if (pushed.success) {
      return {
        ...base,
        outcome: "merged",
        mergeCommitOid,
        message: `Merged into ${targetBranch} as ${mergeCommitOid.slice(0, 7)}.`,
      }
    }
    const output = `${pushed.stderr}\n${pushed.stdout}`
    if (/GH006|protected branch|hook declined|not allowed to push|pushes to this branch are not allowed/i.test(output)) {
      return {
        ...base,
        outcome: "needs_pull_request",
        message: `${repo.remote} doesn't accept direct pushes to ${targetBranch}. Open a pull request instead.`,
      }
    }
    if (/non-fast-forward|fetch first|stale info/i.test(output)) {
      return {
        ...base,
        outcome: "moved",
        message: `${targetBranch} moved on ${repo.remote} while merging. Review the merge again.`,
      }
    }
    throw new MergeError("PUSH_FAILED", `Git couldn't push to ${targetBranch}: ${firstLine(output) || "no answer"}`)
  }

  private async repository(): Promise<Repository> {
    const { workspaceRoot, branchName, targetBranch } = this.options
    const top = await this.git(workspaceRoot, ["rev-parse", "--show-toplevel"])
    if (!top.success) throw new MergeError("NOT_A_REPOSITORY", "This session's folder is not a Git repository.")
    const root = top.stdout.trim()
    const configured = (await this.git(root, ["config", "--get", `branch.${branchName}.remote`])).stdout.trim()
    const remote = configured && configured !== "." ? configured : "origin"
    const url = await this.git(root, ["remote", "get-url", remote])
    return {
      root,
      remote,
      remoteUrl: url.success ? url.stdout.trim() : null,
      targetRef: `refs/remotes/${remote}/${targetBranch}`,
    }
  }

  private async fetch(repo: Repository): Promise<void> {
    const { branchName, targetBranch } = this.options
    const fetched = await this.git(
      repo.root,
      [
        "fetch",
        "--no-tags",
        repo.remote,
        `+refs/heads/${targetBranch}:${repo.targetRef}`,
        `+refs/heads/${branchName}:refs/remotes/${repo.remote}/${branchName}`,
      ],
      { timeoutMs: REMOTE_TIMEOUT_MS },
    )
    if (!fetched.success) {
      throw new MergeError("FETCH_FAILED", `Git couldn't fetch from ${repo.remote}: ${firstLine(fetched.stderr) || "no answer"}`)
    }
  }

  /** `git merge-tree --write-tree`: exit 0 is clean, 1 has conflicts; the tree comes first, conflicted paths after. */
  private async mergeTree(root: string, targetOid: string, checkpointOid: string) {
    const result = await this.git(root, [
      "merge-tree",
      "--write-tree",
      "--name-only",
      "-z",
      "--no-messages",
      targetOid,
      checkpointOid,
    ])
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new MergeError("MERGE_FAILED", firstLine(result.stderr) || "git merge-tree failed")
    }
    const [tree = "", ...paths] = result.stdout.split("\0")
    const clean = result.exitCode === 0
    return { clean, tree: clean ? tree.trim() : null, conflicts: clean ? [] : [...new Set(paths.filter(Boolean))] }
  }

  /** The person's Git identity, or Cozea's through the environment when Git has none; never written to config. */
  private async identityEnv(root: string): Promise<Record<string, string>> {
    const [name, email] = await Promise.all([
      this.git(root, ["config", "--get", "user.name"]),
      this.git(root, ["config", "--get", "user.email"]),
    ])
    const env: Record<string, string> = {}
    if (!name.stdout.trim()) {
      env.GIT_AUTHOR_NAME = FALLBACK_IDENTITY.name
      env.GIT_COMMITTER_NAME = FALLBACK_IDENTITY.name
    }
    if (!email.stdout.trim()) {
      env.GIT_AUTHOR_EMAIL = FALLBACK_IDENTITY.email
      env.GIT_COMMITTER_EMAIL = FALLBACK_IDENTITY.email
    }
    return env
  }

  private git(cwd: string, args: string[], options: Omit<GitExecuteOptions, "cwd"> = {}) {
    return this.options.gitService.process.execute(args, { cwd, allowNonZeroExit: true, ...options })
  }
}
