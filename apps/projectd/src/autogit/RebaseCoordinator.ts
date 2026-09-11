/**
 * Explicit isolated rebase coordinator with B/R/L three-way integration.
 *
 * Master Specification: Section 21.1 - 21.10
 * Invariants:
 * - C25: Rebase is explicit.
 * - C26: Rebase is isolated from live session workspace.
 * - C27: Rebase preserves concurrent live work (N+1, N+2...).
 * - C28: Merge snapshots are immutable.
 */

import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"

import type { BranchName, SessionId } from "@shared/collaboration"
import { assertValidRebaseTransition } from "@shared/collaboration"

import type { GitService } from "../git/GitService"
import type { SessionReplica } from "../collaboration/SessionReplica"
import { BarrierCapture, type BarrierDescriptor } from "./BarrierCapture"
import { CheckpointBuilder } from "./CheckpointBuilder"
import { BoundedDiff } from "../collaboration/BoundedDiff"

export interface RebaseConflictFile {
  path: string
  baseContent: string
  ourContent: string
  theirContent: string
}

export interface RebaseExecutionResult {
  success: boolean
  status: "complete" | "conflicted" | "aborted" | "failed"
  oldBranchOid: string
  newBranchOid?: string
  conflicts?: RebaseConflictFile[]
  mergedFilesCount: number
  error?: string
}

export class RebaseCoordinator {
  readonly gitService: GitService
  readonly checkpointBuilder: CheckpointBuilder
  readonly diffEngine = new BoundedDiff()

  constructor(gitService: GitService) {
    this.gitService = gitService
    this.checkpointBuilder = new CheckpointBuilder(gitService)
  }

