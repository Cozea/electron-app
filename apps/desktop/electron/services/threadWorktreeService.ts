/**
 * Production service for Assistant thread worktrees.
 *
 * Master Specification: Section 24.2, Section 32.12 (U02).
 * Invariants:
 * - Assistant threadWorktree writes remain private and isolated outside
 *   the Session Workspace root so projectd observes nothing.
 * - Explicit Apply/Adopt imports changes into the Session Workspace through
 *   the normal filesystem boundary, after which projectd synchronizes them.
 * - Base-Aware Delta (B/R/L Discipline):
 *     B = state/commit from which private worktree was created
 *     R = private worktree result
 *     L = current live Session Workspace
 *   Only Δ(B → R) is applied onto L. Untouched files (peer additions/modifications in L)
 *   are strictly preserved. Conflicting concurrent edits are detected and protected.
 * - Strict Provenance: Worktrees must be registered worktrees of the authorized workspace.
 * - Strict Path Sanitization: Traversal (..) and absolute paths are rejected, not reinterpreted.
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
import crypto from "node:crypto"
import { execFile } from "node:child_process"
import { promisify } from "node:util"

const exec = promisify(execFile)

export interface CreateThreadWorktreeInput {
  workspaceRoot: string
  threadId: string
  branch?: string | null
  customWorktreePath?: string | null
}

export interface CreateThreadWorktreeResult {
  success: boolean
  worktreePath: string
  isGitWorktree: boolean
  baseCommit?: string
  error?: string
}

export interface ApplyThreadWorktreeInput {
  worktreePath: string
  workspaceRoot: string
  relativePaths?: string[]
}

export interface ApplyThreadWorktreeConflict {
  path: string
  kind: "add_conflict" | "modify_conflict" | "delete_conflict"
  message: string
}

export interface ApplyThreadWorktreeResult {
  success: boolean
  appliedFiles: string[]
  conflicts?: ApplyThreadWorktreeConflict[]
  error?: string
}

interface RegisteredWorktreeEntry {
  workspaceRoot: string
  threadId: string
  createdAt: number
  baseCommit?: string
  baseFileHashes?: Map<string, string>
}

// In-memory main-process registry tracking private worktree provenance
const registeredPrivateWorktrees = new Map<string, RegisteredWorktreeEntry>()

export function resolveDefaultThreadWorktreePath(threadId: string): string {
  const sanitized = threadId.replace(/[^a-zA-Z0-9_-]/g, "_")
  return path.join(os.tmpdir(), "cozea-thread-worktrees", sanitized)
}

function hashContent(content: Buffer | string): string {
  return crypto.createHash("sha256").update(content).digest("hex")
}

function copyDirectoryContentsRecursive(source: string, target: string, hashesMap?: Map<string, string>, baseRel = ""): void {
  if (!fs.existsSync(source)) return
  fs.mkdirSync(target, { recursive: true })
  const entries = fs.readdirSync(source, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".cozea") continue
    const srcPath = path.join(source, entry.name)
    const dstPath = path.join(target, entry.name)
    const relPath = baseRel ? `${baseRel}/${entry.name}` : entry.name

    if (entry.isSymbolicLink()) {
      try {
        const linkTarget = fs.readlinkSync(srcPath)
        fs.symlinkSync(linkTarget, dstPath)
      } catch {
        fs.copyFileSync(srcPath, dstPath)
      }
    } else if (entry.isDirectory()) {
      copyDirectoryContentsRecursive(srcPath, dstPath, hashesMap, relPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath)
      if (hashesMap) {
        try {
          const buf = fs.readFileSync(srcPath)
          hashesMap.set(relPath, hashContent(buf))
        } catch {
          // Non-fatal
        }
      }
    }
  }
}

/**
 * Validates that worktreePath is legitimately outside workspaceRoot and holds valid provenance.
 * Rejects arbitrary external directories.
 */
