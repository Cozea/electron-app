import { execFile } from "node:child_process"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { promisify } from "node:util"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SessionWorkspaceCoordinator, type CollaborationCoordinatorDependencies } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"
import type { CollaborationWorkspaceAuthority, PrepareCollaborationCommitInput } from "../../shared/collaborationDesktop"
import type { LocalWorkspaceDTO } from "../../shared/workspaceTypes"
import { assertCollaborationWorkspaceOperation } from "../../apps/desktop/electron/collaboration/workspacePolicy"
import { binaryReviewHash } from "../../apps/desktop/electron/collaboration/binaryReview"

const exec = promisify(execFile)
const github = "https://github.com/cozea/test.git"
let root: string
let source: string
let remote: string
let target: string
let authority: CollaborationWorkspaceAuthority
let deps: CollaborationCoordinatorDependencies
let coordinator: SessionWorkspaceCoordinator
let state: Map<string, string>
let workspaces: Map<string, LocalWorkspaceDTO>
let active: string
const now = 1_800_000_000_000
async function git(cwd: string, ...args: string[]) {
  return (await exec("git", args, { cwd, env: { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_TERMINAL_PROMPT: "0" } })).stdout.trim()
}
function dto(id: string, directory: string): LocalWorkspaceDTO {
  return { workspaceId: id, projectId: "p", projectRootPath: directory, verificationStatus: "verified", storageOwnership: "managed" } as LocalWorkspaceDTO
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-session-test-"))
  source = path.join(root, "source")
  remote = path.join(root, "remote.git")
  target = path.join(root, "session")
  await fs.mkdir(source)
  await git(source, "init", "-b", "main")
  await git(source, "config", "user.name", "Test")
  await git(source, "config", "user.email", "test@example.com")
  await fs.writeFile(path.join(source, "shared.txt"), "base\n")
  await fs.writeFile(path.join(source, "other.txt"), "keep\n")
  await git(source, "add", ".")
  await git(source, "commit", "-m", "base")
  const base = await git(source, "rev-parse", "HEAD")
  await git(source, "clone", "--bare", source, remote)
  await git(source, "remote", "add", "origin", github)
  state = new Map()
  workspaces = new Map([["source", dto("source", source)]])
  active = "source"
  authority = {
    userId: "user", role: "editor", cloneUrl: github, expiresAt: now + 60_000,
    session: {
      id: "test-session", projectId: "p", repositoryId: "github:1", targetBranch: "main",
      sessionBranch: "cozea/collab/test-session", baseCommitSha: base, publishedCommitSha: null,
      publishedThroughSequence: 0, roomHeadSequence: 10, createdByUserId: "user",
      commitLeaseUserId: null, commitLeaseExpiresAt: null, pendingCommitSha: null,
      pendingCommitThroughSequence: null, pendingCommitCreatedAt: null, status: "active",
      createdAt: now, updatedAt: now, closedAt: null,
    },
  }
  deps = {
    async git(args, options) {
      // Only the remote fixture replaces HTTPS; all worktree/index/object
      // operations below execute real Git without implementation mocks.
      const mapped = args.map(arg => arg === github ? remote : arg)
      if (mapped.includes("fetch") || mapped.includes("clone") || mapped.includes("push")) mapped.unshift("-c", "protocol.file.allow=always")
      try {
        const child = execFile("git", mapped, { cwd: options.cwd, env: { ...process.env, ...options.env }, maxBuffer: 16 * 1024 * 1024 })
        const result = new Promise<{ stdout: string; stdoutBytes: Uint8Array; stderr: string }>((resolve, reject) => {
          const chunks: Buffer[] = []
          let stderr = ""
          child.stdout?.on("data", chunk => { chunks.push(Buffer.from(chunk)) })
          child.stderr?.on("data", chunk => { stderr += chunk })
          child.on("error", reject)
          child.on("close", code => code === 0 ? resolve({ stdout: Buffer.concat(chunks).toString("utf8"), stdoutBytes: Buffer.concat(chunks), stderr }) : reject(new Error(stderr)))
        })
        child.stdin?.end(options.stdin)
        return { success: true, ...await result }
      } catch (error) { return { success: false, stdout: "", stderr: String(error) } }
    },
    getWorkspace: async id => workspaces.get(id) ?? null,
    async allocate(_projectId, _sessionId, prepare) {
      await fs.mkdir(target, { recursive: true })
      await prepare(target)
      const workspace = dto("session", target)
      workspaces.set("session", workspace)
      return workspace
    },
    async setActive(id) { active = id },
    read: async key => state.get(key) ?? null,
    async write(key, value) { state.set(key, value) },
    authorize: async () => authority,
    credential: async () => ({ cloneUrl: github, repositoryId: "github:1", expiresAt: now + 60_000, token: "SECRET_TEST_CREDENTIAL" }),
    verifyPush: async () => {},
    scratchRoot: path.join(root, "scratch"), now: () => now,
  }
  coordinator = new SessionWorkspaceCoordinator(deps)
})
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

