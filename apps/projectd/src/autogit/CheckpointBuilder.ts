import { createHash, randomUUID } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { TextDocRegistry } from "../collaboration/TextDocRegistry"
import { GitLfs, type GitLfsCleaner } from "../git/GitLfs"
import type { GitExecutionResult, GitProcessRunner } from "../git/GitProcess"
import type { GitService } from "../git/GitService"
import { fallbackIdentityEnv } from "../git/identity"
import type { BarrierSnapshot, BarrierSnapshotFile } from "./BarrierCapture"

export interface CheckpointCommitInput {
  repoPath: string
  sessionId: string
  parentOid: string | null
  leaseGeneration: number
  snapshot: BarrierSnapshot
  /** Repository-relative prefix for a session rooted below the repository top level. */
  pathPrefix?: string
  /** Largest text file the session can hold. Larger tracked files stay at the parent version. */
  maxTextFileBytes?: number
  /** Explicit-rebase squash tree. The commit still uses parentOid as its sole parent. */
  baseTreeOid?: string | null
}

export interface CheckpointCommitResult {
  commitOid: string
  treeOid: string
  /** The actual parent used by the commit, null for an unborn branch. */
  parentOid: string | null
  /** The tree `treeOid` was compared with to decide whether a commit was necessary. */
  parentTreeOid: string | null
  authorName: string
  authorEmail: string
  env: Record<string, string>
}

export interface CheckpointBuilderOptions {
  /** Resolves plaintext for a captured binary revision. */
  resolveBinary?: (file: Extract<BarrierSnapshotFile, { kind: "binary" }>) => Promise<Buffer>
  /** Tests can substitute a deterministic cleaner without requiring git-lfs on the runner. */
  lfs?: GitLfsCleaner
}

interface IndexEntry {
  path: string
  mode: string
  oid: string
}

interface LfsAvailability {
  checked: boolean
  available: boolean
}

/** Env files shared through E2EE that Git would accidentally publish. */
export class UnignoredEnvironmentFilesError extends Error {
  constructor(readonly paths: string[]) {
    super(`Shared environment files are not ignored by Git: ${paths.join(", ")}`)
    this.name = "UnignoredEnvironmentFilesError"
  }
}

export class UnsupportedGitFilterError extends Error {
  readonly code = "GIT_FILTER_UNSUPPORTED"

  constructor(readonly paths: Array<{ path: string; driver: string }>) {
    const shown = paths.slice(0, 3).map((entry) => `${entry.path} (${entry.driver})`).join(", ")
    const more = paths.length > 3 ? ` and ${paths.length - 3} more` : ""
    super(`AutoGit did not run the custom Git clean filter${paths.length === 1 ? "" : "s"} for ${shown}${more}. ` +
      "Only Git LFS is executed automatically; publish these filtered paths with normal Git or remove the custom filter before retrying.")
    this.name = "UnsupportedGitFilterError"
  }
}

export class GitLfsUnavailableError extends Error {
  readonly code = "GIT_LFS_UNAVAILABLE"

  constructor(readonly filePath: string) {
    super(`Git LFS is required to save ${filePath}, but git-lfs is not available on this Mac. Install or restore Git LFS, then retry the checkpoint.`)
    this.name = "GitLfsUnavailableError"
  }
}

export class GitLfsCleanError extends Error {
  readonly code = "GIT_LFS_FAILED"