export async function validateWorktreeProvenance(
  worktreePath: string,
  workspaceRoot: string,
): Promise<{ ok: boolean; reason?: string; baseCommit?: string; baseHashes?: Map<string, string> }> {
  const resolvedWorktree = path.resolve(worktreePath)
  const resolvedWorkspace = path.resolve(workspaceRoot)

  if (resolvedWorktree === resolvedWorkspace || resolvedWorktree.startsWith(resolvedWorkspace + path.sep)) {
    return { ok: false, reason: "Private worktree cannot be inside or equal to the Session Workspace root." }
  }

  if (!fs.existsSync(resolvedWorktree)) {
    return { ok: false, reason: `Worktree path ${worktreePath} does not exist.` }
  }

  const stat = fs.statSync(resolvedWorktree)
  if (!stat.isDirectory()) {
    return { ok: false, reason: `Worktree path ${worktreePath} is not a directory.` }
  }

  // Check Git worktree provenance
  const workspaceGit = path.join(resolvedWorkspace, ".git")
  let isGitWorkspace = false
  try {
    const { stdout } = await exec("git", ["rev-parse", "--is-inside-work-tree"], { cwd: resolvedWorkspace })
    isGitWorkspace = stdout.trim() === "true"
  } catch {
    isGitWorkspace = false
  }

  if (isGitWorkspace && fs.existsSync(workspaceGit)) {
    try {
      // 1. Verify that worktreePath is an active registered worktree of workspaceRoot
      const realWorktree = fs.realpathSync(resolvedWorktree)
      const { stdout: wtListOut } = await exec("git", ["worktree", "list", "--porcelain"], { cwd: resolvedWorkspace })
      const registeredPaths = wtListOut
        .split("\n")
        .filter((line) => line.startsWith("worktree "))
        .map((line) => {
          const p = line.slice(9).trim()
          try {
            return fs.realpathSync(p)
          } catch {
            return path.resolve(p)
          }
        })

      const isListed = registeredPaths.some((p) => p === realWorktree)
      if (!isListed) {
        return { ok: false, reason: `Worktree path ${worktreePath} is not a registered worktree of the authorized workspace.` }
      }

      // 2. Verify .git file linkage inside the worktree
      const gitFile = path.join(resolvedWorktree, ".git")
      if (!fs.existsSync(gitFile)) {
        return { ok: false, reason: "Worktree missing required .git linkage file." }
      }
      const gitFileContent = fs.readFileSync(gitFile, "utf8").trim()
      if (!gitFileContent.startsWith("gitdir:")) {
        return { ok: false, reason: "Worktree .git file format invalid." }
      }
      const linkedDir = gitFileContent.slice(7).trim()
      const resolvedLink = path.resolve(resolvedWorktree, linkedDir)
      const resolvedWorkspaceGit = fs.realpathSync(workspaceGit)
      if (!resolvedLink.startsWith(resolvedWorkspaceGit)) {
        return { ok: false, reason: "Worktree gitdir does not originate from the target Session Workspace repository." }
      }

      // Check registered record for baseCommit if available
      const record = registeredPrivateWorktrees.get(resolvedWorktree)
      let baseCommit = record?.baseCommit
      if (!baseCommit) {
        // Fallback: read HEAD commit from linked gitdir or worktree
        try {
          const { stdout: headOut } = await exec("git", ["rev-parse", "HEAD"], { cwd: resolvedWorktree })
          baseCommit = headOut.trim()
        } catch {
          // ignore
        }
      }

      return { ok: true, baseCommit }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err)
      return { ok: false, reason: `Git worktree verification failed: ${msg}` }
    }
  }

  // Non-git fallback: must exist in registeredPrivateWorktrees created for this workspace
  const record = registeredPrivateWorktrees.get(resolvedWorktree)
  if (!record || path.resolve(record.workspaceRoot) !== resolvedWorkspace) {
    return { ok: false, reason: "Worktree path is not registered as an authorized private thread worktree." }
  }

  return { ok: true, baseHashes: record.baseFileHashes }
}

/**
 * Rejects any relativePath containing traversal components (..), absolute paths, empty, or null bytes.
 * Never modifies or strips traversal components.
 */
export function sanitizeSafeRelativePath(rel: string, rootDir: string): string | null {
  if (!rel || typeof rel !== "string" || rel.includes("\0")) return null
  if (path.isAbsolute(rel)) return null

  // Reject traversal components explicitly
  const segments = rel.split(/[/\\]/)
  if (segments.some((seg) => seg === ".." || seg === "." || seg.length === 0)) {
    return null
  }

  const normalized = path.normalize(rel)
  if (normalized.startsWith("..") || path.isAbsolute(normalized)) {
    return null
  }

  const full = path.resolve(rootDir, normalized)
  const resolvedRoot = path.resolve(rootDir)
  if (full !== resolvedRoot && !full.startsWith(resolvedRoot + path.sep)) {
    return null
  }

  return normalized
}