async function prepare() { return coordinator.prepare("test-session", "source", "device-token") }
function lease() {
  authority.session.status = "commit_preparing"
  authority.session.commitLeaseUserId = "user"
  authority.session.commitLeaseExpiresAt = now + 30_000
}
function commitInput(): PrepareCollaborationCommitInput {
  return { sessionId: "test-session", accessToken: "device-token", throughSequence: 5,
    textChanges: [{ path: "shared.txt", content: "barrier\n" }], binaryPaths: [] as string[],
    message: "Shared snapshot", authorName: "Test", authorEmail: "test@example.com" }
}

describe("catalog-owned collaboration workspaces", () => {
  it("suspends new actions before teardown and revokes writes even when the original workspace is missing", async () => {
    await prepare()
    expect(await coordinator.suspendActions("test-session")).toBe("session")
    expect(() => assertCollaborationWorkspaceOperation(state.get("collaboration:g3:workspace:session")!, "terminal-create")).toThrow("retained")
    workspaces.delete("source")
    await expect(coordinator.leave("test-session")).rejects.toThrow("Original workspace")
    expect((await coordinator.getBinding("test-session"))?.state).toBe("left")
    expect(() => assertCollaborationWorkspaceOperation(state.get("collaboration:g3:workspace:session")!, "write-file")).toThrow("retained")
    expect(await fs.readFile(path.join(target, "shared.txt"), "utf8")).toBe("base\n")
  })
  it("adopts verified text and binary publication while preserving newer shared edits and local binaries", async () => {
    await prepare()
    await fs.writeFile(path.join(source, "shared.txt"), "published\n")
    await fs.writeFile(path.join(source, "other.txt"), "published other\n")
    await fs.writeFile(path.join(source, "image.bin"), Buffer.from([0, 255, 11]))
    await fs.writeFile(path.join(source, "local.bin"), Buffer.from([0, 1]))
    await git(source, "add", "."); await git(source, "commit", "-m", "published")
    const published = await git(source, "rev-parse", "HEAD")
    await git(source, "push", remote, `HEAD:refs/heads/${authority.session.sessionBranch}`)
    authority.session.baseCommitSha = published; authority.session.publishedCommitSha = published; authority.session.publishedThroughSequence = 5
    await fs.writeFile(path.join(target, "shared.txt"), "newer uncommitted shared text\n")
    await fs.writeFile(path.join(target, "local.bin"), Buffer.from([0, 2]))
    const binding = await coordinator.adoptPublished("test-session", "device-token", ["shared.txt"])
    expect(binding.baseCommitSha).toBe(published)
    expect(await git(target, "rev-parse", "HEAD")).toBe(published)
    expect(await git(target, "show", ":shared.txt")).toBe("published")
    expect(await fs.readFile(path.join(target, "shared.txt"), "utf8")).toBe("newer uncommitted shared text\n")
    expect(await fs.readFile(path.join(target, "other.txt"), "utf8")).toBe("published other\n")
    expect(await fs.readFile(path.join(target, "image.bin"))).toEqual(Buffer.from([0, 255, 11]))
    expect(await fs.readFile(path.join(target, "local.bin"))).toEqual(Buffer.from([0, 2]))
    expect(await coordinator.adoptPublished("test-session", "device-token", ["shared.txt"])).toEqual(binding)
  })

  it("recovers publication adoption after a crash between the branch update and index update", async () => {
    await prepare()
    await fs.writeFile(path.join(source, "other.txt"), "published\n")
    await git(source, "add", "."); await git(source, "commit", "-m", "published")
    const published = await git(source, "rev-parse", "HEAD")
    await git(source, "push", remote, `HEAD:refs/heads/${authority.session.sessionBranch}`)
    authority.session.baseCommitSha = published; authority.session.publishedCommitSha = published
    const originalGit = deps.git
    let interrupted = false
    deps.git = async (args, options) => {
      if (!interrupted && args.includes("read-tree") && !options.env?.GIT_INDEX_FILE) { interrupted = true; return { success: false, stdout: "", stderr: "simulated crash" } }
      return originalGit(args, options)
    }
    await expect(coordinator.adoptPublished("test-session", "device-token", [])).rejects.toThrow("Git operation")
    expect(await git(target, "rev-parse", "HEAD")).toBe(published)
    await fs.writeFile(path.join(target, "other.txt"), "written during restart\n")
    coordinator = new SessionWorkspaceCoordinator(deps)
    await coordinator.adoptPublished("test-session", "device-token", [])
    expect(await git(target, "show", ":other.txt")).toBe("published")
    expect(await fs.readFile(path.join(target, "other.txt"), "utf8")).toBe("written during restart\n")
  })

  it("refuses to adopt an unverified or independently advanced local branch", async () => {
    await prepare()
    await fs.writeFile(path.join(target, "other.txt"), "local commit\n")
    await git(target, "add", "."); await git(target, "commit", "-m", "private local commit")
    const local = await git(target, "rev-parse", "HEAD")
    authority.session.baseCommitSha = local
    await expect(coordinator.adoptPublished("test-session", "device-token", [])).rejects.toThrow("verified publication")
    authority.session.publishedCommitSha = local
    await expect(coordinator.adoptPublished("test-session", "device-token", [])).rejects.toThrow("advanced outside")
    expect(await git(target, "rev-parse", "HEAD")).toBe(local)
  })
  it("isolates a dirty source, serializes simultaneous joins and resumes without resetting edits", async () => {
    await fs.writeFile(path.join(source, "shared.txt"), "private source\n")
    const [first, second] = await Promise.all([prepare(), prepare()])
    expect(first.workspaceId).toBe(second.workspaceId)
    expect(active).toBe("session")
    expect(await fs.readFile(path.join(target, "shared.txt"), "utf8")).toBe("base\n")
    expect(await fs.readFile(path.join(source, "shared.txt"), "utf8")).toBe("private source\n")
    await fs.writeFile(path.join(target, "shared.txt"), "unpublished\n")
    await coordinator.leave("test-session")
    expect(active).toBe("source")
    coordinator = new SessionWorkspaceCoordinator(deps)
    await prepare()
    expect(await fs.readFile(path.join(target, "shared.txt"), "utf8")).toBe("unpublished\n")
    expect(JSON.stringify([...state])).not.toContain("SECRET_TEST_CREDENTIAL")
    expect(await git(target, "remote", "get-url", "origin")).toBe(github)
  })

  it("recovers a crash after worktree creation before catalog binding without deleting dirty data", async () => {
    const allocate = deps.allocate
    deps.allocate = async (...args) => {
      await allocate(...args)
      throw new Error("interrupted")
    }
    await expect(prepare()).rejects.toThrow("interrupted")
    await fs.writeFile(path.join(target, "shared.txt"), "written before crash\n")
    deps.allocate = allocate
    coordinator = new SessionWorkspaceCoordinator(deps)
    await prepare()
    expect(await fs.readFile(path.join(target, "shared.txt"), "utf8")).toBe("written before crash\n")
  })

  it("refuses an unrelated reserved directory and mismatched source repo", async () => {
    await fs.mkdir(target)
    await fs.writeFile(path.join(target, "private.txt"), "never delete")
    await expect(prepare()).rejects.toThrow()
    expect(await fs.readFile(path.join(target, "private.txt"), "utf8")).toBe("never delete")
    await git(source, "remote", "set-url", "origin", "https://github.com/cozea/unrelated.git")
    await expect(prepare()).rejects.toThrow("different repository")
  })

  it("rechecks reviewed import bytes and excludes binary files", async () => {
    await fs.writeFile(path.join(source, "shared.txt"), "review me\n")
    await fs.writeFile(path.join(source, "image.bin"), Buffer.from([0, 255, 10]))
    const review = await coordinator.inspectImportableChanges("source")
    expect(review.map(file => file.path)).toEqual(["shared.txt"])
    await prepare()
    expect(await coordinator.readReviewedImport("test-session", review, "token")).toEqual(review)
    await fs.writeFile(path.join(source, "shared.txt"), "changed after review\n")
    await expect(coordinator.readReviewedImport("test-session", review, "token")).rejects.toThrow("after review")
    authority.userId = "joining-user"
    await expect(coordinator.readReviewedImport("test-session", review, "token")).rejects.toThrow("only while starting")
  })
})

