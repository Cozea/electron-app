import { createHash } from "node:crypto"
import fs from "node:fs/promises"

import { GitLfs, MAX_LFS_POINTER_BYTES, type GitLfsCleaner } from "../git/GitLfs"
import type { GitProcessResult } from "../git/GitProcess"

export interface CheckpointGitOptions {
  env?: Record<string, string>
  stdin?: string | Buffer
  allowNonZeroExit?: boolean
  maxBuffer?: number
}

export type CheckpointGitRunner = (args: string[], options?: CheckpointGitOptions) => Promise<GitProcessResult>

export class UnsupportedGitFilterError extends Error {
  readonly code = "GIT_FILTER_UNSUPPORTED"
  readonly paths: ReadonlyArray<{ path: string; driver: string }>

  constructor(paths: ReadonlyArray<{ path: string; driver: string }>) {
    const shown = paths.slice(0, 3).map(({ path, driver }) => `${path} (${driver})`).join(", ")
    const remainder = paths.length > 3 ? ` and ${paths.length - 3} more` : ""
    super(
      `AutoGit will not run custom Git clean filters for ${shown}${remainder}. ` +
        "Only Git LFS is executed automatically; publish these paths with normal Git or remove the custom filter before retrying.",
    )
    this.name = "UnsupportedGitFilterError"
    this.paths = paths
  }
}

export class GitLfsUnavailableError extends Error {
  readonly code = "GIT_LFS_UNAVAILABLE"
  readonly filePath: string

  constructor(filePath: string) {
    super(
      `Git LFS is required to save ${filePath}, but git-lfs is not available on this Mac. ` +
        "Install or restore Git LFS, then retry the checkpoint.",
    )
    this.name = "GitLfsUnavailableError"
    this.filePath = filePath
  }
}

export class GitLfsCleanError extends Error {
  readonly code = "GIT_LFS_FAILED"
  readonly filePath: string

  constructor(filePath: string, cause: unknown) {
    super(`Git LFS could not prepare ${filePath} for the checkpoint: ${cause instanceof Error ? cause.message : String(cause)}`)
    this.name = "GitLfsCleanError"
    this.filePath = filePath
  }
}

export interface LfsAvailabilityState {
  checked: boolean
  available: boolean
}

/**
 * Publication policy for Git clean filters used by AutoGit checkpoints.
 *
 * Attribute discovery is always against the private checkpoint index (`--cached`).
 * Arbitrary filter drivers are metadata only: this policy never executes them.
 * Git LFS is the only supported clean transform and is invoked directly as
 * `git lfs clean`, which stores an object locally and emits a pointer without
 * contacting the LFS server.
 */
export class CheckpointFilterPolicy {
  private readonly lfs: GitLfsCleaner

  constructor(lfs: GitLfsCleaner) {
    this.lfs = lfs
  }

  async drivers(
    git: CheckpointGitRunner,
    paths: readonly string[],
    indexEnv: Record<string, string>,
  ): Promise<Map<string, string | null>> {
    const drivers = new Map<string, string | null>()
    if (paths.length === 0) return drivers
    const result = await git(["check-attr", "-z", "--cached", "--stdin", "filter"], {
      env: indexEnv,
      stdin: `${paths.join("\0")}\0`,
      allowNonZeroExit: true,
    })
    if (!result.success) {
      throw new Error(`Git could not read filter attributes: ${result.stderr.trim() || `exit ${result.exitCode}`}`)
    }
    const fields = result.stdout.split("\0")
    for (let index = 0; index + 2 < fields.length; index += 3) {
      const filePath = fields[index]
      const attribute = fields[index + 1]
      const value = fields[index + 2]
      if (!filePath || attribute !== "filter") continue
      drivers.set(filePath, !value || value === "unspecified" || value === "unset" ? null : value)
    }
    return drivers
  }