/**
 * Creates a private thread worktree strictly outside the Session Workspace root.
 */
export async function createPrivateThreadWorktree(
  input: CreateThreadWorktreeInput,
): Promise<CreateThreadWorktreeResult> {
  const targetPath = input.customWorktreePath?.trim()
    ? path.resolve(input.customWorktreePath)
    : resolveDefaultThreadWorktreePath(input.threadId)

  // Ensure targetPath is outside workspaceRoot
  const resolvedTarget = path.resolve(targetPath)
  const resolvedWorkspace = path.resolve(input.workspaceRoot)
  if (resolvedTarget === resolvedWorkspace || resolvedTarget.startsWith(resolvedWorkspace + path.sep)) {
    return {
      success: false,
      worktreePath: resolvedTarget,
      isGitWorktree: false,
      error: "Private thread worktree path must be outside the Session Workspace root.",
    }
  }

  // Check if workspaceRoot is a git repository
  let isGitRepo = false
  try {
    const { stdout } = await exec("git", ["rev-parse", "--is-inside-work-tree"], {
      cwd: input.workspaceRoot,
    })
    isGitRepo = stdout.trim() === "true"
  } catch {
    isGitRepo = false
  }

  if (isGitRepo) {
    try {
      fs.mkdirSync(path.dirname(resolvedTarget), { recursive: true })
      if (fs.existsSync(resolvedTarget)) {
        fs.rmSync(resolvedTarget, { recursive: true, force: true })
      }
      const branch = input.branch?.trim() || "HEAD"
      const { stdout: headOut } = await exec("git", ["rev-parse", branch], {
        cwd: input.workspaceRoot,
      })
      const baseCommit = headOut.trim()

      await exec("git", ["worktree", "add", "--detach", resolvedTarget, branch], {
        cwd: input.workspaceRoot,
      })

      registeredPrivateWorktrees.set(resolvedTarget, {
        workspaceRoot: resolvedWorkspace,
        threadId: input.threadId,
        createdAt: Date.now(),
        baseCommit,
      })

      return {
        success: true,
        worktreePath: resolvedTarget,
        isGitWorktree: true,
        baseCommit,
      }
    } catch (gitErr: unknown) {
      console.warn("[ThreadWorktreeService] git worktree add failed, falling back to directory copy:", gitErr)
    }
  }

  // Fallback: directory copy outside workspaceRoot
  try {
    if (fs.existsSync(resolvedTarget)) {
      fs.rmSync(resolvedTarget, { recursive: true, force: true })
    }
    fs.mkdirSync(resolvedTarget, { recursive: true })
    const baseHashes = new Map<string, string>()
    copyDirectoryContentsRecursive(input.workspaceRoot, resolvedTarget, baseHashes)

    registeredPrivateWorktrees.set(resolvedTarget, {
      workspaceRoot: resolvedWorkspace,
      threadId: input.threadId,
      createdAt: Date.now(),
      baseFileHashes: baseHashes,
    })

    return {
      success: true,
      worktreePath: resolvedTarget,
      isGitWorktree: false,
    }
  } catch (err: unknown) {
    const msg = err instanceof Error ? err.message : String(err)
    return {
      success: false,
      worktreePath: resolvedTarget,
      isGitWorktree: false,
      error: `Failed to create private thread worktree: ${msg}`,
    }
  }
}

interface TouchedPathDelta {
  path: string
  action: "add" | "modify" | "delete"
}

/**
 * Discovers the exact delta Δ(B → R) touched by the agent in the private worktree.
 * Does NOT touch unrelated files in the Session Workspace (L).
 */