describe("exact shared Git snapshot", () => {
  it("pushes only the prepared object and recovers an accepted push with a lost response", async () => {
    await prepare(); lease()
    const prepared = await coordinator.prepareCommit(commitInput())
    authority.session.status = "pushing"
    authority.session.pendingCommitSha = prepared.commitSha
    authority.session.pendingCommitThroughSequence = prepared.throughSequence
    await fs.writeFile(path.join(target, "shared.txt"), "newer edit remains local\n")
    const base = authority.session.baseCommitSha
    deps.verifyPush = async (_sessionId, sha) => {
      if (await git(remote, "rev-parse", `refs/heads/${authority.session.sessionBranch}`) !== sha) throw new Error("not published")
    }
    const run = deps.git
    let pushes = 0
    deps.git = async (args, options) => {
      const result = await run(args, options)
      if (args.includes("push")) {
        pushes++
        expect(args).not.toContain("--force")
        expect(args.at(-1)).toBe(`${prepared.commitSha}:refs/heads/${authority.session.sessionBranch}`)
        return { success: false, stdout: "", stderr: "connection lost after remote acceptance" }
      }
      return result
    }
    expect((await coordinator.pushPrepared("test-session", "token")).state).toBe("published")
    expect(await git(remote, "show", `${prepared.commitSha}:shared.txt`)).toBe("barrier")
    expect(await git(remote, "rev-parse", "refs/heads/main")).toBe(base)
    expect(await fs.readFile(path.join(target, "shared.txt"), "utf8")).toBe("newer edit remains local\n")
    coordinator = new SessionWorkspaceCoordinator(deps)
    expect((await coordinator.pushPrepared("test-session", "token")).commitSha).toBe(prepared.commitSha)
    expect(pushes).toBe(1)
  })

  it("rejects expired publication leases and non-fast-forward session branches", async () => {
    await prepare(); lease()
    const prepared = await coordinator.prepareCommit(commitInput())
    authority.session.status = "pushing"
    authority.session.pendingCommitSha = prepared.commitSha
    authority.session.pendingCommitThroughSequence = prepared.throughSequence
    deps.verifyPush = async () => { throw new Error("not published") }
    authority.session.commitLeaseExpiresAt = now
    await expect(coordinator.pushPrepared("test-session", "token")).rejects.toThrow("current lease")
    authority.session.commitLeaseExpiresAt = now + 30_000
    await fs.writeFile(path.join(source, "other.txt"), "independent commit\n")
    await git(source, "add", "other.txt"); await git(source, "commit", "-m", "independent")
    const other = await git(source, "rev-parse", "HEAD")
    await git(source, "push", remote, `HEAD:refs/heads/${authority.session.sessionBranch}`)
    await expect(coordinator.pushPrepared("test-session", "token")).rejects.toThrow("not published")
    expect(await git(remote, "rev-parse", `refs/heads/${authority.session.sessionBranch}`)).toBe(other)
    expect(await git(target, "rev-parse", "refs/cozea/prepared/test-session")).toBe(prepared.commitSha)
  })

  it("commits the barrier in a separate index, preserves evolving files, and includes only selected binaries", async () => {
    await prepare()
    lease()
    await fs.writeFile(path.join(target, "shared.txt"), "newer optimistic edit\n")
    await fs.writeFile(path.join(target, "selected.bin"), Buffer.from([0, 255, 4]))
    await fs.writeFile(path.join(target, "private.bin"), Buffer.from([0, 3, 8]))
    const indexBefore = await git(target, "write-tree")
    const input = commitInput()
    input.binaryPaths = ["selected.bin"]
    input.binaryReviews = (await coordinator.inspectBinaryCandidates("test-session")).filter(file => file.path === "selected.bin")
    const prepared = await coordinator.prepareCommit(input)
    expect(await git(target, "show", `${prepared.commitSha}:shared.txt`)).toBe("barrier")
    expect(await git(target, "ls-tree", "--name-only", prepared.commitSha)).toBe("other.txt\nselected.bin\nshared.txt")
    expect(await fs.readFile(path.join(target, "shared.txt"), "utf8")).toBe("newer optimistic edit\n")
    expect(await git(target, "write-tree")).toBe(indexBefore)
    expect(await git(target, "rev-parse", "HEAD")).toBe(authority.session.baseCommitSha)
    expect(await git(target, "rev-parse", "refs/cozea/prepared/test-session")).toBe(prepared.commitSha)
    expect(JSON.stringify([...state])).not.toContain("SECRET_TEST_CREDENTIAL")
  })

  it("does not allow observers, expired leases, gaps or colliding paths to prepare a commit", async () => {
    await prepare()
    lease()
    authority.role = "observer"
    await expect(coordinator.prepareCommit(commitInput())).rejects.toThrow("Observers")
    authority.role = "editor"
    authority.session.commitLeaseExpiresAt = now
    await expect(coordinator.prepareCommit(commitInput())).rejects.toThrow("active lease")
    lease()
    await expect(coordinator.prepareCommit({ ...commitInput(), throughSequence: 11 })).rejects.toThrow("barrier")
    await expect(coordinator.prepareCommit({ ...commitInput(), binaryPaths: ["SHARED.txt"] })).rejects.toThrow("colliding")
    await expect(coordinator.prepareCommit({ ...commitInput(), binaryPaths: ["../source/shared.txt"] })).rejects.toThrow("Invalid")
  })

  it("rejects symlink escapes when reviewing local changes", async () => {
    await fs.symlink(path.join(root, "remote.git"), path.join(source, "escape"))
    await expect(coordinator.inspectImportableChanges("source")).rejects.toThrow("regular workspace files")
  })
})


