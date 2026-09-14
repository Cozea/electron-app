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
  baseEntries?: Map<string, EntryFingerprint>
}

type EntryKind = "file" | "symlink"

interface FilesystemEntry {
  kind: EntryKind
  content: Buffer
}

interface EntryFingerprint {
  kind: EntryKind
  contentHash: string
}

interface BaseEntry extends EntryFingerprint {
  content?: Buffer
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

function fingerprintEntry(entry: FilesystemEntry): EntryFingerprint {
  return {
    kind: entry.kind,
    contentHash: hashContent(entry.content),
  }
}

function copyDirectoryContentsRecursive(source: string, target: string, entriesMap?: Map<string, EntryFingerprint>, baseRel = ""): void {
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
        entriesMap?.set(relPath, fingerprintEntry({ kind: "symlink", content: Buffer.from(linkTarget) }))
      } catch {
        fs.copyFileSync(srcPath, dstPath)
      }
    } else if (entry.isDirectory()) {
      copyDirectoryContentsRecursive(srcPath, dstPath, entriesMap, relPath)
    } else if (entry.isFile()) {
      fs.copyFileSync(srcPath, dstPath)
      if (entriesMap) {
        try {
          const buf = fs.readFileSync(srcPath)
          entriesMap.set(relPath, fingerprintEntry({ kind: "file", content: buf }))
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
): Promise<{ ok: boolean; reason?: string; baseCommit?: string; baseEntries?: Map<string, EntryFingerprint> }> {
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

  return { ok: true, baseEntries: record.baseEntries }
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
    const baseEntries = new Map<string, EntryFingerprint>()
    copyDirectoryContentsRecursive(input.workspaceRoot, resolvedTarget, baseEntries)

    registeredPrivateWorktrees.set(resolvedTarget, {
      workspaceRoot: resolvedWorkspace,
      threadId: input.threadId,
      createdAt: Date.now(),
      baseEntries,
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

interface DeltaDiscoveryResult {
  deltas?: TouchedPathDelta[]
  error?: string
}

interface ApplyOperation {
  path: string
  entry: FilesystemEntry | null
}

interface ApplyPlan {
  operations: ApplyOperation[]
  appliedFiles: string[]
  conflicts: ApplyThreadWorktreeConflict[]
}

function readNullDelimited(value: Buffer | string): string[] {
  return Buffer.from(value).toString("utf8").split("\0").filter((item) => item.length > 0)
}

function validateDeltaPath(relPath: string, rootDir: string): string | null {
  return sanitizeSafeRelativePath(relPath, rootDir)
}

/**
 * Discovers the exact delta Δ(B → R) touched by the agent in the private worktree.
 * Does NOT touch unrelated files in the Session Workspace (L).
 */
async function computeWorktreeDelta(
  resolvedWorktree: string,
  baseCommit?: string,
  baseEntries?: Map<string, EntryFingerprint>,
): Promise<DeltaDiscoveryResult> {
  const deltas = new Map<string, TouchedPathDelta>()

  if (baseCommit) {
    try {
      // Disable rename detection deliberately. A rename then becomes a safe, explicit
      // delete + add pair, and NUL framing preserves spaces, tabs, and newlines in names.
      const { stdout: diffOut } = await exec("git", ["diff", "--name-status", "-z", "--no-renames", baseCommit], {
        cwd: resolvedWorktree,
        encoding: "buffer",
      })
      const fields = readNullDelimited(diffOut)
      for (let index = 0; index < fields.length; index += 2) {
        const status = fields[index]
        const rawPath = fields[index + 1]
        if (!status || rawPath === undefined) {
          return { error: "Git returned an incomplete private-worktree delta." }
        }
        const relPath = validateDeltaPath(rawPath, resolvedWorktree)
        if (!relPath || relPath.startsWith(".git/") || relPath === ".git") {
          return { error: `Unsafe path in private-worktree delta was rejected: ${JSON.stringify(rawPath)}` }
        }

        if (status.startsWith("M") || status.startsWith("T")) {
          deltas.set(relPath, { path: relPath, action: "modify" })
        } else if (status.startsWith("A")) {
          deltas.set(relPath, { path: relPath, action: "add" })
        } else if (status.startsWith("D")) {
          deltas.set(relPath, { path: relPath, action: "delete" })
        } else {
          return { error: `Unsupported private-worktree delta status: ${status}` }
        }
      }

      // 2. Untracked files added by the agent
      const { stdout: untrackedOut } = await exec("git", ["ls-files", "-z", "--others", "--exclude-standard"], {
        cwd: resolvedWorktree,
        encoding: "buffer",
      })
      for (const rawPath of readNullDelimited(untrackedOut)) {
        const relPath = validateDeltaPath(rawPath, resolvedWorktree)
        if (!relPath || relPath.startsWith(".git/") || relPath === ".git") {
          return { error: `Unsafe untracked private-worktree path was rejected: ${JSON.stringify(rawPath)}` }
        }
        deltas.set(relPath, { path: relPath, action: "add" })
      }

      return { deltas: Array.from(deltas.values()) }
    } catch {
      // Fall through to hash comparison if git diff fails
    }
  }

  // Non-git or fallback fingerprint comparison against recorded base entries.
  if (baseEntries) {
    const currentWorktreeEntries = new Map<string, EntryFingerprint>()

    function scanEntries(dir: string, base: string) {
      if (!fs.existsSync(dir)) return
      const entries = fs.readdirSync(dir, { withFileTypes: true })
      for (const entry of entries) {
        if (entry.name === ".git" || entry.name === "node_modules" || entry.name === ".cozea") continue
        const full = path.join(dir, entry.name)
        const rel = path.relative(base, full)
        if (entry.isDirectory()) {
          scanEntries(full, base)
        } else if (entry.isSymbolicLink()) {
          try {
            currentWorktreeEntries.set(rel, fingerprintEntry({ kind: "symlink", content: Buffer.from(fs.readlinkSync(full)) }))
          } catch {
            // A vanished entry is observed on the next scan.
          }
        } else if (entry.isFile()) {
          try {
            const buf = fs.readFileSync(full)
            currentWorktreeEntries.set(rel, fingerprintEntry({ kind: "file", content: buf }))
          } catch {
            // ignore
          }
        }
      }
    }

    scanEntries(resolvedWorktree, resolvedWorktree)

    // Check additions and modifications
    for (const [rel, entryR] of currentWorktreeEntries.entries()) {
      const entryB = baseEntries.get(rel)
      if (!entryB) {
        deltas.set(rel, { path: rel, action: "add" })
      } else if (entryB.kind !== entryR.kind || entryB.contentHash !== entryR.contentHash) {
        deltas.set(rel, { path: rel, action: "modify" })
      }
    }

    // Check deletions
    for (const [rel] of baseEntries.entries()) {
      if (!currentWorktreeEntries.has(rel)) {
        deltas.set(rel, { path: rel, action: "delete" })
      }
    }

    return { deltas: Array.from(deltas.values()) }
  }

  return { error: "Private worktree has no verifiable base state." }
}

function isMissing(error: unknown): boolean {
  return Boolean(error && typeof error === "object" && "code" in error && (error as NodeJS.ErrnoException).code === "ENOENT")
}

/** Refuses symlinked ancestor traversal without ever dereferencing a link. */
function assertSafeParent(root: string, relPath: string): void {
  const rootReal = fs.realpathSync.native(root)
  const safeRel = sanitizeSafeRelativePath(relPath, rootReal)
  if (!safeRel) throw new Error(`Unsafe workspace path rejected: ${JSON.stringify(relPath)}`)

  let current = rootReal
  const parents = safeRel.split(path.sep).slice(0, -1)
  for (const segment of parents) {
    current = path.join(current, segment)
    try {
      const stat = fs.lstatSync(current)
      if (stat.isSymbolicLink()) throw new Error(`Path escapes through symlinked parent: ${relPath}`)
      if (!stat.isDirectory()) throw new Error(`Path parent is not a directory: ${relPath}`)
    } catch (error) {
      if (isMissing(error)) return
      throw error
    }
  }
}

function readFilesystemEntry(root: string, relPath: string): FilesystemEntry | null {
  assertSafeParent(root, relPath)
  const fullPath = path.join(fs.realpathSync.native(root), relPath)
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(fullPath)
  } catch (error) {
    if (isMissing(error)) return null
    throw error
  }

  if (stat.isSymbolicLink()) {
    return { kind: "symlink", content: Buffer.from(fs.readlinkSync(fullPath)) }
  }
  if (stat.isFile()) {
    return { kind: "file", content: fs.readFileSync(fullPath) }
  }
  throw new Error(`Private worktree apply only supports files and symlinks: ${relPath}`)
}

async function readGitBaseEntry(
  resolvedWorktree: string,
  relPath: string,
  baseCommit?: string,
): Promise<BaseEntry | null> {
  if (!baseCommit) return null
  try {
    const { stdout: treeOut } = await exec("git", ["ls-tree", "-z", baseCommit, "--", relPath], {
      cwd: resolvedWorktree,
      encoding: "buffer",
    })
    const record = readNullDelimited(treeOut)[0]
    if (!record) return null
    const tabIndex = record.indexOf("\t")
    const header = tabIndex >= 0 ? record.slice(0, tabIndex).split(" ") : []
    const mode = header[0]
    if (mode !== "100644" && mode !== "100755" && mode !== "120000") {
      throw new Error(`Unsupported Git base entry mode for ${relPath}: ${mode ?? "missing"}`)
    }
    const { stdout } = await exec("git", ["show", `${baseCommit}:${relPath}`], {
      cwd: resolvedWorktree,
      encoding: "buffer",
      maxBuffer: 32 * 1024 * 1024,
    })
    const content = Buffer.from(stdout)
    return {
      kind: mode === "120000" ? "symlink" : "file",
      content,
      contentHash: hashContent(content),
    }
  } catch (error) {
    if (error instanceof Error && error.message.startsWith("Unsupported Git base entry mode")) throw error
    return null
  }
}

function matchesBase(entry: FilesystemEntry | null, base: BaseEntry | null): boolean {
  if (!entry || !base || entry.kind !== base.kind) return false
  if (base.content) return entry.content.equals(base.content)
  return hashContent(entry.content) === base.contentHash
}

function entriesEqual(left: FilesystemEntry | null, right: FilesystemEntry | null): boolean {
  if (!left || !right) return left === right
  return left.kind === right.kind && left.content.equals(right.content)
}

function createTemporaryPath(parent: string, basename: string): string {
  return path.join(parent, `.${basename}.cozea-apply-${crypto.randomUUID()}.tmp`)
}

/**
 * Writes an already-preflighted entry without following a destination link.
 * Temporary entries are created in the verified parent, then renamed over the
 * destination so a final symlink is replaced rather than dereferenced.
 */
function writeEntry(root: string, relPath: string, entry: FilesystemEntry): void {
  assertSafeParent(root, relPath)
  const rootReal = fs.realpathSync.native(root)
  const destination = path.join(rootReal, relPath)
  const parent = path.dirname(destination)
  fs.mkdirSync(parent, { recursive: true })
  assertSafeParent(rootReal, relPath)

  const temporary = createTemporaryPath(parent, path.basename(destination))
  try {
    if (entry.kind === "symlink") {
      fs.symlinkSync(entry.content.toString("utf8"), temporary)
    } else {
      const descriptor = fs.openSync(temporary, "wx", 0o600)
      try {
        fs.writeFileSync(descriptor, entry.content)
        fs.fsyncSync(descriptor)
      } finally {
        fs.closeSync(descriptor)
      }
    }
    // Recheck immediately before the commit point. rename replaces a final
    // symlink itself, never its target.
    assertSafeParent(rootReal, relPath)
    fs.renameSync(temporary, destination)
  } catch (error) {
    try {
      fs.unlinkSync(temporary)
    } catch {
      // The temporary either never existed or was committed by rename.
    }
    throw error
  }
}

function deleteEntry(root: string, relPath: string): void {
  assertSafeParent(root, relPath)
  const destination = path.join(fs.realpathSync.native(root), relPath)
  let stat: fs.Stats
  try {
    stat = fs.lstatSync(destination)
  } catch (error) {
    if (isMissing(error)) return
    throw error
  }
  if (!stat.isFile() && !stat.isSymbolicLink()) {
    throw new Error(`Private worktree apply only deletes files and symlinks: ${relPath}`)
  }
  fs.unlinkSync(destination)
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
    const discovered = await computeWorktreeDelta(resolvedWorktree, provenance.baseCommit, provenance.baseEntries)
    if (discovered.error || !discovered.deltas) {
      return { success: false, appliedFiles: [], error: discovered.error ?? "Could not inspect private-worktree changes." }
    }
    targetPaths = discovered.deltas
  }

  // Preflight every path before changing any live file. A conflict must never
  // produce a partial Apply result that the watcher could publish to peers.
  const plan: ApplyPlan = { operations: [], appliedFiles: [], conflicts: [] }
  const seenPaths = new Set<string>()
  for (const delta of targetPaths) {
    const rel = delta.path
    if (seenPaths.has(rel)) continue
    seenPaths.add(rel)

    let base: BaseEntry | null
    try {
      base = provenance.baseCommit
        ? await readGitBaseEntry(resolvedWorktree, rel, provenance.baseCommit)
        : provenance.baseEntries?.get(rel) ?? null
    } catch (error) {
      return { success: false, appliedFiles: [], error: error instanceof Error ? error.message : String(error) }
    }

    let result: FilesystemEntry | null
    let live: FilesystemEntry | null
    try {
      result = readFilesystemEntry(resolvedWorktree, rel)
      live = readFilesystemEntry(resolvedWorkspace, rel)
    } catch (error) {
      return { success: false, appliedFiles: [], error: error instanceof Error ? error.message : String(error) }
    }

    if (!base && result) {
      if (!live) {
        plan.operations.push({ path: rel, entry: result })
      } else if (!entriesEqual(live, result)) {
        plan.conflicts.push({
          path: rel,
          kind: "add_conflict",
          message: `File '${rel}' was added in private worktree but concurrently created by a peer in the Session Workspace.`,
        })
      } else {
        plan.appliedFiles.push(rel)
      }
      continue
    }

    if (base && !result) {
      if (!live) {
        plan.appliedFiles.push(rel)
      } else if (matchesBase(live, base)) {
        plan.operations.push({ path: rel, entry: null })
      } else {
        plan.conflicts.push({
          path: rel,
          kind: "delete_conflict",
          message: `File '${rel}' was deleted in private worktree but modified by a peer in the Session Workspace.`,
        })
      }
      continue
    }

    if (base && result) {
      if (!live) {
        plan.conflicts.push({
          path: rel,
          kind: "modify_conflict",
          message: `File '${rel}' was modified in private worktree but deleted by a peer in the Session Workspace.`,
        })
      } else if (matchesBase(live, base)) {
        plan.operations.push({ path: rel, entry: result })
      } else if (entriesEqual(live, result)) {
        plan.appliedFiles.push(rel)
      } else {
        plan.conflicts.push({
          path: rel,
          kind: "modify_conflict",
          message: `File '${rel}' was concurrently modified in private worktree and by a peer in the Session Workspace.`,
        })
      }
    }
  }

  if (plan.conflicts.length > 0) {
    return {
      success: false,
      appliedFiles: [],
      conflicts: plan.conflicts,
      error: `Conflicting concurrent changes detected on ${plan.conflicts.length} file(s). No files were applied.`,
    }
  }

  try {
    for (const operation of plan.operations) {
      if (operation.entry) {
        writeEntry(resolvedWorkspace, operation.path, operation.entry)
      } else {
        deleteEntry(resolvedWorkspace, operation.path)
      }
      plan.appliedFiles.push(operation.path)
    }
  } catch (error) {
    return {
      success: false,
      appliedFiles: plan.appliedFiles,
      error: `Apply stopped after a filesystem error: ${error instanceof Error ? error.message : String(error)}`,
    }
  }

  return { success: true, appliedFiles: plan.appliedFiles }
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
