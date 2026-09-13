import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GitService } from "../../apps/projectd/src/git/GitService"
import { GitBaselineAdopter } from "../../apps/projectd/src/autogit/GitBaselineAdopter"
import { useTestGitIdentity } from "../helpers/gitIdentity"

useTestGitIdentity()

describe("P18 Local Git baseline advancement after AutoGit checkpoint", () => {
  const tmpDir = "/tmp"
  let testRepoDir: string
  let gitService: GitService
  let adopter: GitBaselineAdopter

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testRepoDir = path.join(tmpDir, `test_p18_repo_${id}`)
    fs.mkdirSync(testRepoDir, { recursive: true })

    gitService = new GitService()
    await gitService.initRepo(testRepoDir, "feature/collab")
    adopter = new GitBaselineAdopter(gitService)
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

  it("advances HEAD to C41 while preserving newer working-tree bytes (Required Example Test)", async () => {
    // 1. Initial state: commit C40
    const filePath = path.join(testRepoDir, "app.ts")
    fs.writeFileSync(filePath, "const base = 'C40';\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    const c40Oid = await gitService.createCommit(testRepoDir, "commit C40", {
      author: { name: "AutoGit", email: "autogit@cozea.local" },
    })

    const statusBefore = await gitService.getStatus(testRepoDir)
    expect(statusBefore.headOid).toBe(c40Oid)

    // 2. AutoGit creates checkpoint C41 (seq 18500) on a branch/commit
    // Write C41 commit directly in git object database
    fs.writeFileSync(filePath, "const base = 'C41 checkpoint 18500';\n")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    const c41Oid = await gitService.createCommit(testRepoDir, "commit C41 seq 18500", {
      author: { name: "AutoGit", email: "autogit@cozea.local" },
    })

    // Reset HEAD back to C40 to simulate participant local machine before adoption
    await gitService.process.execute(["reset", "--hard", c40Oid], { cwd: testRepoDir })
    expect((await gitService.getStatus(testRepoDir)).headOid).toBe(c40Oid)

    // 3. Local working tree advances via CRDT to newer state (seq 18570)
    fs.writeFileSync(
      filePath,
      "const base = 'C41 checkpoint 18500';\nconst newerLiveCrdt = 18570;\n",
    )

    // 4. AutoGit notifies participant of C41 publication.
    // Adopter advances baseline safely without pulling bytes already delivered by CRDT!
    const result = await adopter.advanceBaseline({
      cwd: testRepoDir,
      branchName: "feature/collab",
      checkpointOid: c41Oid,
    })

    expect(result.success).toBe(true)
    expect(result.newHeadOid).toBe(c41Oid)

    // Verify HEAD is now C41
    const statusAfter = await gitService.getStatus(testRepoDir)
    expect(statusAfter.headOid).toBe(c41Oid)

    // Verify working tree still has the newer seq 18570 bytes!
    const currentBytes = fs.readFileSync(filePath, "utf8")
    expect(currentBytes).toContain("newerLiveCrdt = 18570")

    // Verify git diff/dirty reflects ONLY work made after C41
    const diffRes = await gitService.process.execute(["diff", "HEAD"], { cwd: testRepoDir })
    expect(diffRes.stdout).toContain("+const newerLiveCrdt = 18570;")
    expect(diffRes.stdout).not.toContain("C40")
  })

  it("fails safely without resetting working tree when active git conflicts exist", async () => {
    // Create an unmerged conflict in the repo
    const filePath = path.join(testRepoDir, "file.txt")
    fs.writeFileSync(filePath, "content 1")
    await gitService.process.execute(["add", "."], { cwd: testRepoDir })
    await gitService.createCommit(testRepoDir, "c1")

    const res = await adopter.advanceBaseline({
      cwd: testRepoDir,
      branchName: "feature/collab",
      checkpointOid: "some_invalid_oid",
    })

    expect(res.success).toBe(false)
    // Working tree was never touched
    expect(fs.readFileSync(filePath, "utf8")).toBe("content 1")
  })
})
