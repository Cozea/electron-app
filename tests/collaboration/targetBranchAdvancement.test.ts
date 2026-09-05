import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { advancePublishedCollaborationBase, validateCollaborationSession, type CollaborationSessionDescriptor } from "../../shared/collaborationSession"
import { checkCollaborationTarget, endCollaborationForRestart } from "../../shared/collaborationTargetBranch"

const exec = promisify(execFile)
let root: string
let source: string
let room: string
let remote: string
let session: CollaborationSessionDescriptor
async function git(cwd: string, ...args: string[]) {
  return (await exec("git", args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } })).stdout.trim()
}
async function resolve() {
  const line = await git(source, "ls-remote", remote, "refs/heads/main")
  return { repositoryId: "github:1", branch: "main", commitSha: line.split(/\s+/)[0]! }
}
async function advanceTarget() {
  await fs.writeFile(path.join(source, "target.txt"), "target advanced\n")
  await git(source, "add", "target.txt")
  await git(source, "commit", "-m", "advance target")
  await git(source, "push", remote, "main")
  return (await resolve()).commitSha
}
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-target-check-"))
  source = path.join(root, "source"); room = path.join(root, "room"); remote = path.join(root, "remote.git")
  await fs.mkdir(source)
  await git(source, "init", "-b", "main")
  await git(source, "config", "user.name", "Target Test")
  await git(source, "config", "user.email", "test@example.com")
  await fs.writeFile(path.join(source, "shared.txt"), "original\n")
  await git(source, "add", "."); await git(source, "commit", "-m", "base")
  const base = await git(source, "rev-parse", "HEAD")
  await git(source, "clone", "--bare", source, remote)
  await git(source, "worktree", "add", "-b", "cozea/collab/target-test", room, base)
  session = { id: "target-test", projectId: "project", repositoryId: "github:1", targetBranch: "main",
    targetCommitSha: base, sessionBranch: "cozea/collab/target-test", baseCommitSha: base, publishedCommitSha: null,
    publishedThroughSequence: 0, roomHeadSequence: 2, createdByUserId: "user", commitLeaseUserId: null,
    commitLeaseExpiresAt: null, pendingCommitSha: null, pendingCommitThroughSequence: null, pendingCommitCreatedAt: null,
    status: "active", createdAt: 1, updatedAt: 1, closedAt: null }
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe("target branch advancement", () => {
  it("keeps the starting target identity across publication and leaves newer dirty session work untouched", async () => {
    await fs.writeFile(path.join(room, "shared.txt"), "published\n")
    await git(room, "add", "."); await git(room, "commit", "-m", "shared publication")
    const published = await git(room, "rev-parse", "HEAD")
    await git(room, "push", remote, session.sessionBranch)
    const next = advancePublishedCollaborationBase({ ...session, status: "pushing", commitLeaseUserId: "user", commitLeaseExpiresAt: 100,
      pendingCommitSha: published, pendingCommitThroughSequence: 1, pendingCommitCreatedAt: 10, updatedAt: 10 },
    { commitSha: published, coveredThroughSequence: 1, publishedByUserId: "user", publishedAt: 20 })
    expect(next.targetCommitSha).toBe(session.targetCommitSha)
    expect(next.baseCommitSha).toBe(published)
    expect(checkCollaborationTarget(next, await resolve()).status).toBe("unchanged")
    await fs.writeFile(path.join(room, "shared.txt"), "newer unpublished shared work\n")
    await fs.writeFile(path.join(room, "local.bin"), Buffer.from([0, 255, 4]))
    const target = await advanceTarget()
    expect(checkCollaborationTarget(next, await resolve())).toEqual({ status: "changed", commitSha: target })
    expect(await git(room, "rev-parse", "HEAD")).toBe(published)
    expect(await git(room, "symbolic-ref", "--short", "HEAD")).toBe(session.sessionBranch)
    expect(await fs.readFile(path.join(room, "shared.txt"), "utf8")).toBe("newer unpublished shared work\n")
    expect(await fs.readFile(path.join(room, "local.bin"))).toEqual(Buffer.from([0, 255, 4]))
    expect(await git(room, "diff", "--cached", "--name-only")).toBe("")
  })
  it("returns the original workspace and branch for an explicit fresh Start after ending", async () => {
    await advanceTarget()
    const calls: string[] = []
    const result = await endCollaborationForRestart(session, {
      getBinding: async () => ({ projectId: session.projectId, sourceWorkspaceId: "ordinary-source" }),
      resolve: async input => { expect(input).toEqual({ projectId: "project", branch: "main" }); calls.push("resolve"); return resolve() },
      leave: async input => { expect(input).toEqual({ sessionId: session.id, end: true }); calls.push("end") },
    })
    expect(calls).toEqual(["resolve", "end"])
    expect(result).toEqual({ sourceWorkspaceId: "ordinary-source", branch: "main", creationToken: expect.any(String) })
    expect(result.creationToken).toMatch(/^[0-9a-f-]{36}$/)
  })
  it("retains the current session when target access or local association is unavailable", async () => {
    const leave = vi.fn()
    const deps = { getBinding: async () => ({ projectId: "project", sourceWorkspaceId: "source" }),
      resolve: async () => { throw new Error("Repository access removed") }, leave }
    await expect(endCollaborationForRestart(session, deps)).rejects.toThrow("Repository access removed")
    await expect(endCollaborationForRestart(session, { ...deps, getBinding: async () => null })).rejects.toThrow("original workspace")
    await expect(endCollaborationForRestart(session, { ...deps, getBinding: async () => ({ projectId: "unrelated", sourceWorkspaceId: "source" }) })).rejects.toThrow("original workspace")
    expect(leave).not.toHaveBeenCalled()
  })
  it("does not report a restart selection after interrupted End; a retry can finish", async () => {
    const leave = vi.fn().mockRejectedValueOnce(new Error("Cannot drain local edits")).mockResolvedValue(undefined)
    const deps = { getBinding: async () => ({ projectId: "project", sourceWorkspaceId: "source" }), resolve, leave }
    await expect(endCollaborationForRestart(session, deps)).rejects.toThrow("Cannot drain local edits")
    expect((await endCollaborationForRestart(session, deps)).branch).toBe("main")
    expect(leave).toHaveBeenCalledTimes(2)
  })
  it("rejects mismatched repositories, branches and invalid SHAs and never invents an older session baseline", async () => {
    const resolved = await resolve()
    expect(checkCollaborationTarget({ ...session, targetCommitSha: undefined }, resolved).status).toBe("unknown")
    expect(() => checkCollaborationTarget(session, { ...resolved, repositoryId: "github:other" })).toThrow("does not match")
    expect(() => checkCollaborationTarget(session, { ...resolved, branch: "different" })).toThrow("does not match")
    expect(() => checkCollaborationTarget(session, { ...resolved, commitSha: "bad" })).toThrow("40-character")
    expect(() => validateCollaborationSession({ ...session, targetCommitSha: "bad" })).toThrow("Starting target commit SHA")
  })
})
