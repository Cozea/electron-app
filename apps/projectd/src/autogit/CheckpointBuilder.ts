/**
 * AutoGit deterministic checkpoint commit builder.
 *
 * Master Specification: Section 15.6 - 15.10
 * Invariants:
 * - C20: Fenced leader generation.
 * - C21: Commits from immutable barrier snapshot in isolated git staging, never live disk.
 * - C22: Deterministic commit construction for failover reproducibility.
 */

import path from "node:path"
import os from "node:os"

import { normalizeProjectPath } from "../collaboration/projectPath"
import type { GitService } from "../git/GitService"
import type { BarrierSnapshot } from "./BarrierCapture"

export interface CheckpointCommitResult {
  readonly commitOid: string
  readonly treeOid: string
  readonly parentOid: string | null
  readonly logicalTreeHash: string
  readonly sessionSeq: number
  readonly barrierId: string
  readonly leaseGeneration: number
  readonly commitMessage: string
}

export class CheckpointBuilder {
  readonly gitService: GitService

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
  async buildCheckpointCommit(params: {
    repoPath: string
    sessionId: string
    parentOid: string | null
    leaseGeneration: number
    snapshot: BarrierSnapshot
  }): Promise<CheckpointCommitResult> {
    const { repoPath, sessionId, parentOid, leaseGeneration, snapshot } = params

    // Temporary index file for isolated staging
    const tempIndex = path.join(
      os.tmpdir(),
      `git_idx_${snapshot.barrierId}_${Date.now()}.idx`,
    )

    const gitEnv: Record<string, string> = {
      GIT_INDEX_FILE: tempIndex,
    }

    try {
      // Start from the parent tree so content the snapshot does not carry as bytes
      // (binary blobs) keeps its Git object. A parent that cannot be read fails the
      // checkpoint rather than producing a commit that drops the whole tree.
      let indexedPaths = new Set<string>()
      if (parentOid) {
        await this.gitService.process.execute(["read-tree", parentOid], {
          cwd: repoPath,
          env: gitEnv,
        })
        const listed = await this.gitService.process.execute(["ls-files", "-z"], {
          cwd: repoPath,
          env: gitEnv,
        })
        indexedPaths = new Set(listed.stdout.split("\0").filter(Boolean))
      }

      // The commit is the barrier snapshot (C21): paths deleted or renamed away in
      // the CRDT leave the tree instead of lingering from the parent.
      const snapshotPaths = new Set(snapshot.files.map((file) => normalizeProjectPath(file.path)))
      const stalePaths = [...indexedPaths].filter((indexedPath) => !snapshotPaths.has(indexedPath))
      if (stalePaths.length > 0) {
        await this.gitService.process.execute(["update-index", "--force-remove", "-z", "--stdin"], {
          cwd: repoPath,
          env: gitEnv,
          stdin: `${stalePaths.join("\0")}\0`,
        })
      }

      const unresolvedBinaries = snapshot.files.filter(
        (file) => file.kind === "binary" && !indexedPaths.has(normalizeProjectPath(file.path)),
      )
      if (unresolvedBinaries.length > 0) {
        throw new Error(
          `Checkpoint has no Git blob for binary ${unresolvedBinaries.map((file) => file.path).join(", ")}: ` +
            "binary bytes are not part of the barrier snapshot and the parent commit has nothing at that path",
        )
      }

      // Write each file in the barrier snapshot into Git object database
      for (const snapshotFile of snapshot.files) {
        const file = { ...snapshotFile, path: normalizeProjectPath(snapshotFile.path) }
        if (file.kind === "text" && file.textContent !== undefined) {
          // Write blob via hash-object
          const blobRes = await this.gitService.process.execute(
            ["hash-object", "-w", "--stdin"],
            {
              cwd: repoPath,
              stdin: file.textContent,
            },
          )
          const blobOid = blobRes.stdout.trim()

          // Add to temporary index via update-index
          const modeStr = file.mode === 0o100755 ? "100755" : "100644"
          await this.gitService.process.execute(
            ["update-index", "--add", "--cacheinfo", modeStr, blobOid, file.path],
            {
              cwd: repoPath,
              env: gitEnv,
            },
          )
        } else if (file.kind === "symlink" && file.symlinkTarget !== undefined) {
          const blobRes = await this.gitService.process.execute(
            ["hash-object", "-w", "--stdin"],
            {
              cwd: repoPath,
              stdin: file.symlinkTarget,
            },
          )
          const blobOid = blobRes.stdout.trim()
          await this.gitService.process.execute(
            ["update-index", "--add", "--cacheinfo", "120000", blobOid, file.path],
            {
              cwd: repoPath,
              env: gitEnv,
            },
          )
        }
      }

      // Write Git tree from temporary index
      const treeRes = await this.gitService.process.execute(["write-tree"], {
        cwd: repoPath,
        env: gitEnv,
      })
      const treeOid = treeRes.stdout.trim()

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
        ...gitEnv,
        GIT_AUTHOR_NAME: "Cozea AutoGit",
        GIT_AUTHOR_EMAIL: "autogit@cozea.local",
        GIT_COMMITTER_NAME: "Cozea AutoGit",
        GIT_COMMITTER_EMAIL: "autogit@cozea.local",
        GIT_AUTHOR_DATE: `${tsSeconds} +0000`,
        GIT_COMMITTER_DATE: `${tsSeconds} +0000`,
      }

      const commitArgs = ["commit-tree", treeOid, "-m", message]
      if (parentOid) {
        commitArgs.push("-p", parentOid)
      }

      const commitRes = await this.gitService.process.execute(commitArgs, {
        cwd: repoPath,
        env: commitEnv,
      })
      const commitOid = commitRes.stdout.trim()

      return {
        commitOid,
        treeOid,
        parentOid,
        logicalTreeHash: snapshot.logicalTreeHash,
        sessionSeq: snapshot.sessionSeq,
        barrierId: snapshot.barrierId,
        leaseGeneration,
        commitMessage: message,
      }
    } finally {
      // Clean up temporary index file
      try {
        const fsSync = await import("node:fs")
        if (fsSync.existsSync(tempIndex)) {
          fsSync.unlinkSync(tempIndex)
        }
      } catch {
        // Ignore
      }
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
}
