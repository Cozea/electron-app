import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { asBranchName, asSessionId } from "@shared/collaboration"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { RebaseCoordinator } from "../../apps/projectd/src/autogit/RebaseCoordinator"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

describe("P21 Explicit isolated Rebase from main", () => {
  const actor: ChangeActor = { actorType: "user", principalId: "u_p21" }
  const tmpDir = "/tmp"
  let testRepoDir: string
  let gitService: GitService
  let rebaseCoordinator: RebaseCoordinator

  const sessionId = asSessionId("sess_rebase_test")
  const sessionBranch = asBranchName("feature/work")
  const targetBranch = asBranchName("main")

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testRepoDir = path.join(tmpDir, `test_p21_repo_${id}`)
    fs.mkdirSync(testRepoDir, { recursive: true })

    gitService = new GitService()
    await gitService.initRepo(testRepoDir, "main")
    rebaseCoordinator = new RebaseCoordinator(gitService)
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

  it("enforces Invariant C25: Rebase requires explicit user action", async () => {
    const replica = new SessionReplica(sessionId, "client_1")
    await gitService.createCommit(testRepoDir, "root", { allowEmpty: true })
    await gitService.createBranch(testRepoDir, "feature/work", "main")

    // Attempt rebase without user action -> rejected
    await expect(
      rebaseCoordinator.executeRebase({
        sessionId,
        repoPath: testRepoDir,
        sessionBranch,
        targetBranch,
        replica,
        isUserAction: false, // Automated trigger rejected!
      }),
    ).rejects.toThrow(/Invariant C25 violated/)
  })

  it("performs clean isolated rebase onto target branch", async () => {
    // 1. Initial base commit on main
    fs.writeFileSync(path.join(testRepoDir, "base.txt"), "base content\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "base commit")

    // 2. Branch feature/work and commit file_f.txt
    await gitService.createBranch(testRepoDir, "feature/work", "main")
    await gitService.process.execute(["checkout", "feature/work"], { cwd: testRepoDir })
    fs.writeFileSync(path.join(testRepoDir, "feature.txt"), "feature content\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    const oldFeatureOid = await gitService.createCommit(testRepoDir, "feature commit")

    // 3. Switch back to main and commit target.txt
    await gitService.process.execute(["checkout", "main"], { cwd: testRepoDir })
    fs.writeFileSync(path.join(testRepoDir, "target.txt"), "target content\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "target commit")

    // Replay on replica
    const replica = new SessionReplica(sessionId, "client_1")
    replica.createFile({
      path: "feature.txt",
      kind: "text",
      content: "feature content\n",
      actor,
    })

    // Execute explicit rebase
    const res = await rebaseCoordinator.executeRebase({
      sessionId,
      repoPath: testRepoDir,
      sessionBranch,
      targetBranch,
      replica,
      isUserAction: true,
    })

    expect(res.success).toBe(true)
    expect(res.status).toBe("complete")
    expect(res.newBranchOid).toBeDefined()
    expect(res.newBranchOid).not.toBe(oldFeatureOid)

    // Verify git log on feature/work contains both target commit and rebased feature commit
    const logRes = await gitService.process.execute(["log", "--oneline", "feature/work"], {
      cwd: testRepoDir,
    })
    expect(logRes.stdout).toContain("feature commit")
    expect(logRes.stdout).toContain("target commit")
  })

  it("preserves concurrent live edits made while rebase was computing (B/R/L Three-Way Integration)", async () => {
    // 1. Base commit on main
    fs.writeFileSync(path.join(testRepoDir, "code.ts"), "const base = 1;\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "base")

    // 2. Feature branch
    await gitService.createBranch(testRepoDir, "feature/work", "main")
    await gitService.process.execute(["checkout", "feature/work"], { cwd: testRepoDir })
    fs.writeFileSync(path.join(testRepoDir, "feature.txt"), "feature 1\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "feature commit")

    // 3. Advance main with non-conflicting edit to code.ts
    await gitService.process.execute(["checkout", "main"], { cwd: testRepoDir })
    fs.writeFileSync(path.join(testRepoDir, "code.ts"), "const base = 1;\nconst mainAdded = true;\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "main edit")

    const replica = new SessionReplica(sessionId, "client_1")
    const codeFile = replica.createFile({
      path: "code.ts",
      kind: "text",
      content: "const base = 1;\n",
      actor,
    })

    const res = await rebaseCoordinator.executeRebase({
      sessionId,
      repoPath: testRepoDir,
      sessionBranch,
      targetBranch,
      replica,
      isUserAction: true,
      onBeforeCompute: async () => {
        // Live user concurrently edited code.ts while rebase was computing!
        replica.textDocs.getOrCreate(codeFile.fileId).text.insert(0, "// Local author note\n")
      },
    })

    expect(res.success).toBe(true)

    // Three-way integration preserves BOTH the target change AND the concurrent local live edit!
    const converged = replica.textDocs.getTextContent(codeFile.fileId)
    expect(converged).toContain("// Local author note")
    expect(converged).toContain("const mainAdded = true")
  })

  it("handles conflicting rebase by generating conflict bundle without mutating live CRDT", async () => {
    // Base commit
    const conflictFile = path.join(testRepoDir, "conflict.txt")
    fs.writeFileSync(conflictFile, "initial\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "base")

    // Feature modifies conflict.txt
    await gitService.createBranch(testRepoDir, "feature/work", "main")
    await gitService.process.execute(["checkout", "feature/work"], { cwd: testRepoDir })
    fs.writeFileSync(conflictFile, "divergent feature edit\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "feature edit")

    // Main modifies conflict.txt with conflicting change
    await gitService.process.execute(["checkout", "main"], { cwd: testRepoDir })
    fs.writeFileSync(conflictFile, "divergent main edit\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "main edit")

    const replica = new SessionReplica(sessionId, "client_1")
    replica.createFile({
      path: "conflict.txt",
      kind: "text",
      content: "divergent feature edit\n",
      actor,
    })

    const res = await rebaseCoordinator.executeRebase({
      sessionId,
      repoPath: testRepoDir,
      sessionBranch,
      targetBranch,
      replica,
      isUserAction: true,
    })

    // Conflict detected in isolated worktree; live CRDT remains untouched!
    expect(res.success).toBe(false)
    expect(res.status).toBe("conflicted")
    expect(res.conflicts).toBeDefined()
    expect(res.conflicts).toHaveLength(1)
    expect(res.conflicts![0].path).toBe("conflict.txt")

    // Live CRDT untouched
    expect(replica.textDocs.getTextContent(replica.tree.listLiveEntries()[0].fileId)).toBe(
      "divergent feature edit\n",
    )
  })
})
