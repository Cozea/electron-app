/**
 * External Git interoperability and controlled GitHub sync.
 *
 * Master Specification: Section 18, 19
 * Invariants:
 * - C23: AutoGit pull is controlled integration, not blind git pull in working tree.
 * - C24: External Git usage (VS Code / terminal) is detected and supported.
 */

import fs from "node:fs"
import path from "node:path"

import type { GitService } from "./GitService"
import type { SessionReplica } from "../collaboration/SessionReplica"
import type { GitBaselineAdopter } from "../autogit/GitBaselineAdopter"
import type { ChangeActor } from "../collaboration/TreeDoc"

export type ExternalGitState =
  | "clean"
  | "branch_drifted"
  | "in_progress_transition"
  | "local_commits_diverged"
  | "remote_diverged"

export interface ExternalGitInspection {
  readonly state: ExternalGitState
  readonly currentBranch: string | null
  readonly headOid: string
  readonly isBranchDrifted: boolean
  readonly isTransitionInProgress: boolean
  readonly canIngestFiles: boolean
  readonly details?: string
}

export class ExternalGitInteroperability {
  readonly gitService: GitService
  readonly baselineAdopter: GitBaselineAdopter

  constructor(gitService: GitService, baselineAdopter: GitBaselineAdopter) {
    this.gitService = gitService
    this.baselineAdopter = baselineAdopter
  }

  /**
   * Section 18.1: Inspects .git metadata to detect branch drift, in-progress rebase/merge, and local commits.
   */
  async inspectWorkspaceGit(cwd: string, sessionBranch: string): Promise<ExternalGitInspection> {
    const gitDir = path.join(cwd, ".git")
    if (!fs.existsSync(gitDir)) {
      return {
        state: "clean",
        currentBranch: sessionBranch,
        headOid: "",
        isBranchDrifted: false,
        isTransitionInProgress: false,
        canIngestFiles: true,
      }
    }

    // Check for in-progress rebase / merge / cherry-pick (Section 18.6)
    const isMerging = fs.existsSync(path.join(gitDir, "MERGE_HEAD"))
    const isRebasing =
      fs.existsSync(path.join(gitDir, "rebase-apply")) ||
      fs.existsSync(path.join(gitDir, "rebase-merge"))
    const isCherryPicking = fs.existsSync(path.join(gitDir, "CHERRY_PICK_HEAD"))

    if (isMerging || isRebasing || isCherryPicking) {
      const currentStatus = await this.gitService.getStatus(cwd)
      return {
        state: "in_progress_transition",
        currentBranch: currentStatus.headRef,
        headOid: currentStatus.headOid ?? "",
        isBranchDrifted: false,
        isTransitionInProgress: true,
        canIngestFiles: false, // Ingress paused during mass git transition
        details: "External merge, rebase, or cherry-pick is currently active in workspace",
      }
    }

    // Check branch drift (Section 18.5)
    const status = await this.gitService.getStatus(cwd)
    const currentBranch = status.headRef

    if (currentBranch && currentBranch !== sessionBranch) {
      return {
        state: "branch_drifted",
        currentBranch,
        headOid: status.headOid ?? "",
        isBranchDrifted: true,
        isTransitionInProgress: false,
        canIngestFiles: false, // Section 18.5: Pause ingress so checkout is not broadcast as edits!
        details: `Workspace branch drifted to '${currentBranch}' (session expects '${sessionBranch}')`,
      }
    }

    return {
      state: "clean",
      currentBranch: currentBranch ?? sessionBranch,
      headOid: status.headOid ?? "",
      isBranchDrifted: false,
      isTransitionInProgress: false,
      canIngestFiles: true,
    }
  }

  /**
   * Section 18.6: Adopt Git result into collaboration session.
   * Scans git tree differences and deliberately imports into CRDT.
   */
  async adoptGitResult(
    cwd: string,
    replica: SessionReplica,
    actor: ChangeActor,
  ): Promise<{ importedCount: number }> {
    const status = await this.gitService.getStatus(cwd)
    let importedCount = 0

    for (const file of status.files) {
      if (file.isIgnored) continue

      const absPath = path.join(cwd, file.path)
      try {
        if (fs.existsSync(absPath)) {
          const content = fs.readFileSync(absPath, "utf8")
          let entry = replica.tree.listLiveEntries().find((e) => e.path === file.path)
          if (!entry) {
            entry = replica.createFile({
              path: file.path,
              kind: "text",
              content,
              actor,
            })
          } else {
            replica.updateTextContent(entry.fileId, content)
          }
          importedCount++
        }
      } catch {
        // File may be deleted
      }
    }

    return { importedCount }
  }

  /**
   * Section 19: Controlled GitHub sync (replaces blind git pull in working tree).
   */
  async controlledSyncFromGitHub(params: {
    cwd: string
    repositoryBindingId: string
    remoteUrl: string
    sessionBranch: string
  }): Promise<{ status: "up_to_date" | "fast_forward_adopted" | "remote_diverged" }> {
    const { cwd, repositoryBindingId, remoteUrl, sessionBranch } = params

    // 1. Fetch in hidden mirror (never live working tree!)
    await this.gitService.mirrors.fetch(repositoryBindingId, remoteUrl)

    const remoteOid = await this.gitService.mirrors.getCommitOid(
      repositoryBindingId,
      `refs/heads/${sessionBranch}`,
    )

    if (!remoteOid) {
      return { status: "up_to_date" }
    }

    const localStatus = await this.gitService.getStatus(cwd)
    const localOid = localStatus.headOid

    if (localOid === remoteOid) {
      return { status: "up_to_date" }
    }

    // Check merge-base to verify if fast-forward
    const mergeBase = await this.gitService.mirrors.getMergeBase(
      repositoryBindingId,
      localOid ?? remoteOid,
      remoteOid,
    )

    if (mergeBase === localOid) {
      // Remote is fast-forward ahead: adopt checkpoint baseline safely.
      // The adopter fetches the missing objects into this folder itself; a
      // skip (conflicts, wrong branch, unfetchable object) must not report
      // success, or callers believe a sync happened that never did.
      const adopted = await this.baselineAdopter.advanceBaseline({
        cwd,
        branchName: sessionBranch,
        checkpointOid: remoteOid,
        remote: remoteUrl,
      })
      if (!adopted.success) {
        throw new Error(`Controlled sync cannot adopt ${remoteOid.slice(0, 7)} here: ${adopted.reason ?? adopted.error ?? "unknown"}`)
      }
      return { status: "fast_forward_adopted" }
    }

    // Non-fast-forward: remote history diverged!
    return { status: "remote_diverged" }
  }
}