async function computeWorktreeDelta(
  resolvedWorktree: string,
  baseCommit?: string,
  baseHashes?: Map<string, string>,
): Promise<TouchedPathDelta[]> {
  const deltas = new Map<string, TouchedPathDelta>()

  if (baseCommit) {
    try {
      // 1. Modified, added, deleted files tracked relative to baseCommit
      const { stdout: diffOut } = await exec("git", ["diff", "--name-status", baseCommit], {
        cwd: resolvedWorktree,
      })
      for (const line of diffOut.split("\n")) {
        const trimmed = line.trim()
        if (!trimmed) continue
        const [status, ...pathParts] = trimmed.split(/\s+/)
        const relPath = pathParts.join(" ")
        if (!relPath || relPath.startsWith(".git/") || relPath === ".git") continue

        if (status.startsWith("M")) {
          deltas.set(relPath, { path: relPath, action: "modify" })
        } else if (status.startsWith("A")) {
          deltas.set(relPath, { path: relPath, action: "add" })
        } else if (status.startsWith("D")) {
          deltas.set(relPath, { path: relPath, action: "delete" })
        }
      }

      // 2. Untracked files added by the agent
      const { stdout: untrackedOut } = await exec("git", ["ls-files", "--others", "--exclude-standard"], {
        cwd: resolvedWorktree,
      })
      for (const line of untrackedOut.split("\n")) {
        const relPath = line.trim()
        if (!relPath || relPath.startsWith(".git/")) continue
        deltas.set(relPath, { path: relPath, action: "add" })
      }

      return Array.from(deltas.values())
    } catch {
      // Fall through to hash comparison if git diff fails
    }
  }

  // Non-git or fallback hash comparison against recorded baseHashes
  if (baseHashes) {
    const currentWorktreeFiles = new Map<string, string>()

    function scanHashes(dir: string, base: string) {
      if (!fs.existsSync(dir)) return
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".cozea") continue
        const full = path.join(dir, entry.name)
        const rel = path.relative(base, full)
        if (entry.isDirectory()) {
          scanHashes(full, base)
        } else if (entry.isFile()) {
          try {
            const buf = fs.readFileSync(full)
            currentWorktreeFiles.set(rel, hashContent(buf))
          } catch {
            // ignore
          }
        }
      }
    }

    scanHashes(resolvedWorktree, resolvedWorktree)

    // Check additions and modifications
    for (const [rel, hashR] of currentWorktreeFiles.entries()) {
      const hashB = baseHashes.get(rel)
      if (!hashB) {
        deltas.set(rel, { path: rel, action: "add" })
      } else if (hashB !== hashR) {
        deltas.set(rel, { path: rel, action: "modify" })
      }
    }

    // Check deletions
    for (const [rel] of baseHashes.entries()) {
      if (!currentWorktreeFiles.has(rel)) {
        deltas.set(rel, { path: rel, action: "delete" })
      }
    }

    return Array.from(deltas.values())
  }

  return []
}

/**
 * Reads content at base B (using git show or baseHashes).
 */
async function readBaseContent(
  resolvedWorktree: string,
  relPath: string,
  baseCommit?: string,
): Promise<Buffer | null> {
  if (baseCommit) {
    try {
      const { stdout } = await exec("git", ["show", `${baseCommit}:${relPath}`], {
        cwd: resolvedWorktree,
        encoding: "buffer",
        maxBuffer: 32 * 1024 * 1024,
      })
      return Buffer.from(stdout)
    } catch {
      return null
    }
  }
  return null
}

/**
 * Base-Aware Apply/Adopt: applies Δ(B → R) onto L.
 * Strictly preserves live files in L that the agent did not touch (peer additions and edits).
 * Detects conflicts when both agent and peer concurrently modified the same file or deletion overlaps edits.
 */
