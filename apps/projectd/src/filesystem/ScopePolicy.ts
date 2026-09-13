/**
 * Scope policy for workspace filesystem observation.
 *
 * Master Specification: Section 12.10
 * Invariants:
 * - C38: .git is not replicated project content.
 * - C39: Tracked files are shared regardless of folder name (vendor, dist, build).
 * - C40: Ignored local state stays local by default. A session that shares env files
 *   admits them anyway (environmentFiles.ts); AutoGit still never commits them.
 * - C41: Shared file membership is sticky once admitted.
 */

import path from "node:path"
import type { GitService } from "../git/GitService"
import { isSharedEnvironmentFile } from "./environmentFiles"

export const TRANSIENT_EDITOR_PATTERNS = [
  /\.DS_Store$/,
  /Thumbs\.db$/,
  /\.Spotlight-V100/,
  /\.Trashes/,
  /\.swp$/,
  /\.swo$/,
  /~$/,
  /^\.#/,
  /\.tmp\./,
  /\.crswap$/,
  // Local copies the materializer keeps when disk diverged; they stay on this machine.
  /\.conflict\.\d+$/,
]

export class ScopePolicy {
  readonly workspaceRoot: string
  readonly gitService?: GitService
  /** Whether env files join the session even though Git ignores them. */
  readonly shareEnvironmentFiles: boolean
  private readonly admittedFiles = new Set<string>()

  constructor(workspaceRoot: string, gitService?: GitService, options: { shareEnvironmentFiles?: boolean } = {}) {
    this.workspaceRoot = path.resolve(workspaceRoot)
    this.gitService = gitService
    this.shareEnvironmentFiles = options.shareEnvironmentFiles === true
  }

  isAdmitted(relativePath: string): boolean {
    const normalized = this.normalizeRelativePath(relativePath)
    return this.admittedFiles.has(normalized)
  }

  admit(relativePath: string): void {
    const normalized = this.normalizeRelativePath(relativePath)
    this.admittedFiles.add(normalized)
  }

  unadmit(relativePath: string): void {
    const normalized = this.normalizeRelativePath(relativePath)
    this.admittedFiles.delete(normalized)
  }

  normalizeRelativePath(p: string): string {
    let rel = p
    if (path.isAbsolute(p)) {
      rel = path.relative(this.workspaceRoot, p)
    }
    return rel.replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "")
  }

  isTransientEditorFile(relativePath: string): boolean {
    const baseName = path.basename(relativePath)
    return TRANSIENT_EDITOR_PATTERNS.some((pattern) => pattern.test(baseName))
  }

  /**
   * Fast synchronous pre-filter for ignore/scope decisions.
   */
  isAlwaysIgnored(relativePath: string): boolean {
    const norm = this.normalizeRelativePath(relativePath)

    // Invariant C38: .git is never replicated project content
    if (norm === ".git" || norm.startsWith(".git/")) {
      return true
    }

    if (this.isTransientEditorFile(norm)) {
      return true
    }

    return false
  }

  /**
   * Evaluates whether a path is in-scope for collaboration.
   *
   * Rules:
   * 1. If always ignored (.git, transients) -> false.
   * 2. Invariant C41: If already admitted, membership is sticky -> true.
   * 3. Env files, when the session shares them -> true.
   * 4. Invariant C39 & C40: Query GitService for ignore rules. If tracked or not ignored -> true.
   */
  async isInScope(relativePath: string, isTrackedHint = false): Promise<boolean> {
    const norm = this.normalizeRelativePath(relativePath)

    if (this.isAlwaysIgnored(norm)) {
      return false
    }

    // Invariant C41: Sticky membership
    if (this.admittedFiles.has(norm)) {
      return true
    }

    // Invariant C39: Tracked files are ALWAYS in scope regardless of directory name
    if (isTrackedHint) {
      this.admittedFiles.add(norm)
      return true
    }

    if (this.shareEnvironmentFiles && isSharedEnvironmentFile(norm)) {
      return true
    }

    // Invariant C40: Check git ignore rules if git service available
    if (this.gitService) {
      try {
        const ignored = await this.gitService.checkIgnore(this.workspaceRoot, [norm])
        if (ignored.has(norm)) {
          return false
        }
      } catch {
        // If git check-ignore fails, fall back to in-scope
      }
    }

    return true
  }

  /**
   * Batch filter for scanning or mass file events.
   */
  async filterInScopePaths(relativePaths: string[]): Promise<string[]> {
    const candidatePaths: string[] = []
    const inScope: string[] = []

    for (const p of relativePaths) {
      const norm = this.normalizeRelativePath(p)
      if (this.isAlwaysIgnored(norm)) {
        continue
      }
      if (this.admittedFiles.has(norm) || (this.shareEnvironmentFiles && isSharedEnvironmentFile(norm))) {
        inScope.push(norm)
        continue
      }
      candidatePaths.push(norm)
    }

    if (candidatePaths.length === 0) {
      return inScope
    }

    if (!this.gitService) {
      return [...inScope, ...candidatePaths]
    }

    try {
      const ignoredSet = await this.gitService.checkIgnore(this.workspaceRoot, candidatePaths)
      for (const p of candidatePaths) {
        if (!ignoredSet.has(p)) {
          inScope.push(p)
        }
      }
    } catch {
      inScope.push(...candidatePaths)
    }

    return inScope
  }
}
