import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GitService } from "../../apps/projectd/src/git/GitService"
import { GitBaselineAdopter } from "../../apps/projectd/src/autogit/GitBaselineAdopter"
import { ExternalGitInteroperability } from "../../apps/projectd/src/git/ExternalGitInteroperability"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"
import { useTestGitIdentity } from "../helpers/gitIdentity"

useTestGitIdentity()

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

  describe("controlled sync from GitHub (G10)", () => {
    async function sh(cwd: string, ...args: string[]): Promise<string> {
      return (await gitService.process.execute(args, { cwd })).stdout.trim()
    }

    async function commitFile(dir: string, name: string, content: string, message: string): Promise<string> {
      fs.writeFileSync(path.join(dir, name), content)
      await gitService.process.execute(["add", "-A"], { cwd: dir })
      await gitService.createCommit(dir, message, { author: { name: "Tester", email: "test@example.com" } })
      return sh(dir, "rev-parse", "HEAD")
    }

    async function setupRemote(): Promise<{ remote: string; mirrors: string }> {
      const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
      const remote = path.join(tmpDir, `test_p19_remote_${id}.git`)
      const mirrors = path.join(tmpDir, `test_p19_mirrors_${id}`)
      fs.mkdirSync(mirrors, { recursive: true })
      await gitService.process.execute(["init", "--bare", "-b", sessionBranch, remote], { cwd: testRepoDir })
      return { remote, mirrors }
    }

    it("reports up to date when local and remote agree", async () => {
      const { remote, mirrors } = await setupRemote()
      const head = await commitFile(testRepoDir, "app.ts", "v1\n", "base")
      await gitService.process.execute(["remote", "add", "origin", remote], { cwd: testRepoDir })
      await gitService.process.execute(["push", "-q", "-u", "origin", sessionBranch], { cwd: testRepoDir })
      const mirrored = new GitService(undefined, mirrors)
      const sync = new ExternalGitInteroperability(mirrored, adopter)

      const result = await sync.controlledSyncFromGitHub({
        cwd: testRepoDir,
        repositoryBindingId: "binding_up_to_date",
        remoteUrl: remote,
        sessionBranch,
      })
      expect(result).toEqual({ status: "up_to_date" })
      expect(head).toBeTruthy()
      fs.rmSync(remote, { recursive: true, force: true })
      fs.rmSync(mirrors, { recursive: true, force: true })
    })

    it("adopts a fast-forward remote without touching local dirty bytes", async () => {
      const { remote, mirrors } = await setupRemote()
      await commitFile(testRepoDir, "app.ts", "v1\n", "base")
      await gitService.process.execute(["remote", "add", "origin", remote], { cwd: testRepoDir })
      await gitService.process.execute(["push", "-q", "-u", "origin", sessionBranch], { cwd: testRepoDir })

      const cloneDir = path.join(tmpDir, `test_p19_clone_${Date.now()}`)
      await gitService.process.execute(["clone", "-q", "-b", sessionBranch, remote, cloneDir], { cwd: tmpDir })
      const remoteHead = await commitFile(cloneDir, "app.ts", "v2\n", "remote advance")
      await gitService.process.execute(["push", "-q", "origin", sessionBranch], { cwd: cloneDir })

      fs.writeFileSync(path.join(testRepoDir, "local-dirty.txt"), "uncommitted\n")
      const mirrored = new GitService(undefined, mirrors)
      const sync = new ExternalGitInteroperability(mirrored, adopter)
      const result = await sync.controlledSyncFromGitHub({
        cwd: testRepoDir,
        repositoryBindingId: "binding_ff",
        remoteUrl: remote,
        sessionBranch,
      })
      expect(result).toEqual({ status: "fast_forward_adopted" })
      expect(await sh(testRepoDir, "rev-parse", "HEAD")).toBe(remoteHead)
      // No blind pull: refs and index move, but the working tree is untouched.
      // The session's own file sync (not Git) reconciles worktree bytes later.
      expect(fs.readFileSync(path.join(testRepoDir, "app.ts"), "utf8")).toBe("v1\n")
      expect(fs.readFileSync(path.join(testRepoDir, "local-dirty.txt"), "utf8")).toBe("uncommitted\n")
      const dirty = await sh(testRepoDir, "status", "--porcelain")
      expect(dirty).toContain("app.ts")
      fs.rmSync(remote, { recursive: true, force: true })
      fs.rmSync(mirrors, { recursive: true, force: true })
      fs.rmSync(cloneDir, { recursive: true, force: true })
    })

    it("reports divergence instead of merging a force-pushed remote", async () => {
      const { remote, mirrors } = await setupRemote()
      await commitFile(testRepoDir, "app.ts", "v1\n", "base")
      await gitService.process.execute(["remote", "add", "origin", remote], { cwd: testRepoDir })
      await gitService.process.execute(["push", "-q", "-u", "origin", sessionBranch], { cwd: testRepoDir })
      const localHead = await sh(testRepoDir, "rev-parse", "HEAD")

      const cloneDir = path.join(tmpDir, `test_p19_rewrite_${Date.now()}`)
      await gitService.process.execute(["clone", "-q", "-b", sessionBranch, remote, cloneDir], { cwd: tmpDir })
      fs.writeFileSync(path.join(cloneDir, "app.ts"), "rewritten\n")
      await gitService.process.execute(["add", "-A"], { cwd: cloneDir })
      await gitService.process.execute(["commit", "-q", "--amend", "--no-edit"], { cwd: cloneDir })
      await gitService.process.execute(["push", "-q", "--force", "origin", sessionBranch], { cwd: cloneDir })

      const mirrored = new GitService(undefined, mirrors)
      const sync = new ExternalGitInteroperability(mirrored, adopter)
      const result = await sync.controlledSyncFromGitHub({
        cwd: testRepoDir,
        repositoryBindingId: "binding_diverged",
        remoteUrl: remote,
        sessionBranch,
      })
      expect(result).toEqual({ status: "remote_diverged" })
      // Nothing was fetched into the live folder: local history stands.
      expect(await sh(testRepoDir, "rev-parse", "HEAD")).toBe(localHead)
      expect(fs.readFileSync(path.join(testRepoDir, "app.ts"), "utf8")).toBe("v1\n")
      fs.rmSync(remote, { recursive: true, force: true })
      fs.rmSync(mirrors, { recursive: true, force: true })
      fs.rmSync(cloneDir, { recursive: true, force: true })
    })
  })
})
