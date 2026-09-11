import { randomBytes } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { afterAll, beforeAll, describe, expect, it } from "vitest"

import { asBranchName } from "@shared/collaboration"
import { BarrierCapture } from "../../apps/projectd/src/autogit/BarrierCapture"
import { CheckpointBuilder } from "../../apps/projectd/src/autogit/CheckpointBuilder"
import { MergeCoordinator } from "../../apps/projectd/src/autogit/MergeCoordinator"
import { BaselineStore } from "../../apps/projectd/src/collaboration/BaselineStore"
import { ExternalSnapshotAdapter } from "../../apps/projectd/src/collaboration/ExternalSnapshotAdapter"
import { InvalidProjectPathError, normalizeProjectPath } from "../../apps/projectd/src/collaboration/projectPath"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { SessionTransport } from "../../apps/projectd/src/collaboration/SessionTransport"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"
import { MaterializationIndex } from "../../apps/projectd/src/filesystem/MaterializationIndex"
import { FilesystemMaterializer } from "../../apps/projectd/src/filesystem/Materializer"
import { GitService } from "../../apps/projectd/src/git/GitService"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

/**
 * Regression tests for the defects the 2026-09-11 collaboration audit reproduced
 * against d95098a8 (V1-V8). Each case failed there.
 */

const actor: ChangeActor = { actorType: "user", principalId: "u_regression" }
const external: ChangeActor = { actorType: "external" }
const GIT_IDENTITY_ENV = ["GIT_AUTHOR_NAME", "GIT_AUTHOR_EMAIL", "GIT_COMMITTER_NAME", "GIT_COMMITTER_EMAIL"] as const

let workRoot: string
const openDatabases: ProjectdDatabase[] = []
const previousGitIdentity = new Map<string, string | undefined>()

beforeAll(() => {
  workRoot = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-audit-regressions-"))
  // Commits here must not depend on the machine's Git identity.
  for (const name of GIT_IDENTITY_ENV) {
    previousGitIdentity.set(name, process.env[name])
    process.env[name] = name.endsWith("EMAIL") ? "tests@cozea.invalid" : "Cozea Tests"
  }
})

afterAll(() => {
  for (const db of openDatabases) db.close()
  fs.rmSync(workRoot, { recursive: true, force: true })
  for (const [name, value] of previousGitIdentity) {
    if (value === undefined) delete process.env[name]
    else process.env[name] = value
  }
})

function workDir(name: string): string {
  const dir = path.join(workRoot, name)
  fs.mkdirSync(dir, { recursive: true })
  return dir
}

function materializerFor(workspaceRoot: string, replica: SessionReplica, baselineStore = new BaselineStore()) {
  const db = new ProjectdDatabase(":memory:")
  openDatabases.push(db)
  return new FilesystemMaterializer({
    workspaceRoot,
    sessionId: replica.sessionId,
    replica,
    index: new MaterializationIndex(db),
    baselineStore,
  })
}

async function commitAll(git: GitService, repo: string, message: string): Promise<string> {
  await git.process.execute(["add", "-A"], { cwd: repo })
  return await git.createCommit(repo, message)
}

async function revParse(git: GitService, repo: string, ref: string): Promise<string> {
  return (await git.process.execute(["rev-parse", ref], { cwd: repo })).stdout.trim()
}

describe("V1 SessionReplica export watermark", () => {
  it("exports local edits that were pending when a peer batch was applied", () => {
    const a = new SessionReplica("s_v1", "A")
    const b = new SessionReplica("s_v1", "B")
    const file = a.createFile({ path: "x.txt", kind: "text", content: "hello", actor })
    b.applyBatch(a.exportBatch())

    a.textDocs.getOrCreate(file.fileId).text.insert(5, " world")
    b.textDocs.getOrCreate(file.fileId).text.insert(0, ">> ")
    a.applyBatch(b.exportBatch())
    b.applyBatch(a.exportBatch())

    expect(a.textDocs.getTextContent(file.fileId)).toBe(">> hello world")
    expect(b.textDocs.getTextContent(file.fileId)).toBe(">> hello world")
  })

  it("does not send a peer's changes back out", () => {
    const a = new SessionReplica("s_v1b", "A")
    const b = new SessionReplica("s_v1b", "B")
    a.createFile({ path: "x.txt", kind: "text", content: "hello", actor })
    b.applyBatch(a.exportBatch())

    expect(b.exportBatch()).toBeNull()
  })
})

