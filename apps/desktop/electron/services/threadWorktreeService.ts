/**
 * Production service for Assistant thread worktrees.
 *
 * Master Specification: Section 24.2, Section 32.12 (U02).
 * Invariants:
 * - Assistant threadWorktree writes remain private and isolated outside
 *   the Session Workspace root so projectd observes nothing.
 * - Explicit Apply/Adopt imports changes into the Session Workspace through
 *   the normal filesystem boundary, after which projectd synchronizes them.
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
    if (entry.name === ".git" || entry.name === "node_modules") continue
    const srcPath = path.join(source, entry.name)
    const dstPath = path.join(target, entry.name)
    if (entry.isDirectory()) {
      copyDirectoryContentsRecursive(srcPath, dstPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath)
    }
  }
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
    throw new Error("Private thread worktree path must be outside the Session Workspace root.")
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
 * Explicit Apply/Adopt: copies modified/added files from private worktree into the Session Workspace
 * through the normal filesystem boundary, after which projectd synchronizes them.
 */
export async function applyThreadWorktreeToWorkspace(
  input: ApplyThreadWorktreeInput,
): Promise<ApplyThreadWorktreeResult> {
  const { worktreePath, workspaceRoot } = input
  const resolvedWorktree = path.resolve(worktreePath)
  const resolvedWorkspace = path.resolve(workspaceRoot)

  if (!fs.existsSync(resolvedWorktree)) {
    return { success: false, appliedFiles: [], error: `Worktree path ${worktreePath} does not exist.` }
  }
  if (!fs.existsSync(resolvedWorkspace)) {
    return { success: false, appliedFiles: [], error: `Workspace root ${workspaceRoot} does not exist.` }
  }

  const appliedFiles: string[] = []

  // If specific relative paths requested, apply only those
  if (input.relativePaths && input.relativePaths.length > 0) {
    for (const rel of input.relativePaths) {
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

  // Otherwise, scan worktree for changes
  function scanAndApply(dir: string, base: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const entry of entries) {
      if (entry.name === ".git" || entry.name === "node_modules") continue
      const fullSrc = path.join(dir, entry.name)
      const rel = path.relative(base, fullSrc)
      const fullDst = path.join(resolvedWorkspace, rel)

      if (entry.isDirectory()) {
        scanAndApply(fullSrc, base)
      } else if (entry.isFile()) {
        let isDifferent = true
        if (fs.existsSync(fullDst)) {
          const srcBuf = fs.readFileSync(fullSrc)
          const dstBuf = fs.readFileSync(fullDst)
          isDifferent = !srcBuf.equals(dstBuf)
        }
        if (isDifferent) {
          fs.mkdirSync(path.dirname(fullDst), { recursive: true })
          fs.copyFileSync(fullSrc, fullDst)
          appliedFiles.push(rel)
        }
      }
    }
  }

  scanAndApply(resolvedWorktree, resolvedWorktree)
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