  assertNoFilters(drivers: ReadonlyMap<string, string | null>, displayPath: (path: string) => string): void {
    const filtered = [...drivers.entries()]
      .filter((entry): entry is [string, string] => entry[1] !== null)
      .map(([filePath, driver]) => ({ path: displayPath(filePath), driver }))
    if (filtered.length > 0) throw new UnsupportedGitFilterError(filtered)
  }

  assertSupportedFilters(drivers: ReadonlyMap<string, string | null>, displayPath: (path: string) => string): void {
    const unsupported = [...drivers.entries()]
      .filter((entry): entry is [string, string] => entry[1] !== null && entry[1] !== "lfs")
      .map(([filePath, driver]) => ({ path: displayPath(filePath), driver }))
    if (unsupported.length > 0) throw new UnsupportedGitFilterError(unsupported)
  }

  async lfsBlob(input: {
    git: CheckpointGitRunner
    root: string
    objectFormat: string
    repoFilePath: string
    /** Small buffered payload (text path). Mutually exclusive with staged. */
    bytes?: Buffer
    /** Verified staging file for payloads that must never be buffered. */
    staged?: { path: string; size: number; contentHash: string }
    parentOid?: string
    indexEnv: Record<string, string>
    availability: LfsAvailabilityState
  }): Promise<string> {
    if ((input.bytes && input.staged) || (!input.bytes && !input.staged)) {
      throw new Error(`LFS checkpoint for ${input.repoFilePath} needs bytes or a staged file, not both`)
    }
    // A non-materialized checkout may expose the pointer itself. Preserve it as
    // Git content; do not create an LFS object whose payload is another pointer.
    // Staged payloads reach the pointer check only when small enough to read
    // whole within the pointer format bound; anything larger cannot be one.
    let pointer: Buffer | null = null
    if (input.bytes) {
      if (GitLfs.parsePointer(input.bytes)) pointer = input.bytes
    } else if (input.staged && input.staged.size <= MAX_LFS_POINTER_BYTES) {
      const candidate = await fs.readFile(input.staged.path)
      if (GitLfs.parsePointer(candidate)) pointer = candidate
    }
    if (!pointer) {
      if (input.staged && !this.lfs.cleanFileToPointer) {
        throw new Error(`LFS cleaner for ${input.repoFilePath} does not support staged payloads`)
      }
      if (!input.availability.checked) {
        input.availability.available = await this.lfs.isAvailable(input.root)
        input.availability.checked = true
      }
      if (!input.availability.available) throw new GitLfsUnavailableError(input.repoFilePath)
      try {
        pointer = input.staged
          ? await this.lfs.cleanFileToPointer!(
              input.root, input.repoFilePath, input.staged.path,
              { size: input.staged.size, contentHash: input.staged.contentHash }, input.indexEnv,
            )
          : await this.lfs.cleanToPointer(input.root, input.repoFilePath, input.bytes!, input.indexEnv)
      } catch (error) {
        if (error instanceof GitLfsCleanError || error instanceof GitLfsUnavailableError) throw error
        throw new GitLfsCleanError(input.repoFilePath, error)
      }
    }
    return this.storePointer(input, pointer)
  }

  private async storePointer(
    input: { git: CheckpointGitRunner; objectFormat: string; repoFilePath: string; parentOid?: string },
    pointer: Buffer,
  ): Promise<string> {
    const oid = blobOidBytes(pointer, input.objectFormat)
    if (oid !== input.parentOid) {
      const written = await input.git(['hash-object', '-w', '--stdin'], { stdin: pointer })
      if (written.stdout.trim() !== oid) throw new Error(`Git wrote an unexpected LFS pointer object for ${input.repoFilePath}`)
    }
    return oid
  }
}

export function defaultCheckpointFilterPolicy(git: import("../git/GitService").GitService): CheckpointFilterPolicy {
  return new CheckpointFilterPolicy(new GitLfs(git.process))
}

function blobOidBytes(bytes: Buffer, objectFormat: string): string {
  const algorithm = objectFormat === "sha256" ? "sha256" : "sha1"
  return createHash(algorithm)
    .update(`blob ${bytes.length}\0`)
    .update(bytes)
    .digest("hex")
}