  /**
   * Section 21.1 - 21.9: Executes user-approved rebase with three-way B/R/L integration.
   */
  async executeRebase(params: {
    sessionId: SessionId
    repoPath: string
    sessionBranch: BranchName
    targetBranch: BranchName
    replica: SessionReplica
    isUserAction: boolean
    /** The room barrier at sequence N; without one the basis is local and unsequenced (sessionSeq 0). */
    barrier?: BarrierDescriptor
    onBeforeCompute?: () => Promise<void>
  }): Promise<RebaseExecutionResult> {
    const {
      sessionId,
      repoPath,
      sessionBranch,
      targetBranch,
      replica,
      isUserAction,
    } = params

    // Enforce Invariant C25: Rebase requires explicit user action
    assertValidRebaseTransition("SUGGESTED", "REQUESTED", { isUserAction })

    // Step 2: Capture rebase basis B at barrier sequence N (Section 21.3)
    const barrier: BarrierDescriptor = params.barrier ?? {
      barrierId: `rebase_bar_${Date.now()}`,
      sessionSeq: 0,
      serverTime: Date.now(),
    }
    const snapshotB = BarrierCapture.captureSnapshot(barrier, replica)

    if (params.onBeforeCompute) {
      await params.onBeforeCompute()
    }

    const sessionOid = await this.gitService.getCommitOid(repoPath, String(sessionBranch))
    const targetOid = await this.gitService.getCommitOid(repoPath, String(targetBranch))

    if (!sessionOid || !targetOid) {
      throw new Error("Could not resolve session or target commit OID")
    }

    if (sessionOid === targetOid) {
      return {
        success: true,
        status: "complete",
        oldBranchOid: sessionOid,
        newBranchOid: sessionOid,
        mergedFilesCount: 0,
      }
    }

    // Step 3 & 4: Compute rebase in isolated temporary worktree (Section 21.4)
    const isolatedWorktreeDir = path.join(
      os.tmpdir(),
      `rebase_wt_${sessionId}_${Date.now()}`,
    )

    try {
      // Add isolated worktree on detached session branch
      await this.gitService.process.execute(
        ["worktree", "add", "--detach", isolatedWorktreeDir, sessionOid],
        { cwd: repoPath },
      )

      // Run real git rebase onto target in the isolated worktree
      const rebaseRes = await this.gitService.process.execute(
        ["rebase", targetOid],
        { cwd: isolatedWorktreeDir, allowNonZeroExit: true },
      )

      if (!rebaseRes.success) {
        // Section 21.5: Rebase conflict! Build conflict bundle without mutating live CRDT
        const conflicts: RebaseConflictFile[] = []
        const status = await this.gitService.getStatus(isolatedWorktreeDir)

        for (const file of status.files.filter((f) => f.isConflicted)) {
          conflicts.push({
            path: file.path,
            baseContent: "",
            ourContent: "",
            theirContent: "",
          })
        }

        // Abort isolated rebase
        await this.gitService.process.execute(["rebase", "--abort"], {
          cwd: isolatedWorktreeDir,
          allowNonZeroExit: true,
        })

        return {
          success: false,
          status: "conflicted",
          oldBranchOid: sessionOid,
          conflicts,
          mergedFilesCount: 0,
          error: "Conflicts encountered during isolated rebase",
        }
      }

      // Rebase succeeded in isolated worktree! Rebased result R is HEAD of isolated worktree
      const rebasedCommitOid = (
        await this.gitService.process.execute(["rev-parse", "HEAD"], {
          cwd: isolatedWorktreeDir,
        })
      ).stdout.trim()

      // Step 5 & 6: B / R / L Three-way project integration (Section 21.7)
      // Base = B (snapshotB)
      // Theirs = R (rebased tree)
      // Ours = L (current live CRDT replica state, which may have advanced while rebase computed!)
      let mergedFilesCount = 0

      for (const bFile of snapshotB.files) {
        if (bFile.kind === "text") {
          const currentLiveText = replica.textDocs.getTextContent(bFile.fileId)
          const absRebasedFile = path.join(isolatedWorktreeDir, bFile.path)

          if (fs.existsSync(absRebasedFile)) {
            const rebasedTargetText = fs.readFileSync(absRebasedFile, "utf8")

            if (rebasedTargetText !== bFile.textContent) {
              // Target modified this file during rebase!
              // If live text L was also modified (L !== B), three-way merge deltas via shadow doc
              if (currentLiveText !== bFile.textContent && bFile.snapshotUpdate && bFile.stateVector) {
                const shadowDoc = new Y.Doc({ guid: `rebase_shadow:${bFile.fileId}` })
                Y.applyUpdate(shadowDoc, bFile.snapshotUpdate)
                const shadowText = shadowDoc.getText("content")

                const targetDiffs = this.diffEngine.computeDiff(bFile.textContent ?? "", rebasedTargetText)
                shadowDoc.transact(() => {
                  let idx = 0
                  for (const op of targetDiffs) {
                    if (op.op === "equal") {
                      idx += op.text.length
                    } else if (op.op === "delete") {
                      shadowText.delete(idx, op.text.length)
                    } else if (op.op === "insert") {
                      shadowText.insert(idx, op.text)
                      idx += op.text.length
                    }
                  }
                }, { actorType: "system" })

                const rebaseDelta = Y.encodeStateAsUpdate(shadowDoc, bFile.stateVector)
                replica.textDocs.applyUpdate(bFile.fileId, rebaseDelta)
                shadowDoc.destroy()
              } else {
                // Live text had no concurrent edits; adopt rebased target directly
                replica.updateTextContent(bFile.fileId, rebasedTargetText)
              }
              mergedFilesCount++
            }
          }
        }
      }

      // Step 7: Update local branch ref to rebased commit OID
      await this.gitService.process.execute(
        ["update-ref", `refs/heads/${sessionBranch}`, rebasedCommitOid, sessionOid],
        { cwd: repoPath },
      )

      return {
        success: true,
        status: "complete",
        oldBranchOid: sessionOid,
        newBranchOid: rebasedCommitOid,
        mergedFilesCount,
      }
    } finally {
      // Clean up isolated worktree
      try {
        await this.gitService.process.execute(
          ["worktree", "remove", "--force", isolatedWorktreeDir],
          { cwd: repoPath, allowNonZeroExit: true },
        )
        if (fs.existsSync(isolatedWorktreeDir)) {
          fs.rmSync(isolatedWorktreeDir, { recursive: true, force: true })
        }
      } catch {
        // Ignore
      }
    }
  }
}
