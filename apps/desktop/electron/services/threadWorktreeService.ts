/**
 * Production service for Assistant thread worktrees.
 *
 * Master Specification: Section 24.2, Section 32.12 (U02).
 * Invariants:
 * - Assistant threadWorktree writes remain private and isolated outside
 *   the Session Workspace root so projectd observes nothing.
 * - Explicit Apply/Adopt imports the full worktree delta (additions, modifications,
 *   and deletions) into the Session Workspace through the normal filesystem boundary,
 *   after which projectd synchronizes them.
 * - Workspace authorization and path sanitization prevent root escape or arbitrary writes.
 */

import fs from "node:fs"
import path from "node:path"
import os from "node:os"
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
  error?: string
}

export interface ApplyThreadWorktreeInput {
  worktreePath: string
  workspaceRoot: string
  relativePaths?: string[]
}

export interface ApplyThreadWorktreeResult {
  success: boolean
  appliedFiles: string[]
  error?: string
}

export function resolveDefaultThreadWorktreePath(threadId: string): string {
  const sanitized = threadId.replace(/[^a-zA-Z0-9_-]/g, "_")
  return path.join(os.tmpdir(), "cozea-thread-worktrees", sanitized)
}

function copyDirectoryContentsRecursive(source: string, target: string): void {
  if (!fs.existsSync(source)) return
  fs.mkdirSync(target, { recursive: true })
  const entries = fs.readdirSync(source, { withFileTypes: true })
  for (const entry of entries) {
    if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".cozea") continue
    const srcPath = path.join(source, entry.name)
    const dstPath = path.join(target, entry.name)
    if (entry.isSymbolicLink()) {
      try {
        const linkTarget = fs.readlinkSync(srcPath)
        fs.symlinkSync(linkTarget, dstPath)
      } catch {
        // Fallback to copy if symlink fails
        fs.copyFileSync(srcPath, dstPath)
      }
    } else if (entry.isDirectory()) {
      copyDirectoryContentsRecursive(srcPath, dstPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath)
    }
  }
}

/**
 * Validates that worktreePath is legitimately outside workspaceRoot and holds valid provenance.
 */
export async function validateWorktreeProvenance(
  worktreePath: string,
  workspaceRoot: string,
): Promise<{ ok: boolean; reason?: string }> {
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

  // Check git worktree linkage if git is present
  const gitFile = path.join(resolvedWorktree, ".git")
  if (fs.existsSync(gitFile)) {
    try {
      const gitFileContent = fs.readFileSync(gitFile, "utf8").trim()
      // A git worktree .git is a file starting with "gitdir: ..."
      if (gitFileContent.startsWith("gitdir:")) {
        const linkedDir = gitFileContent.slice(7).trim()
        const resolvedLink = path.resolve(resolvedWorktree, linkedDir)
        // If workspaceRoot has .git, verify linkage points to it
        const workspaceGit = path.join(resolvedWorkspace, ".git")
        if (fs.existsSync(workspaceGit)) {
          const resolvedWorkspaceGit = fs.realpathSync(workspaceGit)
          if (!resolvedLink.startsWith(resolvedWorkspaceGit)) {
            return { ok: false, reason: "Worktree gitdir does not originate from the target Session Workspace repository." }
          }
        }
      }
    } catch {
      // Non-fatal if parsing fails
    }
  }

  return { ok: true }
}

/**
 * Validates that relativePath does not escape rootDir.
 */