describe("immutable collaboration commit review", () => {
  it("reviews the prepared object after working files and the real index change", async () => {
    await prepare(); lease()
    const name = "image, final.bin"
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 1]))
    const candidates = await coordinator.inspectBinaryCandidates("test-session")
    expect(candidates.map(file => file.path)).toEqual([name])
    const input = { ...commitInput(), binaryPaths: [name], binaryReviews: candidates }
    const prepared = await coordinator.prepareCommit(input)
    await fs.writeFile(path.join(target, "shared.txt"), "newer working text\n")
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 2]))
    await git(target, "add", "shared.txt")
    const indexBefore = await git(target, "write-tree")
    const review = await coordinator.reviewPrepared("test-session", prepared.commitSha)
    expect(review.commitSha).toBe(prepared.commitSha)
    expect(review.parentCommitSha).toBe(prepared.parentCommitSha)
    expect(review.throughSequence).toBe(5)
    expect(review.patch).toContain("+barrier")
    expect(review.patch).not.toContain("newer working text")
    expect(review.files.find(file => file.path === name)?.binary).toBe(true)
    expect(await git(target, "write-tree")).toBe(indexBefore)
    expect(await fs.readFile(path.join(target, name))).toEqual(Buffer.from([0, 255, 2]))
  })

  it("rejects bytes or executable bits changed since binary selection", async () => {
    await prepare(); lease()
    const name = "selected.bin"
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 1]))
    await fs.chmod(path.join(target, name), 0o644)
    const reviewed = await coordinator.inspectBinaryCandidates("test-session")
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 2]))
    await expect(coordinator.prepareCommit({ ...commitInput(), binaryPaths: [name], binaryReviews: reviewed })).rejects.toThrow("review")
    await fs.writeFile(path.join(target, name), Buffer.from([0, 255, 1]))
    await fs.chmod(path.join(target, name), 0o755)
    await expect(coordinator.prepareCommit({ ...commitInput(), binaryPaths: [name], binaryReviews: reviewed })).rejects.toThrow("review")
    expect(await coordinator.getPrepared("test-session")).toBeNull()
    expect((await fs.stat(path.join(target, name))).mode & 0o111).not.toBe(0)
  })

  it("does not let a binary selection bypass the acknowledged text barrier", async () => {
    await prepare(); lease()
    const buffer = Buffer.from("unacknowledged publisher-only text\n")
    await fs.writeFile(path.join(target, "unshared.txt"), buffer)
    const input = { ...commitInput(), binaryPaths: ["unshared.txt"], binaryReviews: [{ path: "unshared.txt", reviewHash: binaryReviewHash(buffer, false) }] }
    await expect(coordinator.prepareCommit(input)).rejects.toThrow("Git-only")
    expect(await coordinator.getPrepared("test-session")).toBeNull()
  })

  it("requires the exact prepared identity and never reviews discarded state", async () => {
    await prepare(); lease()
    const prepared = await coordinator.prepareCommit(commitInput())
    await expect(coordinator.reviewPrepared("test-session", "f".repeat(40))).rejects.toThrow("changed")
    await coordinator.discardPrepared("test-session", "token")
    await expect(coordinator.reviewPrepared("test-session", prepared.commitSha)).rejects.toThrow("changed")
  })
})
