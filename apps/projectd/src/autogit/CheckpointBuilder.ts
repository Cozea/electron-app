/**
 * AutoGit deterministic checkpoint commit builder.
 *
 * Master Specification: Section 15.6 - 15.10
 * Invariants:
 * - C20: Fenced leader generation.
 * - C21: Commits from immutable barrier snapshot in isolated git staging, never live disk.
 * - C22: Deterministic commit construction for failover reproducibility.
 *
 * A checkpoint is the parent tree with the session's changes applied: text files and
 * symlinks from the barrier snapshot, and removals for what the session deleted or
 * renamed away. Files the session never carries keep their parent blobs: binaries,
 * text over the sync limit, submodules, files under a Git filter such as LFS, and
 * editor files kept on each machine. Staging uses a temporary index, so the
 * repository's own index, HEAD and working tree are untouched.
 */

import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"

import { normalizeProjectPath } from "../collaboration/projectPath"
import { TextDocRegistry } from "../collaboration/TextDocRegistry"
import { ScopePolicy } from "../filesystem/ScopePolicy"
import { isSharedEnvironmentFile } from "../filesystem/environmentFiles"
import type { GitService } from "../git/GitService"
import type { BarrierSnapshot } from "./BarrierCapture"

const DEFAULT_MAX_TEXT_FILE_BYTES = 512 * 1024
const REGULAR_FILE_MODES = new Set(["100644", "100755"])
// Bounds how much blob content one `git cat-file --batch` returns.
const BLOB_READ_CHUNK_BYTES = 16 * 1024 * 1024

export interface CheckpointCommitResult {
  readonly commitOid: string
  readonly treeOid: string
  readonly parentOid: string | null
  /** The parent commit's tree; equal to treeOid when the snapshot changes nothing. */
  readonly parentTreeOid: string | null
  readonly logicalTreeHash: string
  readonly sessionSeq: number
  readonly barrierId: string
  readonly leaseGeneration: number
  readonly commitMessage: string
}

export interface CheckpointBuildParams {
  /** Any directory inside the repository. */
  repoPath: string
  sessionId: string
  parentOid: string | null
  leaseGeneration: number
  snapshot: BarrierSnapshot
  /** Where the session's folder sits in the repository, as `git rev-parse --show-prefix` prints it. */
  pathPrefix?: string
  /** The largest text file the session syncs. */
  maxTextFileBytes?: number
}

interface IndexEntry {
  mode: string
  oid: string
}

type GitRunner = (
  args: string[],
  options?: { env?: Record<string, string>; stdin?: string; allowNonZeroExit?: boolean; maxBuffer?: number },
) => ReturnType<GitService["process"]["execute"]>

/** The id Git gives a blob with these bytes, computed here instead of by a git process. */
function blobOid(content: string, objectFormat: string): string {
  const bytes = Buffer.from(content, "utf8")
  return createHash(objectFormat === "sha256" ? "sha256" : "sha1")
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex")
}

function normalizePrefix(prefix: string): string {
  const trimmed = prefix.replace(/\\/g, "/").replace(/^\/+/, "").replace(/\/+$/, "")
  return trimmed ? `${trimmed}/` : ""
}

export class CheckpointBuilder {
  readonly gitService: GitService
  // Blob id → whether the session would carry that content as text. Blobs never change.
  private readonly syncableBlobs = new Map<string, boolean>()

  constructor(gitService: GitService) {
    this.gitService = gitService
  }

  /**
   * Section 15.7: Generates canonical commit message with deterministic trailers.
   */
  static buildCommitMessage(params: {
    sessionId: string
    sessionSeq: number
    barrierId: string
    logicalTreeHash: string
    leaseGeneration: number
  }): string {
    return `cozea: session checkpoint

Cozea-Session: ${params.sessionId}
Cozea-Seq: ${params.sessionSeq}
Cozea-Barrier: ${params.barrierId}
Cozea-Snapshot: ${params.logicalTreeHash}
Cozea-Lease-Generation: ${params.leaseGeneration}
`
  }