export function sanitizeRelativePath(rel: string, rootDir: string): string | null {
  if (!rel || typeof rel !== "string" || rel.includes("\0")) return null
  if (path.isAbsolute(rel)) return null

  const normalized = path.normalize(rel).replace(/^(\.\.(\/|\\|$))+/, "")
  if (!normalized || normalized === "." || normalized.startsWith("..")) return null

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
      await exec("git", ["worktree", "add", "--detach", resolvedTarget, branch], {
        cwd: input.workspaceRoot,
      })
      return {
        success: true,
        worktreePath: resolvedTarget,
        isGitWorktree: true,
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
    copyDirectoryContentsRecursive(input.workspaceRoot, resolvedTarget)
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

/**
 * Explicit Apply/Adopt: applies the complete worktree delta (additions, modifications, deletions)
 * into the Session Workspace through the normal filesystem boundary, after which projectd synchronizes them.
 */
export async function applyThreadWorktreeToWorkspace(
  input: ApplyThreadWorktreeInput,
): Promise<ApplyThreadWorktreeResult> {
  const { worktreePath, workspaceRoot } = input
  const resolvedWorktree = path.resolve(worktreePath)
  const resolvedWorkspace = path.resolve(workspaceRoot)

  const check = await validateWorktreeProvenance(resolvedWorktree, resolvedWorkspace)
  if (!check.ok) {
    return { success: false, appliedFiles: [], error: check.reason }
  }

  const appliedFiles: string[] = []

  // If specific relative paths requested, validate and apply only those
  if (input.relativePaths && input.relativePaths.length > 0) {
    for (const rawRel of input.relativePaths) {
      const rel = sanitizeRelativePath(rawRel, resolvedWorkspace)
      if (!rel) continue

      const src = path.join(resolvedWorktree, rel)
      const dst = path.join(resolvedWorkspace, rel)

      if (fs.existsSync(src)) {
        fs.mkdirSync(path.dirname(dst), { recursive: true })
        fs.copyFileSync(src, dst)
        appliedFiles.push(rel)
      } else if (fs.existsSync(dst)) {
        fs.rmSync(dst, { force: true })
        appliedFiles.push(rel)
      }
    }
    return { success: true, appliedFiles }
  }

  // Full delta mode: walk both trees to handle additions, modifications, and deletions
  const worktreeFiles = new Map<string, fs.Dirent>()
  const workspaceFiles = new Map<string, fs.Dirent>()

  function collectFiles(dir: string, base: string, map: Map<string, fs.Dirent>) {
    if (!fs.existsSync(dir)) return
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".cozea") continue
      const fullPath = path.join(dir, entry.name)
      const relPath = path.relative(base, fullPath)

      if (entry.isDirectory()) {
        collectFiles(fullPath, base, map)
      } else {
        map.set(relPath, entry)
      }
    }
  }

  collectFiles(resolvedWorktree, resolvedWorktree, worktreeFiles)
  collectFiles(resolvedWorkspace, resolvedWorkspace, workspaceFiles)

  // 1. Deletions: Files in Session Workspace that no longer exist in private worktree
  for (const [relPath] of workspaceFiles.entries()) {
    if (!worktreeFiles.has(relPath)) {
      const dst = path.join(resolvedWorkspace, relPath)
      try {
        fs.rmSync(dst, { force: true })
        appliedFiles.push(relPath)
      } catch (err) {
        console.warn(`[ThreadWorktreeService] Failed to delete removed file ${relPath}:`, err)
      }
    }
  }

  // 2. Additions and Modifications: Files in private worktree that are new or differing
  for (const [relPath, entry] of worktreeFiles.entries()) {
    const src = path.join(resolvedWorktree, relPath)
    const dst = path.join(resolvedWorkspace, relPath)

    let isDifferent = true
    if (workspaceFiles.has(relPath) && fs.existsSync(dst)) {
      if (entry.isSymbolicLink()) {
        try {
          const srcLink = fs.readlinkSync(src)
          const dstLink = fs.readlinkSync(dst)
          isDifferent = srcLink !== dstLink
        } catch {
          isDifferent = true
        }
      } else {
        try {
          const srcBuf = fs.readFileSync(src)
          const dstBuf = fs.readFileSync(dst)
          isDifferent = !srcBuf.equals(dstBuf)
        } catch {
          isDifferent = true
        }
      }
    }

    if (isDifferent) {
      fs.mkdirSync(path.dirname(dst), { recursive: true })
      if (entry.isSymbolicLink()) {
        try {
          if (fs.existsSync(dst)) fs.rmSync(dst, { force: true })
          const linkTarget = fs.readlinkSync(src)
          fs.symlinkSync(linkTarget, dst)
          appliedFiles.push(relPath)
        } catch {
          fs.copyFileSync(src, dst)
          appliedFiles.push(relPath)
        }
      } else {
        fs.copyFileSync(src, dst)
        appliedFiles.push(relPath)
      }
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
