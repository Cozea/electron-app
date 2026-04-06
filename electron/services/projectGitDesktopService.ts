import { app } from "electron"
import fs from "node:fs"
import path from "node:path"

import { runGitCommand } from "../gitRuntime"

export interface DesktopGitBranchDescriptor {
  name: string
  isRemote?: boolean
  remoteName?: string
  current: boolean
  isDefault: boolean
  worktreePath: string | null
}

export interface DesktopGitBranchListResult {
  isRepo: boolean
  hasOriginRemote: boolean
  branches: DesktopGitBranchDescriptor[]
  error?: string
}

export interface DesktopGitCheckoutResult {
  success: boolean
  branch?: string
  error?: string
}

export interface DesktopGitCreateWorktreeResult {
  success: boolean
  worktree?: {
    path: string
    branch: string
  }
  error?: string
}

function parseBranchLine(line: string): { name: string; current: boolean } | null {
  const trimmed = line.trim()
  if (trimmed.length === 0) return null

  const name = trimmed.replace(/^[*+]\s+/, "")
  if (name.includes(" -> ") || name.startsWith("(")) return null

  return {
    name,
    current: trimmed.startsWith("* "),
  }
}

function parseRemoteNames(stdout: string): string[] {
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .sort((a, b) => b.length - a.length)
}

function parseRemoteRefWithRemoteNames(
  branchName: string,
  remoteNames: readonly string[],
): { remoteName: string; localBranch: string } | null {
  const trimmedBranchName = branchName.trim()
  if (trimmedBranchName.length === 0) return null

  for (const remoteName of remoteNames) {
    const prefix = `${remoteName}/`
    if (!trimmedBranchName.startsWith(prefix)) continue
    const localBranch = trimmedBranchName.slice(prefix.length).trim()
    if (localBranch.length === 0) return null
    return { remoteName, localBranch }
  }

  return null
}

function parseTrackingBranchByUpstreamRef(stdout: string, upstreamRef: string): string | null {
  for (const line of stdout.split("\n")) {
    const trimmed = line.trim()
    if (trimmed.length === 0) continue
    const [branchNameRaw, upstreamBranchRaw = ""] = trimmed.split("\t")
    const branchName = branchNameRaw?.trim() ?? ""
    const upstreamBranch = upstreamBranchRaw.trim()
    if (branchName.length === 0 || upstreamBranch.length === 0) continue
    if (upstreamBranch === upstreamRef) {
      return branchName
    }
  }

  return null
}

function deriveLocalBranchNameFromRemoteRef(branchName: string): string | null {
  const separatorIndex = branchName.indexOf("/")
  if (separatorIndex <= 0 || separatorIndex === branchName.length - 1) {
    return null
  }
  const localBranch = branchName.slice(separatorIndex + 1).trim()
  return localBranch.length > 0 ? localBranch : null
}