  /**
   * Section 15.6 - 15.7: Builds Git tree and deterministic commit in isolated index.
   */
  async buildCheckpointCommit(params: CheckpointBuildParams): Promise<CheckpointCommitResult> {
    const { sessionId, parentOid, leaseGeneration, snapshot } = params
    const prefix = normalizePrefix(params.pathPrefix ?? "")
    const maxTextFileBytes = params.maxTextFileBytes ?? DEFAULT_MAX_TEXT_FILE_BYTES

    const topLevel = await this.gitService.process.execute(["rev-parse", "--show-toplevel"], { cwd: params.repoPath })
    const root = topLevel.stdout.trim()
    const git: GitRunner = (args, options = {}) => this.gitService.process.execute(args, { cwd: root, ...options })

    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-checkpoint-"))
    const indexEnv = { GIT_INDEX_FILE: path.join(tempDir, "index") }

    try {
      const format = await git(["rev-parse", "--show-object-format"], { allowNonZeroExit: true })
      const objectFormat = format.success ? format.stdout.trim() : "sha1"

      // The parent tree, staged in the temporary index.
      const parentEntries = new Map<string, IndexEntry>()
      let parentTreeOid: string | null = null
      if (parentOid) {
        parentTreeOid = (await git(["rev-parse", "--verify", `${parentOid}^{tree}`])).stdout.trim()
        await git(["read-tree", parentOid], { env: indexEnv })
        const listed = await git(["ls-files", "--stage", "-z"], { env: indexEnv })
        for (const record of listed.stdout.split("\0")) {
          const tab = record.indexOf("\t")
          if (tab < 0) continue
          const [mode, oid] = record.slice(0, tab).split(" ")
          if (mode && oid) parentEntries.set(record.slice(tab + 1), { mode, oid })
        }
      }

      const snapshotFiles = new Map(snapshot.files.map((file) => [prefix + normalizeProjectPath(file.path), file]))
      const deletedPaths = new Set((snapshot.deletedPaths ?? []).map((deleted) => prefix + normalizeProjectPath(deleted)))
      const removals = await this.parentPathsToRemove({
        git,
        root,
        prefix,
        parentEntries,
        snapshotPaths: new Set(snapshotFiles.keys()),
        deletedPaths,
        maxTextFileBytes,
        indexEnv,
      })

      // Env files a session shares, and anything else Git ignores, never enter a checkpoint.
      const keptOutOfGit = await this.pathsKeptOutOfGit(
        git,
        [...snapshotFiles.keys()].filter((repoFilePath) => !parentEntries.has(repoFilePath)),
        indexEnv,
      )
      const updates: string[] = []
      for (const [repoFilePath, file] of snapshotFiles) {
        if (keptOutOfGit.has(repoFilePath)) continue
        const parent = parentEntries.get(repoFilePath)
        if (file.kind === "text" && file.textContent !== undefined) {
          const mode = file.mode === 0o100755 ? "100755" : "100644"
          const oid = await this.textBlob(git, objectFormat, repoFilePath, file.textContent, parent)
          if (parent?.oid !== oid || parent.mode !== mode) updates.push(`${mode} ${oid}\t${repoFilePath}`)
        } else if (file.kind === "symlink" && file.symlinkTarget !== undefined) {
          let oid = blobOid(file.symlinkTarget, objectFormat)
          if (parent?.oid !== oid) {
            oid = (await git(["hash-object", "-w", "--stdin"], { stdin: file.symlinkTarget })).stdout.trim()
          }
          if (parent?.oid !== oid || parent.mode !== "120000") updates.push(`120000 ${oid}\t${repoFilePath}`)
        } else if (file.kind === "binary" && !parent) {
          throw new Error(
            `Checkpoint has no Git blob for binary ${file.path}: ` +
              "binary bytes are not part of the barrier snapshot and the parent commit has nothing at that path",
          )
        }
      }

      if (removals.length > 0) {
        await git(["update-index", "--force-remove", "-z", "--stdin"], {
          env: indexEnv,
          stdin: `${removals.join("\0")}\0`,
        })
      }
      if (updates.length > 0) {
        await git(["update-index", "-z", "--index-info"], { env: indexEnv, stdin: `${updates.join("\0")}\0` })
      }
      const treeOid = (await git(["write-tree"], { env: indexEnv })).stdout.trim()

      const message = CheckpointBuilder.buildCommitMessage({
        sessionId,
        sessionSeq: snapshot.sessionSeq,
        barrierId: snapshot.barrierId,
        logicalTreeHash: snapshot.logicalTreeHash,
        leaseGeneration,
      })

      // Deterministic timestamps derived from barrier serverTime (Section 15.7)
      const tsSeconds = String(Math.floor(snapshot.serverTime / 1000))
      const commitEnv: Record<string, string> = {
        GIT_AUTHOR_NAME: "Cozea AutoGit",
        GIT_AUTHOR_EMAIL: "autogit@cozea.local",
        GIT_COMMITTER_NAME: "Cozea AutoGit",
        GIT_COMMITTER_EMAIL: "autogit@cozea.local",
        GIT_AUTHOR_DATE: `${tsSeconds} +0000`,
        GIT_COMMITTER_DATE: `${tsSeconds} +0000`,
      }

      // A signature would differ between leaders and needs a key agent a daemon may not reach.
      const commitArgs = ["commit-tree", "--no-gpg-sign", treeOid, "-m", message]
      if (parentOid) {
        commitArgs.push("-p", parentOid)
      }
      const commitOid = (await git(commitArgs, { env: commitEnv })).stdout.trim()

      return {
        commitOid,
        treeOid,
        parentOid,
        parentTreeOid,
        logicalTreeHash: snapshot.logicalTreeHash,
        sessionSeq: snapshot.sessionSeq,
        barrierId: snapshot.barrierId,
        leaseGeneration,
        commitMessage: message,
      }
    } finally {
      await fs.rm(tempDir, { recursive: true, force: true }).catch(() => undefined)
    }
  }