describe("V2 materializer baseline", () => {
  it("merges an external save with a peer edit that landed after the materializer wrote the file", async () => {
    const workspace = workDir("v2")
    const baselines = new BaselineStore()
    const local = new SessionReplica("s_v2", "local")
    const peer = new SessionReplica("s_v2", "peer")
    const file = local.createFile({ path: "a.txt", kind: "text", content: "hello world", actor })
    peer.applyBatch(local.exportBatch())

    await materializerFor(workspace, local, baselines).materializeFile(file.fileId, Date.now())
    peer.textDocs.getOrCreate(file.fileId).text.insert(6, "amazing ")
    local.applyBatch(peer.exportBatch())

    new ExternalSnapshotAdapter({ replica: local, baselineStore: baselines }).applyExternalDiskChange({
      fileId: file.fileId,
      diskText: "hello world!",
      actor: external,
    })

    expect(local.textDocs.getTextContent(file.fileId)).toBe("hello amazing world!")
  })
})

describe("V3 checkpoint tree", () => {
  it("drops files deleted or renamed in the CRDT", async () => {
    const repo = workDir("v3")
    const git = new GitService()
    await git.initRepo(repo, "main")
    for (const [name, content] of [["keep.txt", "k\n"], ["gone.txt", "g\n"], ["old-name.txt", "o\n"]]) {
      fs.writeFileSync(path.join(repo, name), content)
    }
    const parentOid = await commitAll(git, repo, "base")

    const replica = new SessionReplica("s_v3", "A")
    replica.createFile({ path: "keep.txt", kind: "text", content: "k\n", actor })
    const gone = replica.createFile({ path: "gone.txt", kind: "text", content: "g\n", actor })
    const renamed = replica.createFile({ path: "old-name.txt", kind: "text", content: "o\n", actor })
    replica.deleteFile(gone.fileId, actor)
    replica.renameFile(renamed.fileId, "new-name.txt", actor)

    const snapshot = BarrierCapture.captureSnapshot(
      { barrierId: "b_v3", sessionSeq: 1, serverTime: 1726000000000 },
      replica,
    )
    const checkpoint = await new CheckpointBuilder(git).buildCheckpointCommit({
      repoPath: repo,
      sessionId: "s_v3",
      parentOid,
      leaseGeneration: 1,
      snapshot,
    })

    const listing = await git.process.execute(["ls-tree", "-r", "--name-only", checkpoint.commitOid], { cwd: repo })
    expect(listing.stdout.trim().split("\n").sort()).toEqual(["keep.txt", "new-name.txt"])
  })

  it("fails instead of dropping a binary file it has no Git blob for", async () => {
    const repo = workDir("v3b")
    const git = new GitService()
    await git.initRepo(repo, "main")

    const replica = new SessionReplica("s_v3b", "A")
    replica.createFile({ path: "logo.png", kind: "binary", actor })
    const snapshot = BarrierCapture.captureSnapshot(
      { barrierId: "b_v3b", sessionSeq: 1, serverTime: 1726000000000 },
      replica,
    )

    await expect(
      new CheckpointBuilder(git).buildCheckpointCommit({
        repoPath: repo,
        sessionId: "s_v3b",
        parentOid: null,
        leaseGeneration: 1,
        snapshot,
      }),
    ).rejects.toThrow(/no Git blob for binary logo\.png/)
  })
})

describe("V4 tree paths stay inside the workspace", () => {
  it("rejects paths that escape the project or name Git metadata", () => {
    for (const bad of ["../outside.txt", "a/../../b", "/etc/passwd", "C:/x", ".git/config", "src/.GIT/hooks", "", "a\0b"]) {
      expect(() => normalizeProjectPath(bad), bad).toThrow(InvalidProjectPathError)
    }
    expect(normalizeProjectPath("./src//a/./b.ts/")).toBe("src/a/b.ts")

    const replica = new SessionReplica("s_v4", "A")
    expect(() => replica.createFile({ path: "../outside.txt", kind: "text", content: "x", actor })).toThrow(
      InvalidProjectPathError,
    )
  })

  it("refuses a peer's escaping path even when it bypasses path normalization", async () => {
    const base = workDir("v4")
    const workspace = path.join(base, "workspace")
    fs.mkdirSync(workspace)
    const replica = new SessionReplica("s_v4b", "A")
    const file = replica.createFile({ path: "inside.txt", kind: "text", content: "peer bytes", actor })
    // Peers write the Yjs tree directly, so model a hostile entry that never went through createEntry.
    replica.tree.entries.set(file.fileId, { ...replica.tree.getEntry(file.fileId)!, path: "../outside.txt" })

    await materializerFor(workspace, replica).materializeFile(file.fileId, Date.now())

    expect(fs.existsSync(path.join(base, "outside.txt"))).toBe(false)
  })

  it("refuses to write through a symlinked directory", async () => {
    const base = workDir("v4c")
    const workspace = path.join(base, "workspace")
    const outside = path.join(base, "outside")
    fs.mkdirSync(workspace)
    fs.mkdirSync(outside)
    fs.symlinkSync(outside, path.join(workspace, "linked"))
    const replica = new SessionReplica("s_v4c", "A")
    const file = replica.createFile({ path: "linked/payload.txt", kind: "text", content: "peer bytes", actor })

    await materializerFor(workspace, replica).materializeFile(file.fileId, Date.now())

    expect(fs.existsSync(path.join(outside, "payload.txt"))).toBe(false)
  })
})