function resolveDefaultWorktreePath(cwd: string, branch: string): string {
  const repoName = path.basename(cwd)
  const sanitizedBranch = branch.replace(/\//g, "-")
  return path.join(app.getPath("userData"), "worktrees", repoName, sanitizedBranch)
}

async function runGit(
  cwd: string,
  args: string[],
): Promise<Awaited<ReturnType<typeof runGitCommand>>> {
  return runGitCommand(args, { cwd, timeoutMs: 10_000 })
}

export async function listProjectGitBranches(cwd: string): Promise<DesktopGitBranchListResult> {
  const resolvedCwd = path.resolve(cwd)
  if (!fs.existsSync(resolvedCwd)) {
    return {
      isRepo: false,
      hasOriginRemote: false,
      branches: [],
      error: "Project path does not exist on this machine.",
    }
  }

  const repoCheck = await runGit(resolvedCwd, ["rev-parse", "--is-inside-work-tree"])
  if (!repoCheck.success || repoCheck.stdout.trim() !== "true") {
    return {
      isRepo: false,
      hasOriginRemote: false,
      branches: [],
    }
  }

  const [
    localBranchesResult,
    remoteBranchesResult,
    remoteNamesResult,
    defaultRefResult,
    worktreeListResult,
  ] = await Promise.all([
    runGit(resolvedCwd, ["branch", "--no-color"]),
    runGit(resolvedCwd, ["branch", "--no-color", "--remotes"]),
    runGit(resolvedCwd, ["remote"]),
    runGit(resolvedCwd, ["symbolic-ref", "refs/remotes/origin/HEAD"]),
    runGit(resolvedCwd, ["worktree", "list", "--porcelain"]),
  ])

  if (!localBranchesResult.success) {
    return {
      isRepo: true,
      hasOriginRemote: false,
      branches: [],
      error:
        localBranchesResult.stderr.trim() ||
        localBranchesResult.error ||
        "Failed to list local git branches.",
    }
  }

  const remoteNames = remoteNamesResult.success ? parseRemoteNames(remoteNamesResult.stdout) : []
  const hasOriginRemote = remoteNames.includes("origin")
  const defaultBranch =
    defaultRefResult.success && defaultRefResult.stdout.trim().startsWith("refs/remotes/origin/")
      ? defaultRefResult.stdout.trim().replace(/^refs\/remotes\/origin\//, "")
      : null

  const worktreeMap = new Map<string, string>()
  if (worktreeListResult.success) {
    let currentPath: string | null = null
    for (const line of worktreeListResult.stdout.split("\n")) {
      if (line.startsWith("worktree ")) {
        const candidatePath = line.slice("worktree ".length)
        currentPath = fs.existsSync(candidatePath) ? candidatePath : null
      } else if (line.startsWith("branch refs/heads/") && currentPath) {
        worktreeMap.set(line.slice("branch refs/heads/".length), currentPath)
      } else if (line.trim().length === 0) {
        currentPath = null
      }
    }
  }

  const localBranches = localBranchesResult.stdout
    .split("\n")
    .map(parseBranchLine)
    .filter((branch): branch is { name: string; current: boolean } => branch !== null)
    .map((branch) => ({
      name: branch.name,
      current: branch.current,
      isRemote: false,
      isDefault: branch.name === defaultBranch,
      worktreePath: worktreeMap.get(branch.name) ?? null,
    }))
    .sort((left, right) => {
      const leftPriority = left.current ? 0 : left.isDefault ? 1 : 2
      const rightPriority = right.current ? 0 : right.isDefault ? 1 : 2
      if (leftPriority !== rightPriority) return leftPriority - rightPriority
      return left.name.localeCompare(right.name)
    })

  const remoteBranches =
    remoteBranchesResult.success
      ? remoteBranchesResult.stdout
          .split("\n")
          .map(parseBranchLine)
          .filter((branch): branch is { name: string; current: boolean } => branch !== null)
          .map((branch) => {
            const parsedRemote = parseRemoteRefWithRemoteNames(branch.name, remoteNames)
            return {
              name: branch.name,
              current: false,
              isRemote: true,
              remoteName: parsedRemote?.remoteName,
              isDefault: branch.name === `origin/${defaultBranch}`,
              worktreePath: null,
            } satisfies DesktopGitBranchDescriptor
          })
          .sort((left, right) => left.name.localeCompare(right.name))
      : []

  return {
    isRepo: true,
    hasOriginRemote,
    branches: [...localBranches, ...remoteBranches],
  }
}

export async function checkoutProjectGitBranch(args: {
  cwd: string
  branch: string
}): Promise<DesktopGitCheckoutResult> {
  const resolvedCwd = path.resolve(args.cwd)
  const branch = args.branch.trim()
  if (!branch) {
    return { success: false, error: "Branch name is required." }
  }

  const [localInputExists, remoteExists] = await Promise.all([
    runGit(resolvedCwd, ["show-ref", "--verify", "--quiet", `refs/heads/${branch}`]),
    runGit(resolvedCwd, ["show-ref", "--verify", "--quiet", `refs/remotes/${branch}`]),
  ])

  const localTrackingBranch =
    remoteExists.success
      ? await runGit(resolvedCwd, [
          "for-each-ref",
          "--format=%(refname:short)\t%(upstream:short)",
          "refs/heads",
        ]).then((result) =>
          result.success ? parseTrackingBranchByUpstreamRef(result.stdout, branch) : null,
        )
      : null

  const localTrackedBranchCandidate = deriveLocalBranchNameFromRemoteRef(branch)
  const localTrackedBranchTargetExists =
    remoteExists.success && localTrackedBranchCandidate
      ? await runGit(resolvedCwd, [
          "show-ref",
          "--verify",
          "--quiet",
          `refs/heads/${localTrackedBranchCandidate}`,
        ]).then((result) => result.success)
      : false

  const checkoutArgs = localInputExists.success
    ? ["checkout", branch]
    : remoteExists.success && !localTrackingBranch && localTrackedBranchTargetExists
      ? ["checkout", branch]
      : remoteExists.success && !localTrackingBranch
        ? ["checkout", "--track", branch]
        : remoteExists.success && localTrackingBranch
          ? ["checkout", localTrackingBranch]
          : ["checkout", branch]

  const checkoutResult = await runGit(resolvedCwd, checkoutArgs)
  if (!checkoutResult.success) {
    return {
      success: false,
      error:
        checkoutResult.stderr.trim() ||
        checkoutResult.error ||
        "Failed to switch branches.",
    }
  }

  const currentBranchResult = await runGit(resolvedCwd, ["branch", "--show-current"])
  return {
    success: true,
    branch: currentBranchResult.success
      ? currentBranchResult.stdout.trim() || branch
      : branch,
  }
}

export async function createProjectGitWorktree(args: {
  cwd: string
  branch: string
  newBranch?: string
  path?: string | null
}): Promise<DesktopGitCreateWorktreeResult> {
  const resolvedCwd = path.resolve(args.cwd)
  const baseBranch = args.branch.trim()
  const targetBranch = (args.newBranch ?? args.branch).trim()
  if (!baseBranch || !targetBranch) {
    return { success: false, error: "Branch name is required." }
  }

  const worktreePath = args.path?.trim()
    ? path.resolve(args.path)
    : resolveDefaultWorktreePath(resolvedCwd, targetBranch)

  fs.mkdirSync(path.dirname(worktreePath), { recursive: true })

  const gitArgs = args.newBranch?.trim()
    ? ["worktree", "add", "-b", args.newBranch.trim(), worktreePath, baseBranch]
    : ["worktree", "add", worktreePath, baseBranch]
  const result = await runGit(resolvedCwd, gitArgs)

  if (!result.success) {
    return {
      success: false,
      error: result.stderr.trim() || result.error || "Failed to create git worktree.",
    }
  }

  return {
    success: true,
    worktree: {
      path: worktreePath,
      branch: targetBranch,
    },
  }
}
