import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { asBranchName, asSessionId } from "@shared/collaboration"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { TargetBranchTracker } from "../../apps/projectd/src/autogit/TargetBranchTracker"

describe("P20 Target tracking and rebase recommendation", () => {
  const tmpDir = "/tmp"
  let testRepoDir: string
  let gitService: GitService
  let tracker: TargetBranchTracker

  const sessionId = asSessionId("sess_p20_target")
  const sessionBranch = asBranchName("feature/experiment")
  const targetBranch = asBranchName("main")

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testRepoDir = path.join(tmpDir, `test_p20_repo_${id}`)
    fs.mkdirSync(testRepoDir, { recursive: true })

    gitService = new GitService()
    await gitService.initRepo(testRepoDir, "main")
    tracker = new TargetBranchTracker(gitService)
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

  it("reports IDLE and not recommended when session branch is aligned with target", async () => {
    await gitService.createCommit(testRepoDir, "commit 1", {
      allowEmpty: true,
      author: { name: "Tester", email: "t@e.com" },
    })
    await gitService.createBranch(testRepoDir, "feature/experiment", "main")

    const status = await tracker.checkTargetDivergence({
      sessionId,
      repoPath: testRepoDir,
      repositoryBindingId: "repo_1",
      sessionBranch,
      targetBranch,
    })

    expect(status.lifecycle).toBe("IDLE")
    expect(status.recommended).toBe(false)
    expect(status.behindCommitCount).toBe(0)
    expect(status.aheadCommitCount).toBe(0)
  })

  it("recommends rebase when target has moved ahead by 20+ commits (Section 20.3)", async () => {
    await gitService.createCommit(testRepoDir, "root", {
      allowEmpty: true,
      author: { name: "Tester", email: "t@e.com" },
    })

    // Branch off session branch
    await gitService.createBranch(testRepoDir, "feature/experiment", "main")

    // Advance target branch (main) by 20 commits
    for (let i = 1; i <= 20; i++) {
      await gitService.createCommit(testRepoDir, `main commit ${i}`, {
        allowEmpty: true,
        author: { name: "MainDev", email: "m@e.com" },
      })
    }

    const status = await tracker.checkTargetDivergence({
      sessionId,
      repoPath: testRepoDir,
      repositoryBindingId: "repo_1",
      sessionBranch,
      targetBranch,
    })

    // Recommends rebase with clear explanation
    expect(status.lifecycle).toBe("SUGGESTED")
    expect(status.recommended).toBe(true)
    expect(status.behindCommitCount).toBe(20)
    expect(status.recommendationReason).toContain("20 commits ahead")

    // Invariant C25 assertion: Lifecycle is SUGGESTED, NOT REQUESTED or running!
    expect(status.lifecycle).not.toBe("REQUESTED")
    expect(status.requestedAt).toBeNull()
  })

  it("recommends rebase when target modified overlapping files and is 5+ commits ahead", async () => {
    // Commit shared file
    const sharedFile = path.join(testRepoDir, "shared.ts")
    fs.writeFileSync(sharedFile, "export const x = 1;\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "base commit", {
      author: { name: "Tester", email: "t@e.com" },
    })

    // Branch off session branch
    await gitService.createBranch(testRepoDir, "feature/experiment", "main")

    // Modify shared file on main + 5 commits
    for (let i = 1; i <= 5; i++) {
      fs.writeFileSync(sharedFile, `export const x = ${i + 1};\n`)
      await gitService.process.execute(["add", "."], { cwd: testRepoDir })
      await gitService.createCommit(testRepoDir, `main edit ${i}`, {
        author: { name: "MainDev", email: "m@e.com" },
      })
    }

    const status = await tracker.checkTargetDivergence({
      sessionId,
      repoPath: testRepoDir,
      repositoryBindingId: "repo_1",
      sessionBranch,
      targetBranch,
      sessionModifiedPaths: ["shared.ts"], // Session is also touching shared.ts!
    })

    expect(status.lifecycle).toBe("SUGGESTED")
    expect(status.recommended).toBe(true)
    expect(status.recommendationReason).toContain("overlapping file(s)")
  })

  it("respects dismissal cooldown for automatic suggestions", async () => {
    await gitService.createCommit(testRepoDir, "root", { allowEmpty: true })
    await gitService.createBranch(testRepoDir, "feature/experiment", "main")

    for (let i = 1; i <= 20; i++) {
      await gitService.createCommit(testRepoDir, `commit ${i}`, { allowEmpty: true })
    }

    // Dismiss recommendation
    tracker.dismissRecommendation()

    const status = await tracker.checkTargetDivergence({
      sessionId,
      repoPath: testRepoDir,
      repositoryBindingId: "repo_1",
      sessionBranch,
      targetBranch,
    })

    // Automatic suggestion suppressed during cooldown
    expect(status.recommended).toBe(false)
    expect(status.lifecycle).toBe("IDLE")

    // But manual check overrides cooldown!
    const manualStatus = await tracker.checkTargetDivergence({
      sessionId,
      repoPath: testRepoDir,
      repositoryBindingId: "repo_1",
      sessionBranch,
      targetBranch,
      isManualCheck: true,
    })

    expect(manualStatus.recommended).toBe(true)
    expect(manualStatus.lifecycle).toBe("SUGGESTED")
  })
})