describe("V5 renames and deletes on disk", () => {
  it("removes the old path after materializing a rename", async () => {
    const workspace = workDir("v5")
    const replica = new SessionReplica("s_v5", "A")
    const materializer = materializerFor(workspace, replica)
    const file = replica.createFile({ path: "a.txt", kind: "text", content: "x", actor })
    await materializer.materializeFile(file.fileId, Date.now())

    replica.renameFile(file.fileId, "nested/b.txt", actor)
    await materializer.materializeFile(file.fileId, Date.now())

    expect(fs.existsSync(path.join(workspace, "a.txt"))).toBe(false)
    expect(fs.readFileSync(path.join(workspace, "nested/b.txt"), "utf8")).toBe("x")
  })

  it("keeps the old path when it changed locally after the last sync", async () => {
    const workspace = workDir("v5b")
    const replica = new SessionReplica("s_v5b", "A")
    const materializer = materializerFor(workspace, replica)
    const file = replica.createFile({ path: "a.txt", kind: "text", content: "x", actor })
    await materializer.materializeFile(file.fileId, Date.now())
    fs.writeFileSync(path.join(workspace, "a.txt"), "local edit")

    replica.renameFile(file.fileId, "b.txt", actor)
    await materializer.materializeFile(file.fileId, Date.now())

    expect(fs.readFileSync(path.join(workspace, "a.txt"), "utf8")).toBe("local edit")
    expect(fs.readFileSync(path.join(workspace, "b.txt"), "utf8")).toBe("x")
  })

  it("keeps a deleted file that changed locally after the last sync", async () => {
    const workspace = workDir("v5c")
    const replica = new SessionReplica("s_v5c", "A")
    const materializer = materializerFor(workspace, replica)
    const file = replica.createFile({ path: "a.txt", kind: "text", content: "x", actor })
    await materializer.materializeFile(file.fileId, Date.now())
    fs.writeFileSync(path.join(workspace, "a.txt"), "local edit")

    replica.deleteFile(file.fileId, actor)
    await materializer.materializeFile(file.fileId, Date.now())

    expect(fs.readFileSync(path.join(workspace, "a.txt"), "utf8")).toBe("local edit")
  })
})

describe("V6 delete/modify conflicts", () => {
  it("does not report a plain delete as a conflict", () => {
    const replica = new SessionReplica("s_v6", "A")
    const file = replica.createFile({ path: "x.txt", kind: "text", content: "not empty", actor })
    replica.deleteFile(file.fileId, actor)

    expect(replica.detectConflicts().deleteModifyConflicts).toEqual([])
  })

  it("reports an edit the delete had not seen", () => {
    const a = new SessionReplica("s_v6b", "A")
    const b = new SessionReplica("s_v6b", "B")
    const file = a.createFile({ path: "x.txt", kind: "text", content: "base", actor })
    b.applyBatch(a.exportBatch())

    a.deleteFile(file.fileId, actor)
    b.textDocs.getOrCreate(file.fileId).text.insert(4, " edited")
    const fromA = a.exportBatch()
    const fromB = b.exportBatch()
    a.applyBatch(fromB)
    b.applyBatch(fromA)

    expect(a.detectConflicts().deleteModifyConflicts.map((c) => c.fileId)).toEqual([file.fileId])
    expect(b.detectConflicts().deleteModifyConflicts.map((c) => c.fileId)).toEqual([file.fileId])
  })
})

