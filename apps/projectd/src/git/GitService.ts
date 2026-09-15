/**
 * Canonical daemon GitService for Cozea.
 *
 * Master Specification: Section 17.1 - 17.5
 * Consolidates Git operations into a single daemon-owned authority.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { createHash } from "node:crypto"
import { GitProcess, type GitProcessHealth } from "./GitProcess"
import { GitStatusParser, type ParsedGitStatus } from "./GitStatus"
import { GitAttributes, type PathAttributes } from "./GitAttributes"
import { RepositoryMirrorManager } from "./RepositoryMirror"

export interface GitBranchInfo {
  name: string
  fullName: string
  commitOid: string
  upstream: string | null
  isCurrent: boolean
  isRemote: boolean
}

export class GitService {
  readonly process: GitProcess
  readonly attributes: GitAttributes
  readonly mirrors: RepositoryMirrorManager

  constructor(customGitPath?: string, mirrorsDir?: string) {
    this.process = new GitProcess(customGitPath)
    this.attributes = new GitAttributes(this.process)
    this.mirrors = new RepositoryMirrorManager(this.process, mirrorsDir)
  }

  async getHealth(): Promise<GitProcessHealth> {
    return this.process.getHealth()
  }

  /**
   * Returns machine-readable porcelain v2 status (Section 17.5).
   */
  async getStatus(cwd: string): Promise<ParsedGitStatus> {
    const res = await this.process.execute(
      ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=normal"],
      { cwd },
    )
    return GitStatusParser.parsePorcelainV2(res.stdoutBuffer)
  }

  /**
   * Lists branches using machine-readable for-each-ref (Section 17.5).
   */
  async getBranches(cwd: string): Promise<GitBranchInfo[]> {
    const res = await this.process.execute(
      [
        "for-each-ref",
        "--format=%(refname:short)|%(refname)|%(objectname)|%(upstream:short)|%(HEAD)",
        "refs/heads",
        "refs/remotes",
      ],
      { cwd },
    )

    const lines = res.stdout.split("\n").map((l) => l.trim()).filter(Boolean)
    const branches: GitBranchInfo[] = []

    for (const line of lines) {
      const [name, fullName, commitOid, upstream, headFlag] = line.split("|")
      if (!name) continue

      branches.push({
        name,
        fullName: fullName ?? name,
        commitOid: commitOid ?? "",
        upstream: upstream || null,
        isCurrent: headFlag === "*",
        isRemote: fullName?.startsWith("refs/remotes/") ?? false,
      })
    }

    return branches
  }

  /**
   * Checks which paths in a list are ignored by Git rules (Section 12.10, Invariant C40).
   */
  async checkIgnore(cwd: string, paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) return new Set()

    const stdin = paths.join("\0")
    const res = await this.process.execute(["check-ignore", "-z", "--stdin"], {
      cwd,
      stdin,
      allowNonZeroExit: true,
    })

    const ignored = new Set<string>()
    if (res.stdout) {
      const tokens = res.stdout.split("\0").filter(Boolean)
      for (const t of tokens) {
        ignored.add(t)
      }
    }
    return ignored
  }

  async checkAttributes(cwd: string, paths: string[]): Promise<Map<string, PathAttributes>> {
    return this.attributes.checkAttributes(cwd, paths)
  }

  async getCommitOid(cwd: string, ref = "HEAD"): Promise<string | null> {
    const res = await this.process.execute(["rev-parse", "--verify", `${ref}^{commit}`], {
      cwd,
      allowNonZeroExit: true,
    })
    return res.success ? res.stdout.trim() : null
  }

  /**
   * Streams a blob's bytes without buffering the object. One process per
   * call; chunks arrive in object order for single-pass consumers.
   */
  async streamBlob(
    repoPath: string,
    oid: string,
    write: (chunk: Buffer) => Promise<void>,
  ): Promise<void> {
    await this.process.streamBlob({ cwd: repoPath, oid }, write)
  }

  /**
   * Streams a blob's SHA-256 without buffering the object. The blob is
   * re-hashed from the object store, never trusted from a recorded size.
   */
  async hashBlob(repoPath: string, oid: string): Promise<string> {
    const digest = createHash("sha256")
    await this.process.streamBlob({ cwd: repoPath, oid }, (chunk) => {
      digest.update(chunk)
    })
    return digest.digest("hex")
  }

  /**
   * Reads one bounded range of a blob. Memory stays O(length) no matter how
   * large the object is; shorter-than-requested objects throw.
   */
  async readBlobRange(repoPath: string, oid: string, offset: number, length: number): Promise<Buffer> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length <= 0) {
      throw new Error("Invalid blob range for a bounded Git read")
    }
    const parts: Buffer[] = []
    let skipped = 0
    let taken = 0
    await this.process.streamBlob({ cwd: repoPath, oid }, (chunk) => {
      let position = 0
      if (skipped < offset) {
        const skip = Math.min(chunk.length, offset - skipped)
        position += skip
        skipped += skip
      }
      if (position < chunk.length && taken < length) {
        const take = Math.min(chunk.length - position, length - taken)
        parts.push(chunk.subarray(position, position + take))
        taken += take
      }
    })
    if (taken !== length) throw new Error(`Git blob is shorter than its recorded size`)
    return Buffer.concat(parts, taken)
  }

  /**
   * Files under `cwd` that Git can restore exactly: tracked, and unchanged from HEAD
   * in both the index and the work tree. Paths are relative to `cwd`. Returns null
   * outside a work tree or before the first commit.
   */
  async listUnmodifiedTrackedFiles(cwd: string): Promise<Set<string> | null> {
    const prefix = await this.process.execute(["rev-parse", "--show-prefix"], { cwd, allowNonZeroExit: true })
    if (!prefix.success || !(await this.getCommitOid(cwd))) return null
    // ls-files --full-name and porcelain status name paths from the repository root.
    const cwdPrefix = prefix.stdout.trim()
    const underCwd = (repoPath: string | undefined): string | null =>
      repoPath && repoPath.startsWith(cwdPrefix) ? repoPath.slice(cwdPrefix.length) : null

    const tracked = await this.process.execute(["ls-files", "-z", "--full-name"], { cwd })
    const unmodified = new Set<string>()
    for (const repoPath of tracked.stdout.split("\0")) {
      const relative = underCwd(repoPath)
      if (relative) unmodified.add(relative)
    }
    for (const file of (await this.getStatus(cwd)).files) {
      for (const changed of [file.path, file.origPath]) {
        const relative = underCwd(changed)
        if (relative) unmodified.delete(relative)
      }
    }
    return unmodified
  }

  async initRepo(cwd: string, defaultBranch = "main"): Promise<void> {
    const res = await this.process.execute(["init", "-b", defaultBranch], { cwd })
    if (!res.success) {
      throw new Error(`Failed to init git repository at ${cwd}: ${res.stderr}`)
    }
  }

  async createBranch(cwd: string, branchName: string, startPoint?: string): Promise<void> {
    const args = ["branch", branchName]
    if (startPoint) {
      args.push(startPoint)
    }
    await this.process.execute(args, { cwd })
  }

  async checkoutBranch(cwd: string, branchName: string): Promise<string> {
    const trimmed = branchName.trim()
    if (!trimmed) {
      throw new Error("Branch name is required.")
    }
    const [localCheck, remoteCheck] = await Promise.all([
      this.process.execute(["show-ref", "--verify", "--quiet", `refs/heads/${trimmed}`], {
        cwd,
        allowNonZeroExit: true,
      }),
      this.process.execute(["show-ref", "--verify", "--quiet", `refs/remotes/${trimmed}`], {
        cwd,
        allowNonZeroExit: true,
      }),
    ])

    const remoteExists = remoteCheck.success
    const localExists = localCheck.success

    let localTrackingBranch: string | null = null
    if (remoteExists) {
      const trackingRes = await this.process.execute(
        ["for-each-ref", "--format=%(refname:short)\t%(upstream:short)", "refs/heads"],
        { cwd, allowNonZeroExit: true },
      )
      if (trackingRes.success) {
        for (const line of trackingRes.stdout.split("\n")) {
          const [branchNameRaw, upstreamBranchRaw = ""] = line.trim().split("\t")
          if (upstreamBranchRaw.trim() === trimmed) {
            localTrackingBranch = branchNameRaw.trim()
            break
          }
        }
      }
    }

    const separatorIndex = trimmed.indexOf("/")
    const localTrackedCandidate =
      separatorIndex > 0 ? trimmed.slice(separatorIndex + 1).trim() : null
    let localTrackedCandidateExists = false
    if (remoteExists && localTrackedCandidate) {
      const candidateCheck = await this.process.execute(
        ["show-ref", "--verify", "--quiet", `refs/heads/${localTrackedCandidate}`],
        { cwd, allowNonZeroExit: true },
      )
      localTrackedCandidateExists = candidateCheck.success
    }

    const checkoutArgs = localExists
      ? ["checkout", trimmed]
      : remoteExists && !localTrackingBranch && localTrackedCandidateExists
        ? ["checkout", trimmed]
        : remoteExists && !localTrackingBranch
          ? ["checkout", "--track", trimmed]
          : remoteExists && localTrackingBranch
            ? ["checkout", localTrackingBranch]
            : ["checkout", trimmed]

    const res = await this.process.execute(checkoutArgs, { cwd })
    if (!res.success) {
      throw new Error(res.stderr.trim() || "Failed to switch branches.")
    }

    const currentBranchRes = await this.process.execute(["branch", "--show-current"], {
      cwd,
      allowNonZeroExit: true,
    })
    return currentBranchRes.success && currentBranchRes.stdout.trim()
      ? currentBranchRes.stdout.trim()
      : trimmed
  }

  async createWorktree(
    cwd: string,
    branch: string,
    options?: { newBranch?: string; path?: string | null },
  ): Promise<{ success: boolean; worktree?: { path: string; branch: string }; error?: string }> {
    const baseBranch = branch.trim()
    const targetBranch = (options?.newBranch ?? branch).trim()
    if (!baseBranch || !targetBranch) {
      return { success: false, error: "Branch name is required." }
    }

    const worktreePath = options?.path?.trim()
      ? path.resolve(options.path)
      : path.join(os.tmpdir(), "cozea-worktrees", path.basename(cwd), targetBranch.replace(/\//g, "-"))

    fs.mkdirSync(path.dirname(worktreePath), { recursive: true })

    const gitArgs = options?.newBranch?.trim()
      ? ["worktree", "add", "-b", options.newBranch.trim(), worktreePath, baseBranch]
      : ["worktree", "add", worktreePath, baseBranch]

    const res = await this.process.execute(gitArgs, { cwd, allowNonZeroExit: true })
    if (!res.success) {
      return { success: false, error: res.stderr.trim() || "Failed to create git worktree." }
    }

    return {
      success: true,
      worktree: {
        path: worktreePath,
        branch: targetBranch,
      },
    }
  }

  async listWorktrees(
    cwd: string,
  ): Promise<Array<{ path: string; headOid: string; branch: string | null }>> {
    const res = await this.process.execute(["worktree", "list", "--porcelain", "-z"], {
      cwd,
      allowNonZeroExit: true,
    })
    if (!res.success) return []
    const tokens = res.stdout.split("\0")
    const worktrees: Array<{ path: string; headOid: string; branch: string | null }> = []
    let currentPath: string | null = null
    let currentOid = ""
    let currentBranch: string | null = null

    for (const token of tokens) {
      if (!token) {
        if (currentPath) {
          worktrees.push({ path: currentPath, headOid: currentOid, branch: currentBranch })
          currentPath = null
          currentOid = ""
          currentBranch = null
        }
        continue
      }
      if (token.startsWith("worktree ")) {
        currentPath = token.slice("worktree ".length)
      } else if (token.startsWith("HEAD ")) {
        currentOid = token.slice("HEAD ".length)
      } else if (token.startsWith("branch refs/heads/")) {
        currentBranch = token.slice("branch refs/heads/".length)
      }
    }
    if (currentPath) {
      worktrees.push({ path: currentPath, headOid: currentOid, branch: currentBranch })
    }
    return worktrees
  }

  async listProjectBranches(cwd: string): Promise<{
    isRepo: boolean
    hasOriginRemote: boolean
    branches: Array<{
      name: string
      current: boolean
      isRemote: boolean
      remoteName?: string
      isDefault: boolean
      worktreePath: string | null
    }>
    error?: string
  }> {
    const repoCheck = await this.process.execute(["rev-parse", "--is-inside-work-tree"], {
      cwd,
      allowNonZeroExit: true,
    })
    if (!repoCheck.success || repoCheck.stdout.trim() !== "true") {
      return { isRepo: false, hasOriginRemote: false, branches: [] }
    }

    const [branches, remotesRes, defaultRefRes, worktrees] = await Promise.all([
      this.getBranches(cwd),
      this.process.execute(["remote"], { cwd, allowNonZeroExit: true }),
      this.process.execute(["symbolic-ref", "refs/remotes/origin/HEAD"], {
        cwd,
        allowNonZeroExit: true,
      }),
      this.listWorktrees(cwd),
    ])

    const remotes = remotesRes.success
      ? remotesRes.stdout.split("\n").map((r) => r.trim()).filter(Boolean)
      : []
    const hasOriginRemote = remotes.includes("origin")
    const defaultBranch =
      defaultRefRes.success &&
      defaultRefRes.stdout.trim().startsWith("refs/remotes/origin/")
        ? defaultRefRes.stdout.trim().replace(/^refs\/remotes\/origin\//, "")
        : null

    const worktreeMap = new Map<string, string>()
    for (const wt of worktrees) {
      if (wt.branch) {
        worktreeMap.set(wt.branch, wt.path)
      }
    }

    const resultBranches = branches.map((b) => {
      let remoteName: string | undefined
      if (b.isRemote) {
        const slashIdx = b.name.indexOf("/")
        if (slashIdx > 0) {
          remoteName = b.name.slice(0, slashIdx)
        }
      }
      const isDefault = b.isRemote
        ? b.name === `origin/${defaultBranch}`
        : b.name === defaultBranch

      return {
        name: b.name,
        current: b.isCurrent,
        isRemote: b.isRemote,
        remoteName,
        isDefault,
        worktreePath: worktreeMap.get(b.name) ?? null,
      }
    })

    return {
      isRepo: true,
      hasOriginRemote,
      branches: resultBranches,
    }
  }

  async createCommit(
    cwd: string,
    message: string,
    options?: {
      author?: { name: string; email: string }
      timestamp?: number
      allowEmpty?: boolean
    },
  ): Promise<string> {
    const args = ["commit", "-m", message]
    if (options?.allowEmpty) {
      args.push("--allow-empty")
    }

    const env: Record<string, string> = {}
    if (options?.author) {
      env["GIT_AUTHOR_NAME"] = options.author.name
      env["GIT_AUTHOR_EMAIL"] = options.author.email
      env["GIT_COMMITTER_NAME"] = options.author.name
      env["GIT_COMMITTER_EMAIL"] = options.author.email
    }
    if (options?.timestamp) {
      const tsStr = String(Math.floor(options.timestamp / 1000))
      env["GIT_AUTHOR_DATE"] = tsStr
      env["GIT_COMMITTER_DATE"] = tsStr
    }

    await this.process.execute(args, { cwd, env })
    const oid = await this.getCommitOid(cwd, "HEAD")
    return oid!
  }

  async writeTree(cwd: string, tempIndexFile?: string): Promise<string> {
    const env: Record<string, string> = {}
    if (tempIndexFile) {
      env["GIT_INDEX_FILE"] = tempIndexFile
    }
    const res = await this.process.execute(["write-tree"], { cwd, env })
    return res.stdout.trim()
  }
}