  constructor(readonly filePath: string, cause: unknown) {
    super(`Git LFS could not prepare ${filePath} for the checkpoint: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = "GitLfsCleanError"
  }
}

/**
 * Builds one deterministic Git commit from an immutable session barrier. It uses a
 * private temporary index and `commit-tree`: the person's index and working tree are
 * never staged, reset or committed (Section 15.5 - 15.7).
 */
export class CheckpointBuilder {
  private readonly resolveBinary?: CheckpointBuilderOptions["resolveBinary"]
  private readonly lfs: GitLfsCleaner

  constructor(
    private readonly gitService: GitService,
    options: CheckpointBuilderOptions = {},
  ) {
    this.resolveBinary = options.resolveBinary
    this.lfs = options.lfs ?? new GitLfs(gitService.process)
  }

  async buildCheckpointCommit(input: CheckpointCommitInput): Promise<CheckpointCommitResult> {
    const git = this.gitService.process
    const repoPath = path.resolve(input.repoPath)
    const gitDir = (await git.execute(["rev-parse", "--path-format=absolute", "--git-dir"], { cwd: repoPath })).stdout.trim()
    const objectFormat = (await git.execute(["rev-parse", "--show-object-format"], { cwd: repoPath })).stdout.trim() || "sha1"
    const indexPath = path.join(os.tmpdir(), `cozea-autogit-${process.pid}-${randomUUID()}.index`)
    const indexEnv = { GIT_INDEX_FILE: indexPath }
    const authorEnv = await fallbackIdentityEnv(git, repoPath, {
      name: "Cozea AutoGit",
      email: "autogit@cozea.local",
    })
    const env = { ...authorEnv, ...indexEnv }
    const parentTreeOid = input.baseTreeOid ?? (input.parentOid ? await this.treeOf(git, repoPath, input.parentOid) : null)
    const prefix = normalizePrefix(input.pathPrefix)

    try {
      if (parentTreeOid) {
        await git.execute(["read-tree", parentTreeOid], { cwd: repoPath, env: indexEnv })
      } else {
        await git.execute(["read-tree", "--empty"], { cwd: repoPath, env: indexEnv })
      }

      const parentEntries = await this.parentEntries(git, repoPath, indexEnv, prefix)
      const snapshotFiles = new Map<string, BarrierSnapshotFile>()
      for (const file of input.snapshot.files) {
        snapshotFiles.set(joinRepoPath(prefix, file.path), file)
      }
      const explicitDeleted = new Set(input.snapshot.deletedPaths.map((filePath) => joinRepoPath(prefix, filePath)))
      const candidates = [...snapshotFiles.keys()].filter((filePath) => !parentEntries.has(filePath))
      const ignoredNewPaths = await this.checkIgnoredNewPaths(git, repoPath, candidates)
      const sharedEnvironmentPaths = new Set(
        input.snapshot.sharedEnvironmentPaths.map((filePath) => joinRepoPath(prefix, filePath)),
      )
      const leakedEnvironmentPaths = [...sharedEnvironmentPaths].filter(
        (filePath) => snapshotFiles.has(filePath) && !ignoredNewPaths.has(filePath),
      )
      if (leakedEnvironmentPaths.length > 0) {
        throw new UnignoredEnvironmentFilesError(leakedEnvironmentPaths.map((filePath) => stripPrefix(prefix, filePath)))
      }
      // New ignored files are session-only. Existing tracked files remain tracked even
      // if a later .gitignore pattern matches them, just like normal Git.
      const keptOutOfGit = new Set(candidates.filter((filePath) => ignoredNewPaths.has(filePath)))
      const removals = new Set<string>(explicitDeleted)
      for (const removed of await this.parentPathsToRemove(
        git,
        repoPath,
        indexEnv,
        parentEntries,
        snapshotFiles,
        input.maxTextFileBytes,
      )) {
        removals.add(removed)
      }

      // Attribute files from this exact barrier must govern the other files in this
      // exact checkpoint. Apply their additions/removals to the private index first;
      // never consult the live working tree for attributes.
      const attributePaths = [...snapshotFiles.keys()].filter((filePath) => isAttributesPath(filePath) && !keptOutOfGit.has(filePath))
      const removedAttributePaths = [...removals].filter(isAttributesPath)
      const currentAttributeFilters = await this.filterDrivers(git, repoPath, indexEnv, attributePaths)
      const filteredAttributes = [...currentAttributeFilters.entries()]
        .filter(([, driver]) => driver !== null)
        .map(([filePath, driver]) => ({ path: stripPrefix(prefix, filePath), driver: driver! }))
      if (filteredAttributes.length > 0) {
        // If .gitattributes itself is filtered, the index would contain transformed
        // bytes rather than the rules we need to interpret. Fail closed instead.
        throw new UnsupportedGitFilterError(filteredAttributes)
      }
      const attributeUpdates: IndexEntry[] = []
      for (const filePath of attributePaths) {
        const file = snapshotFiles.get(filePath)!
        const mode = file.kind === "symlink" ? "120000" : normalizeMode(file.mode)
        let oid: string
        if (file.kind === "text") {
          oid = await this.textBlob(git, repoPath, filePath, file.text, parentEntries.get(filePath)?.oid ?? null, objectFormat, indexEnv)
        } else if (file.kind === "binary") {
          const bytes = await this.binaryContents(file)
          oid = await this.binaryBlob(git, repoPath, filePath, bytes, parentEntries.get(filePath)?.oid ?? null, indexEnv)
        } else {
          oid = await this.symlinkBlob(git, repoPath, file.symlinkTarget, parentEntries.get(filePath)?.oid ?? null, objectFormat)
        }
        attributeUpdates.push({ path: filePath, mode, oid })
      }
      await this.updateIndex(git, repoPath, indexEnv, attributeUpdates, removedAttributePaths)

      const publishablePaths = [...snapshotFiles.entries()]
        .filter(([filePath, file]) => !isAttributesPath(filePath) && !keptOutOfGit.has(filePath) && file.kind !== "symlink")
        .map(([filePath]) => filePath)
      const filterDrivers = await this.filterDrivers(git, repoPath, indexEnv, publishablePaths)
      const unsupported = [...filterDrivers.entries()]
        .filter(([, driver]) => driver !== null && driver !== "lfs")
        .map(([filePath, driver]) => ({ path: stripPrefix(prefix, filePath), driver: driver! }))
      if (unsupported.length > 0) throw new UnsupportedGitFilterError(unsupported)

      const updates: IndexEntry[] = []
      const lfsAvailability: LfsAvailability = { checked: false, available: false }
      for (const [filePath, file] of snapshotFiles) {
        if (isAttributesPath(filePath) || keptOutOfGit.has(filePath)) continue
        const mode = file.kind === "symlink" ? "120000" : normalizeMode(file.mode)
        const parentOid = parentEntries.get(filePath)?.oid ?? null
        let oid: string
        if (file.kind === "text") {
          const bytes = Buffer.from(file.text, "utf8")
          oid = filterDrivers.get(filePath) === "lfs"
            ? await this.lfsBlob(git, repoPath, filePath, bytes, parentOid, objectFormat, indexEnv, lfsAvailability)
            : await this.textBlob(git, repoPath, filePath, file.text, parentOid, objectFormat, indexEnv)
        } else if (file.kind === "binary") {
          const bytes = await this.binaryContents(file)
          oid = filterDrivers.get(filePath) === "lfs"
            ? await this.lfsBlob(git, repoPath, filePath, bytes, parentOid, objectFormat, indexEnv, lfsAvailability)
            : await this.binaryBlob(git, repoPath, filePath, bytes, parentOid, indexEnv)
        } else {
          oid = await this.symlinkBlob(git, repoPath, file.symlinkTarget, parentOid, objectFormat)
        }
        updates.push({ path: filePath, mode, oid })
      }
      await this.updateIndex(
        git,
        repoPath,
        indexEnv,
        updates,
        [...removals].filter((filePath) => !isAttributesPath(filePath)),
      )

      const treeOid = (await git.execute(["write-tree"], { cwd: repoPath, env: indexEnv })).stdout.trim()
      // AutoGit messages have fixed ASCII trailers so commit metadata is deterministic and
      // human readers can always tell which session barrier a commit came from.
      const message = checkpointMessage(input)
      const authorName = env.GIT_AUTHOR_NAME ?? env.GIT_COMMITTER_NAME ?? "Cozea AutoGit"
      const authorEmail = env.GIT_AUTHOR_EMAIL ?? env.GIT_COMMITTER_EMAIL ?? "autogit@cozea.local"
      let commitOid = input.parentOid ?? ""
      if (treeOid !== parentTreeOid || input.baseTreeOid) {
        const commitArgs = ["commit-tree", treeOid]
        if (input.parentOid) commitArgs.push("-p", input.parentOid)
        commitOid = (
          await git.execute(commitArgs, {
            cwd: repoPath,
            env,
            stdin: message,
          })
        ).stdout.trim()
      }
      return { commitOid, treeOid, parentOid: input.parentOid, parentTreeOid, authorName, authorEmail, env }
    } finally {
      await fs.rm(indexPath, { force: true }).catch(() => undefined)
      // Git can create a lock next to a custom index after a killed process.
      await fs.rm(`${indexPath}.lock`, { force: true }).catch(() => undefined)
      // Keep TS honest that gitDir was resolved; object storage remains Git's responsibility.
      void gitDir
    }
  }

  private async treeOf(git: GitProcessRunner, cwd: string, commitOid: string): Promise<string> {
    return (await git.execute(["rev-parse", `${commitOid}^{tree}`], { cwd })).stdout.trim()
  }

  private async parentEntries(
    git: GitProcessRunner,
    cwd: string,
    indexEnv: Record<string, string>,
    prefix: string,
  ): Promise<Map<string, { mode: string; oid: string }>> {
    const args = ["ls-files", "--stage", "-z"]
    if (prefix) args.push("--", prefix)
    const result = await git.execute(args, { cwd, env: indexEnv })
    const entries = new Map<string, { mode: string; oid: string }>()
    for (const record of result.stdout.split("\0").filter(Boolean)) {
      const match = /^(\d+) ([0-9a-f]+) \d+\t([\s\S]+)$/.exec(record)
      if (match) entries.set(match[3], { mode: match[1], oid: match[2] })
    }
    return entries
  }

  /**
   * A barrier contains the entire live session tree, but some tracked Git files may
   * deliberately not be in it: ignored files, filtered/LFS paths, or files above the
   * session's text-size limit. Those parent entries are preserved rather than inferred
   * as deletes. Explicit CRDT deletes still remove them through `deletedPaths`.
   */
  private async parentPathsToRemove(
    git: GitProcessRunner,
    cwd: string,
    indexEnv: Record<string, string>,
    parentEntries: Map<string, { mode: string; oid: string }>,
    snapshotFiles: Map<string, BarrierSnapshotFile>,
    maxTextFileBytes?: number,
  ): Promise<string[]> {
    const missing = [...parentEntries.keys()].filter((filePath) => !snapshotFiles.has(filePath))
    if (missing.length === 0) return []
    const [ignored, filtered] = await Promise.all([
      this.checkIgnoredTrackedPaths(git, cwd, missing),
      this.pathsWithFilters(git, cwd, indexEnv, missing),
    ])
    const removable: string[] = []
    for (const filePath of missing) {
      if (ignored.has(filePath) || filtered.has(filePath)) continue
      const parent = parentEntries.get(filePath)!
      if (parent.mode === "120000") {
        removable.push(filePath)
        continue
      }
      if (maxTextFileBytes !== undefined) {
        const size = await git.execute(["cat-file", "-s", parent.oid], { cwd })
        if (Number(size.stdout.trim()) > maxTextFileBytes) continue
        const body = (await git.execute(["cat-file", "blob", parent.oid], { cwd })).stdoutBuffer
        if (TextDocRegistry.classifyContent(body) !== "text") continue
      }
      removable.push(filePath)
    }
    return removable
  }

  private async checkIgnoredTrackedPaths(git: GitProcessRunner, cwd: string, paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) return new Set()
    const result = await git.execute(["check-ignore", "--no-index", "-z", "--stdin"], {
      cwd,
      stdin: Buffer.from(`${paths.join("\0")}\0`),
      allowNonZeroExit: true,
    })
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr.trim() || "git check-ignore failed")
    }
    return new Set(result.stdout.split("\0").filter(Boolean))
  }

  private async filterDrivers(
    git: GitProcessRunner,
    cwd: string,
    indexEnv: Record<string, string>,
    paths: string[],
  ): Promise<Map<string, string | null>> {
    const drivers = new Map<string, string | null>()
    if (paths.length === 0) return drivers
    const result = await git.execute(["check-attr", "-z", "--cached", "--stdin", "filter"], {
      cwd,
      env: indexEnv,
      stdin: Buffer.from(`${paths.join("\0")}\0`),
      allowNonZeroExit: true,
    })
    if (!result.success) throw new Error(result.stderr.trim() || "git check-attr failed")
    const fields = result.stdout.split("\0")
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const filePath = fields[index] ?? ""
      const attribute = fields[index + 1] ?? ""
      const value = fields[index + 2] ?? ""
      if (!filePath || attribute !== "filter") continue
      drivers.set(filePath, value === "unspecified" || value === "unset" || !value ? null : value)
    }
    return drivers
  }

  private async pathsWithFilters(
    git: GitProcessRunner,
    cwd: string,
    indexEnv: Record<string, string>,
    paths: string[],
  ): Promise<Set<string>> {
    const drivers = await this.filterDrivers(git, cwd, indexEnv, paths)
    return new Set([...drivers.entries()].filter(([, driver]) => driver !== null).map(([filePath]) => filePath))
  }

  private async checkIgnoredNewPaths(git: GitProcessRunner, cwd: string, paths: string[]): Promise<Set<string>> {
    if (paths.length === 0) return new Set()
    const result = await git.execute(["check-ignore", "-z", "--stdin"], {
      cwd,
      stdin: Buffer.from(`${paths.join("\0")}\0`),
      allowNonZeroExit: true,
    })
    if (result.exitCode !== 0 && result.exitCode !== 1) {
      throw new Error(result.stderr.trim() || "git check-ignore failed")
    }
    return new Set(result.stdout.split("\0").filter(Boolean))
  }

  private async updateIndex(
    git: GitProcessRunner,
    cwd: string,
    indexEnv: Record<string, string>,
    updates: IndexEntry[],
    removals: string[],
  ): Promise<void> {
    const records: string[] = []
    for (const update of updates) {
      records.push(`${update.mode} ${update.oid}\t${update.path}`)
    }
    for (const removed of removals) {
      records.push(`0 ${"0".repeat(40)}\t${removed}`)
    }
    if (records.length === 0) return
    await git.execute(["update-index", "-z", "--index-info"], {
      cwd,
      env: indexEnv,
      stdin: Buffer.from(`${records.join("\0")}\0`),
    })
  }

  private async binaryContents(file: Extract<BarrierSnapshotFile, { kind: "binary" }>): Promise<Buffer> {
    if (!this.resolveBinary) {
      throw new Error(`Cannot checkpoint binary file ${file.path}: binary content resolver is unavailable`)
    }
    const bytes = await this.resolveBinary(file)
    const digest = createHash("sha256").update(bytes).digest("hex")
    if (digest !== file.revision.contentHash || bytes.length !== file.revision.size) {
      throw new Error(`Binary file ${file.path} changed or failed verification before the checkpoint`)
    }
    return bytes
  }

  private async binaryBlob(
    git: GitProcessRunner,
    cwd: string,
    filePath: string,
    bytes: Buffer,
    parentOid: string | null,
    indexEnv: Record<string, string>,
  ): Promise<string> {
    const result = await git.execute(["hash-object", "-w", `--path=${filePath}`, "--stdin"], {
      cwd,
      env: indexEnv,
      stdin: bytes,
    })
    const oid = result.stdout.trim()
    return oid || parentOid || ""
  }

  private async lfsBlob(
    git: GitProcessRunner,
    cwd: string,
    filePath: string,
    bytes: Buffer,
    parentOid: string | null,
    objectFormat: string,
    indexEnv: Record<string, string>,
    availability: LfsAvailability,
  ): Promise<string> {
    // A checkout may intentionally contain the pointer itself (for example when LFS
    // content was not materialized). Preserve that pointer as Git content rather than
    // storing the pointer bytes as a new LFS object.
    const existingPointer = GitLfs.parsePointer(bytes)
    let pointer = bytes
    if (!existingPointer) {
      if (!availability.checked) {
        availability.available = await this.lfs.isAvailable(cwd)
        availability.checked = true
      }
      if (!availability.available) throw new GitLfsUnavailableError(filePath)
      try {
        pointer = await this.lfs.cleanToPointer(cwd, filePath, bytes, indexEnv)
      } catch (error) {
        throw new GitLfsCleanError(filePath, error)
      }
    }
    return this.rawBlob(git, cwd, pointer, parentOid, objectFormat)
  }

  private async symlinkBlob(
    git: GitProcessRunner,
    cwd: string,
    target: string,
    parentOid: string | null,
    objectFormat: string,
  ): Promise<string> {
    return this.rawBlob(git, cwd, Buffer.from(target), parentOid, objectFormat)
  }

  private async rawBlob(
    git: GitProcessRunner,
    cwd: string,
    bytes: Buffer,
    parentOid: string | null,
    objectFormat: string,
  ): Promise<string> {
    const oid = blobOidBytes(bytes, objectFormat)
    if (oid !== parentOid) {
      await git.execute(["hash-object", "-w", "--stdin"], { cwd, stdin: bytes })
    }
    return oid
  }

  private async textBlob(
    git: GitProcessRunner,
    cwd: string,
    filePath: string,
    text: string,
    parentOid: string | null,
    objectFormat: string,
    indexEnv: Record<string, string>,
  ): Promise<string> {
    // Fast path for the common case where attributes do not transform the file.
    // --path below is still the source of truth for CRLF/eol/working-tree-encoding.
    const rawOid = blobOid(text, objectFormat)
    if (rawOid === parentOid) return rawOid
    const result = await git.execute(["hash-object", "-w", `--path=${filePath}`, "--stdin"], {
      cwd,
      env: indexEnv,
      stdin: text,
    })
    return result.stdout.trim()
  }
}

function checkpointMessage(input: CheckpointCommitInput): string {
  return [
    `Cozea session ${input.sessionId} checkpoint`,
    "",
    `Cozea-Session: ${input.sessionId}`,
    `Cozea-Barrier: ${input.snapshot.barrierId}`,
    `Cozea-Seq: ${input.snapshot.sessionSeq}`,
    `Cozea-Generation: ${input.leaseGeneration}`,
    `Cozea-Snapshot: ${input.snapshot.logicalTreeHash}`,
    "",
  ].join("\n")
}

function blobOid(text: string, objectFormat: string): string {
  return blobOidBytes(Buffer.from(text, "utf8"), objectFormat)
}

function blobOidBytes(bytes: Buffer, objectFormat: string): string {
  const header = Buffer.from(`blob ${bytes.length}\0`)
  return createHash(objectFormat).update(header).update(bytes).digest("hex")
}

function normalizeMode(mode: number): string {
  return (mode & 0o111) !== 0 ? "100755" : "100644"
}

function normalizePrefix(prefix: string | undefined): string {
  if (!prefix || prefix === ".") return ""
  return prefix.replace(/^\/+/, "").replace(/\/+$/, "") + "/"
}

function joinRepoPath(prefix: string, filePath: string): string {
  return `${prefix}${filePath.replace(/^\/+/, "")}`
}

function stripPrefix(prefix: string, filePath: string): string {
  return prefix && filePath.startsWith(prefix) ? filePath.slice(prefix.length) : filePath
}

function isAttributesPath(filePath: string): boolean {
  return filePath === ".gitattributes" || filePath.endsWith("/.gitattributes")
}

/** Test helper: writes a ref only after the commit has been independently built. */
export async function updateLocalRef(
  git: GitProcessRunner,
  cwd: string,
  ref: string,
  commitOid: string,
  oldOid?: string,
): Promise<GitExecutionResult> {
  const args = ["update-ref", ref, commitOid]
  if (oldOid !== undefined) args.push(oldOid)
  return git.execute(args, { cwd, allowNonZeroExit: true })
}