describe("V7 session transport", () => {
  it("requires the session's 32-byte room key", () => {
    const replica = new SessionReplica("s_v7", "A")
    expect(() => new SessionTransport({ sessionId: "s_v7", replica } as never)).toThrow(/room key/)
    expect(() => new SessionTransport({ sessionId: "s_v7", replica, roomKey: Buffer.alloc(16) })).toThrow(/32 bytes/)
  })

  it("binds each ciphertext to its session", () => {
    const key = randomBytes(32)
    const replica = new SessionReplica("sess-A", "A")
    const sender = new SessionTransport({ sessionId: "sess-A", replica, roomKey: key })
    const otherSession = new SessionTransport({
      sessionId: "sess-B",
      replica: new SessionReplica("sess-B", "B"),
      roomKey: key,
    })
    replica.createFile({ path: "secret.env", kind: "text", content: "API_KEY=example", actor })

    const encrypted = sender.encryptBatch(replica.exportBatch()!)

    expect(() => otherSession.decryptBatch(encrypted)).toThrow()
  })

  it("applies batches that arrive out of order and skips exact duplicates", () => {
    const key = randomBytes(32)
    const source = new SessionReplica("sess-C", "S")
    const target = new SessionReplica("sess-C", "D")
    const sender = new SessionTransport({ sessionId: "sess-C", replica: source, roomKey: key })
    const receiver = new SessionTransport({ sessionId: "sess-C", replica: target, roomKey: key })
    const file = source.createFile({ path: "o.txt", kind: "text", content: "one", actor })
    const first = sender.encryptBatch(source.exportBatch()!)
    source.textDocs.getOrCreate(file.fileId).text.insert(3, " two")
    const second = sender.encryptBatch(source.exportBatch()!)

    expect(receiver.receiveEncryptedBatch(2, second)).toBe(true)
    expect(receiver.lastAppliedSessionSeq).toBe(0)
    expect(receiver.receiveEncryptedBatch(1, first)).toBe(true)
    expect(receiver.receiveEncryptedBatch(2, second)).toBe(false)

    expect(receiver.lastAppliedSessionSeq).toBe(2)
    expect(target.textDocs.getTextContent(file.fileId)).toBe("one two")
  })
})

describe("V8 merge preview and execution", () => {
  async function divergedRepo(name: string) {
    const repo = workDir(name)
    const git = new GitService()
    await git.initRepo(repo, "main")
    fs.writeFileSync(path.join(repo, "x.txt"), "base\n")
    await commitAll(git, repo, "base")
    await git.createBranch(repo, "feature/release", "main")
    return { repo, git }
  }

  it("lists modify/delete conflicts, not only content conflicts", async () => {
    const { repo, git } = await divergedRepo("v8")
    await git.checkoutBranch(repo, "feature/release")
    fs.rmSync(path.join(repo, "x.txt"))
    await commitAll(git, repo, "delete on feature")
    await git.checkoutBranch(repo, "main")
    fs.writeFileSync(path.join(repo, "x.txt"), "changed on main\n")
    await commitAll(git, repo, "modify on main")

    const preview = await new MergeCoordinator(git).computeMergePreview({
      repoPath: repo,
      sessionBranch: asBranchName("feature/release"),
      targetBranch: asBranchName("main"),
    })

    expect(preview.canMergeCleanly).toBe(false)
    expect(preview.conflictingFiles).toEqual(["x.txt"])
  })

  it("refuses to merge when the session branch moved after review", async () => {
    const { repo, git } = await divergedRepo("v8b")
    await git.checkoutBranch(repo, "feature/release")
    fs.writeFileSync(path.join(repo, "feature.txt"), "reviewed\n")
    await commitAll(git, repo, "reviewed work")
    const coordinator = new MergeCoordinator(git)
    const reviewed = await coordinator.computeMergePreview({
      repoPath: repo,
      sessionBranch: asBranchName("feature/release"),
      targetBranch: asBranchName("main"),
    })
    fs.writeFileSync(path.join(repo, "feature.txt"), "unreviewed\n")
    await commitAll(git, repo, "unreviewed work")

    const result = await coordinator.executeDirectMerge({
      repoPath: repo,
      sessionBranch: asBranchName("feature/release"),
      targetBranch: asBranchName("main"),
      reviewedCheckpointOid: reviewed.sessionCheckpointOid,
    })

    expect(result.success).toBe(false)
    expect(result.error).toMatch(/moved since it was reviewed/)
  })

  it("advances a target branch that is not checked out without touching the working tree", async () => {
    const { repo, git } = await divergedRepo("v8c")
    await git.checkoutBranch(repo, "feature/release")
    fs.writeFileSync(path.join(repo, "feature.txt"), "feature\n")
    await commitAll(git, repo, "feature work")

    const result = await new MergeCoordinator(git).executeDirectMerge({
      repoPath: repo,
      sessionBranch: asBranchName("feature/release"),
      targetBranch: asBranchName("main"),
    })

    expect(result.success).toBe(true)
    expect(await revParse(git, repo, "main")).toBe(result.mergeCommitOid)
    expect((await git.getStatus(repo)).clean).toBe(true)
  })
})