  /**
   * Section 15.9: Remote verification when push response is lost or timed out.
   */
  async verifyRemoteBranchOid(
    repoPath: string,
    branchName: string,
    expectedOid: string,
  ): Promise<boolean> {
    const res = await this.gitService.process.execute(["rev-parse", "--verify", `origin/${branchName}`], {
      cwd: repoPath,
      allowNonZeroExit: true,
    })
    return res.success && res.stdout.trim() === expectedOid
  }

  /** The blob for text at a path, written to the object store unless the parent already holds it. */
  private async textBlob(
    git: GitRunner,
    objectFormat: string,
    repoFilePath: string,
    text: string,
    parent: IndexEntry | undefined,
  ): Promise<string> {
    // Most files match the parent; hashing here spares a git process for each.
    if (parent && parent.oid === blobOid(text, objectFormat)) return parent.oid
    // Clean filters and line-ending rules decide the stored bytes, as `git add` would.
    return (await git(["hash-object", "-w", "--stdin", `--path=${repoFilePath}`], { stdin: text })).stdout.trim()
  }

  /**
   * Parent paths the snapshot lacks because the session deleted or renamed them.
   * Anything the session could never have carried stays as the parent has it.
   */
  private async parentPathsToRemove(input: {
    git: GitRunner
    root: string
    prefix: string
    parentEntries: Map<string, IndexEntry>
    snapshotPaths: Set<string>
    deletedPaths: Set<string>
    maxTextFileBytes: number
    indexEnv: Record<string, string>
  }): Promise<string[]> {
    const { git, prefix, parentEntries, snapshotPaths, deletedPaths } = input
    const scope = new ScopePolicy(input.root)
    const removals: string[] = []
    const candidates: Array<{ path: string; oid: string }> = []
    for (const [repoFilePath, entry] of parentEntries) {
      if (!repoFilePath.startsWith(prefix) || snapshotPaths.has(repoFilePath)) continue
      if (deletedPaths.has(repoFilePath)) {
        removals.push(repoFilePath)
        continue
      }
      // Symlinks and submodules do not sync, and neither do editor files each machine keeps.
      if (!REGULAR_FILE_MODES.has(entry.mode)) continue
      if (scope.isAlwaysIgnored(repoFilePath.slice(prefix.length))) continue
      candidates.push({ path: repoFilePath, oid: entry.oid })
    }
    if (candidates.length === 0) return removals

    const filtered = await this.pathsWithFilters(
      git,
      candidates.map((candidate) => candidate.path),
      input.indexEnv,
    )
    const unfiltered = candidates.filter((candidate) => !filtered.has(candidate.path))
    const syncable = await this.syncableTextBlobs(
      git,
      unfiltered.map((candidate) => candidate.oid),
      input.maxTextFileBytes,
    )
    for (const candidate of unfiltered) {
      if (syncable.has(candidate.oid)) removals.push(candidate.path)
    }
    return removals
  }

