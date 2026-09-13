import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { asBranchName } from "@shared/collaboration"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { MergeCoordinator } from "../../apps/projectd/src/autogit/MergeCoordinator"
import { useTestGitIdentity } from "../helpers/gitIdentity"

useTestGitIdentity()

describe("P22 Merge/PR controls", () => {
  const tmpDir = "/tmp"
  let testRepoDir: string
  let gitService: GitService
  let mergeCoordinator: MergeCoordinator

  const sessionBranch = asBranchName("feature/release")
  const targetBranch = asBranchName("main")

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testRepoDir = path.join(tmpDir, `test_p22_repo_${id}`)
    fs.mkdirSync(testRepoDir, { recursive: true })

    gitService = new GitService()
    await gitService.initRepo(testRepoDir, "main")
    mergeCoordinator = new MergeCoordinator(gitService)
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

  it("previews clean merge without mutating working tree (Section 22.1)", async () => {
    // 1. Commit on main
    fs.writeFileSync(path.join(testRepoDir, "main.txt"), "main content\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "initial main")

    // 2. Branch feature and commit feature file
    await gitService.createBranch(testRepoDir, "feature/release", "main")
    await gitService.process.execute(["checkout", "feature/release"], { cwd: testRepoDir })
    fs.writeFileSync(path.join(testRepoDir, "feature.txt"), "feature content\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "feature commit")

    // Switch back to main
    await gitService.process.execute(["checkout", "main"], { cwd: testRepoDir })

    const preview = await mergeCoordinator.computeMergePreview({
      repoPath: testRepoDir,
      sessionBranch,
      targetBranch,
    })

    expect(preview.canMergeCleanly).toBe(true)
    expect(preview.mergeTreeOid).toBeDefined()
    expect(preview.aheadCount).toBe(1)
    expect(preview.behindCount).toBe(0)
    expect(preview.conflictingFiles).toHaveLength(0)
  })

  it("detects conflicting merge preview and lists conflicting files", async () => {
    const conflictFile = path.join(testRepoDir, "shared.txt")
    fs.writeFileSync(conflictFile, "initial\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "base")

    // Feature branch
    await gitService.createBranch(testRepoDir, "feature/release", "main")
    await gitService.process.execute(["checkout", "feature/release"], { cwd: testRepoDir })
    fs.writeFileSync(conflictFile, "feature version\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "feature edit")

    // Main branch
    await gitService.process.execute(["checkout", "main"], { cwd: testRepoDir })
    fs.writeFileSync(conflictFile, "main divergent version\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "main edit")

    const preview = await mergeCoordinator.computeMergePreview({
      repoPath: testRepoDir,
      sessionBranch,
      targetBranch,
    })

    expect(preview.canMergeCleanly).toBe(false)
    expect(preview.conflictingFiles).toContain("shared.txt")
  })

  it("executes clean direct merge into target branch in isolated worktree (Section 22.2)", async () => {
    fs.writeFileSync(path.join(testRepoDir, "root.txt"), "root\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "root")

    await gitService.createBranch(testRepoDir, "feature/release", "main")
    await gitService.process.execute(["checkout", "feature/release"], { cwd: testRepoDir })
    fs.writeFileSync(path.join(testRepoDir, "f.txt"), "f\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "f commit")

    await gitService.process.execute(["checkout", "main"], { cwd: testRepoDir })

    const res = await mergeCoordinator.executeDirectMerge({
      repoPath: testRepoDir,
      sessionBranch,
      targetBranch,
      strategy: "merge",
    })

    expect(res.success).toBe(true)
    expect(res.mergeCommitOid).toBeDefined()

    // Verify main branch now contains the merge commit
    const log = await gitService.process.execute(["log", "--oneline", "main"], {
      cwd: testRepoDir,
    })
    expect(log.stdout).toContain("Merge branch 'feature/release'")
  })
})
