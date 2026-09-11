import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GitService } from "../../apps/projectd/src/git/GitService"
import { GitBaselineAdopter } from "../../apps/projectd/src/autogit/GitBaselineAdopter"
import { ExternalGitInteroperability } from "../../apps/projectd/src/git/ExternalGitInteroperability"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

describe("P19 External Git interoperability and controlled GitHub sync", () => {
  const actor: ChangeActor = { actorType: "user", principalId: "u_p19" }
  const tmpDir = "/tmp"
  let testRepoDir: string
  let gitService: GitService
  let adopter: GitBaselineAdopter
  let externalGit: ExternalGitInteroperability

  const sessionBranch = "feature/dashboard"

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testRepoDir = path.join(tmpDir, `test_p19_repo_${id}`)
    fs.mkdirSync(testRepoDir, { recursive: true })

    gitService = new GitService()
    await gitService.initRepo(testRepoDir, sessionBranch)
    adopter = new GitBaselineAdopter(gitService)
    externalGit = new ExternalGitInteroperability(gitService, adopter)
  })

  afterEach(() => {
    try {
      if (fs.existsSync(testRepoDir)) {
        fs.rmSync(testRepoDir, { recursive: true, force: true })
      }
    } catch {
      // Ignore
    }
  })

  it("detects clean workspace state on session branch", async () => {
    const inspection = await externalGit.inspectWorkspaceGit(testRepoDir, sessionBranch)
    expect(inspection.state).toBe("clean")
    expect(inspection.isBranchDrifted).toBe(false)
    expect(inspection.canIngestFiles).toBe(true)
  })

  it("detects branch drift and pauses filesystem ingress (Section 18.5)", async () => {
    // Commit initial state
    await gitService.createCommit(testRepoDir, "initial", {
      allowEmpty: true,
      author: { name: "Tester", email: "test@example.com" },
    })

    // User checks out a different branch externally: git checkout -b other-branch
    await gitService.process.execute(["checkout", "-b", "other-branch"], { cwd: testRepoDir })

    const inspection = await externalGit.inspectWorkspaceGit(testRepoDir, sessionBranch)
    expect(inspection.state).toBe("branch_drifted")
    expect(inspection.isBranchDrifted).toBe(true)
    expect(inspection.currentBranch).toBe("other-branch")
    // Ingress MUST be paused to prevent broadcasting mass branch checkout writes as edits!
    expect(inspection.canIngestFiles).toBe(false)
  })

  it("detects in-progress merge/rebase and pauses ingress (Section 18.6)", async () => {
    const gitDir = path.join(testRepoDir, ".git")

    // Simulate merge in progress by writing MERGE_HEAD
    fs.writeFileSync(path.join(gitDir, "MERGE_HEAD"), "abc1234\n")

    const inspection = await externalGit.inspectWorkspaceGit(testRepoDir, sessionBranch)
    expect(inspection.state).toBe("in_progress_transition")
    expect(inspection.isTransitionInProgress).toBe(true)
    expect(inspection.canIngestFiles).toBe(false)

    // Clean up
    fs.unlinkSync(path.join(gitDir, "MERGE_HEAD"))
  })

  it("adopts external Git result into session (Section 18.6)", async () => {
    const replica = new SessionReplica("session_adopt", "client_1")

    // File written on disk via external git merge/checkout
    fs.writeFileSync(path.join(testRepoDir, "adopted.ts"), "export const adopted = true;")

    const res = await externalGit.adoptGitResult(testRepoDir, replica, actor)
    expect(res.importedCount).toBeGreaterThan(0)

    const entry = replica.tree.listLiveEntries().find((e) => e.path === "adopted.ts")
    expect(entry).toBeDefined()
    expect(replica.textDocs.getTextContent(entry!.fileId)).toBe("export const adopted = true;")
  })
})