  /**
   * New paths a checkpoint must never add: env files, even where the repository forgot
   * to ignore them, and anything Git ignores. A path the parent commit already tracks
   * stays tracked. When Git cannot read its ignore rules the checkpoint fails, rather
   * than risk committing a secret.
   */
  private async pathsKeptOutOfGit(
    git: GitRunner,
    paths: string[],
    indexEnv: Record<string, string>,
  ): Promise<Set<string>> {
    const kept = new Set(paths.filter((repoFilePath) => isSharedEnvironmentFile(repoFilePath)))
    const candidates = paths.filter((repoFilePath) => !kept.has(repoFilePath))
    if (candidates.length === 0) return kept
    const result = await git(["check-ignore", "-z", "--stdin"], {
      env: indexEnv,
      stdin: `${candidates.join("\0")}\0`,
      allowNonZeroExit: true,
    })
    // Exit 1 means none of the paths is ignored.
    if (!result.success && result.exitCode !== 1) {
      throw new Error(`Git could not read its ignore rules: ${result.stderr.trim() || `exit ${result.exitCode}`}`)
    }
    for (const ignored of result.stdout.split("\0")) {
      if (ignored) kept.add(ignored)
    }
    return kept
  }

  /** Paths under a Git filter such as LFS: their stored bytes are not what the folder holds. */
  private async pathsWithFilters(git: GitRunner, paths: string[], indexEnv: Record<string, string>): Promise<Set<string>> {
    const result = await git(["check-attr", "-z", "--cached", "--stdin", "filter"], {
      env: indexEnv,
      stdin: `${paths.join("\0")}\0`,
      allowNonZeroExit: true,
    })
    const filtered = new Set<string>()
    if (!result.success) return filtered
    const fields = result.stdout.split("\0")
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const value = fields[index + 2]
      if (value && value !== "unspecified" && value !== "unset") filtered.add(fields[index])
    }
    return filtered
  }

  /** Blob ids whose content the session would carry: text no larger than the sync limit. */
  private async syncableTextBlobs(git: GitRunner, oids: string[], maxTextFileBytes: number): Promise<Set<string>> {
    const unknown = [...new Set(oids)].filter((oid) => !this.syncableBlobs.has(oid))
    if (unknown.length > 0) {
      const sizes = await git(["cat-file", "--batch-check=%(objectname) %(objectsize)"], {
        stdin: `${unknown.join("\n")}\n`,
      })
      const small: Array<{ oid: string; size: number }> = []
      for (const line of sizes.stdout.split("\n")) {
        const [oid, sizeText] = line.split(" ")
        const size = Number(sizeText)
        if (!oid || !Number.isFinite(size)) continue
        if (size > maxTextFileBytes) this.syncableBlobs.set(oid, false)
        else small.push({ oid, size })
      }

      let chunk: string[] = []
      let chunkBytes = 0
      const readChunk = async () => {
        if (chunk.length === 0) return
        const contents = await git(["cat-file", "--batch"], { stdin: `${chunk.join("\n")}\n`, maxBuffer: 2 * BLOB_READ_CHUNK_BYTES })
        this.classifyBatchOutput(contents.stdoutBuffer)
        chunk = []
        chunkBytes = 0
      }
      for (const blob of small) {
        if (chunkBytes + blob.size > BLOB_READ_CHUNK_BYTES) await readChunk()
        chunk.push(blob.oid)
        chunkBytes += blob.size
      }
      await readChunk()
    }
    return new Set(oids.filter((oid) => this.syncableBlobs.get(oid) === true))
  }

  /** Reads `git cat-file --batch` output: a header line, the content, then a newline, per object. */
  private classifyBatchOutput(output: Buffer): void {
    let offset = 0
    while (offset < output.length) {
      const headerEnd = output.indexOf(0x0a, offset)
      if (headerEnd < 0) return
      const [oid, , sizeText] = output.subarray(offset, headerEnd).toString("utf8").split(" ")
      const size = Number(sizeText)
      if (!oid || !Number.isFinite(size)) return
      const content = output.subarray(headerEnd + 1, headerEnd + 1 + size)
      this.syncableBlobs.set(oid, TextDocRegistry.classifyContent(content) === "text")
      offset = headerEnd + 1 + size + 1
    }
  }
}