export async function applyThreadWorktreeToWorkspace(
  input: ApplyThreadWorktreeInput,
): Promise<ApplyThreadWorktreeResult> {
  const { worktreePath, workspaceRoot } = input
  const resolvedWorktree = path.resolve(worktreePath)
  const resolvedWorkspace = path.resolve(workspaceRoot)

  const provenance = await validateWorktreeProvenance(resolvedWorktree, resolvedWorkspace)
  if (!provenance.ok) {
    return { success: false, appliedFiles: [], error: provenance.reason }
  }

  // 1. Identify paths to evaluate
  let targetPaths: TouchedPathDelta[]
  if (input.relativePaths && input.relativePaths.length > 0) {
    targetPaths = []
    for (const rawRel of input.relativePaths) {
      const rel = sanitizeSafeRelativePath(rawRel, resolvedWorkspace)
      if (!rel) {
        return {
          success: false,
          appliedFiles: [],
          error: `Path traversal or invalid relative path rejected: ${rawRel}`,
        }
      }
      const src = path.join(resolvedWorktree, rel)
      const existsInWorktree = fs.existsSync(src)
      targetPaths.push({
        path: rel,
        action: existsInWorktree ? "modify" : "delete",
      })
    }
  } else {
    targetPaths = await computeWorktreeDelta(resolvedWorktree, provenance.baseCommit, provenance.baseHashes)
  }

  const appliedFiles: string[] = []
  const conflicts: ApplyThreadWorktreeConflict[] = []

  // 2. Evaluate each touched path using B / R / L three-way comparison
  for (const delta of targetPaths) {
    const rel = delta.path
    const src = path.join(resolvedWorktree, rel)
    const dst = path.join(resolvedWorkspace, rel)

    const baseBytes = await readBaseContent(resolvedWorktree, rel, provenance.baseCommit)
    const existsInR = fs.existsSync(src)
    const existsInL = fs.existsSync(dst)

    const bytesR = existsInR ? fs.readFileSync(src) : null
    const bytesL = existsInL ? fs.readFileSync(dst) : null

    // Case A: Agent added new file (not in base)
    if (baseBytes === null && existsInR) {
      if (!existsInL) {
        // Safe addition: L does not have it -> copy R to L
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(src, dst)
        appliedFiles.push(rel)
      } else {
        // Peer also created a file at rel in L
        if (bytesL && bytesR && bytesL.equals(bytesR)) {
          // Converged: identical content
          appliedFiles.push(rel)
        } else {
          conflicts.push({
            path: rel,
            kind: "add_conflict",
            message: `File '${rel}' was added in private worktree but concurrently created by a peer in the Session Workspace.`,
          })
        }
      }
      continue
    }

    // Case B: Agent deleted file (existed in base, absent in R)
    if (baseBytes !== null && !existsInR) {
      if (!existsInL) {
        // Already deleted in L
        appliedFiles.push(rel)
      } else {
        // Check if peer modified the file in L
        if (bytesL && baseBytes.equals(bytesL)) {
          // Safe deletion: peer did not touch it -> delete from L
          try {
            fs.rmSync(dst, { force: true })
            appliedFiles.push(rel)
          } catch (err) {
            console.warn(`[ThreadWorktreeService] Failed to delete ${rel}:`, err)
          }
        } else {
          // Conflict: peer modified file in L while agent deleted it in worktree
          conflicts.push({
            path: rel,
            kind: "delete_conflict",
            message: `File '${rel}' was deleted in private worktree but modified by a peer in the Session Workspace.`,
          })
        }
      }
      continue
    }

    // Case C: Agent modified file (exists in base, exists in R, R != B)
    if (baseBytes !== null && existsInR) {
      if (!existsInL) {
        // Conflict: peer deleted file in L while agent modified it
        conflicts.push({
          path: rel,
          kind: "modify_conflict",
          message: `File '${rel}' was modified in private worktree but deleted by a peer in the Session Workspace.`,
        })
        continue
      }

      if (bytesL && baseBytes.equals(bytesL)) {
        // Safe fast-forward: peer did not modify it in L -> apply R to L
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(src, dst)
        appliedFiles.push(rel)
      } else if (bytesL && bytesR && bytesL.equals(bytesR)) {
        // Converged: peer and agent made identical edit
        appliedFiles.push(rel)
      } else {
        // Conflict: both peer and agent modified the same file
        conflicts.push({
          path: rel,
          kind: "modify_conflict",
          message: `File '${rel}' was concurrently modified in private worktree and by a peer in the Session Workspace.`,
        })
      }
      continue
    }
  }

  if (conflicts.length > 0) {
    return {
      success: false,
      appliedFiles,
      conflicts,
      error: `Conflicting concurrent changes detected on ${conflicts.length} file(s). Peer edits were preserved.`,
    }
  }

  return { success: true, appliedFiles }
}

/**
 * Cleans up and prunes a private thread worktree.
 */
export async function removePrivateThreadWorktree(args: {
  worktreePath: string
  workspaceRoot?: string
}): Promise<void> {
  const resolvedPath = path.resolve(args.worktreePath)
  registeredPrivateWorktrees.delete(resolvedPath)
  if (args.workspaceRoot) {
    try {
      await exec("git", ["worktree", "remove", "--force", resolvedPath], {
        cwd: args.workspaceRoot,
      })
    } catch {
      // Ignore if not a git worktree or already removed
    }
  }
  if (fs.existsSync(resolvedPath)) {
    fs.rmSync(resolvedPath, { recursive: true, force: true })
  }
}
