import { createHash } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { CheckpointBuilder } from "../../apps/projectd/src/autogit/CheckpointBuilder"
import { GitLfsUnavailableError, UnsupportedGitFilterError } from "../../apps/projectd/src/autogit/CheckpointFilterPolicy"
import type { BarrierSnapshot } from "../../apps/projectd/src/autogit/BarrierCapture"
import type { BinaryRevision } from "../../apps/projectd/src/collaboration/BinaryStore"
import { GitLfs, type GitLfsCleaner } from "../../apps/projectd/src/git/GitLfs"
import { GitService } from "../../apps/projectd/src/git/GitService"

async function run(git: GitService, cwd: string, args: string[], stdin?: string | Buffer): Promise<string> {
  return (await git.process.execute(args, { cwd, stdin })).stdout.trim()
}

async function initRepo(): Promise<{ root: string; git: GitService }> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-autogit-filter-"))
  const git = new GitService()
  await run(git, root, ["init", "-b", "main"])
  await run(git, root, ["config", "user.name", "Cozea Test"])
  await run(git, root, ["config", "user.email", "test@cozea.local"])
  return { root, git }
}

async function commitAll(git: GitService, root: string, message: string): Promise<string> {
  await run(git, root, ["add", "-A"])
  await run(git, root, ["commit", "-m", message])
  return run(git, root, ["rev-parse", "HEAD"])
}

function binaryRevision(fileId: string, bytes: Buffer, revisionId = "rev-asset"): BinaryRevision {
  return {
    revisionId,
    fileId,
    baseRevisionId: null,
    contentHash: createHash("sha256").update(bytes).digest("hex"),
    encryptedManifestRef: "fixture",
    size: bytes.length,
    actor: { actorType: "user", principalId: "principal" },
    createdAt: 1,
  }
}

function snapshot(files: BarrierSnapshot["files"], hash = "a".repeat(64)): BarrierSnapshot {
  return {
    barrierId: "bar_filter",
    sessionId: "czs_0123456789abcdef",
    sessionSeq: 12,
    serverTime: 1_760_000_000_000,
    logicalTreeHash: hash,
    files,
    deletedPaths: [],
  }
}

class FakeLfs implements GitLfsCleaner {
  availabilityChecks = 0
  cleanCalls: Array<{ cwd: string; filePath: string; bytes: Buffer }> = []

  constructor(private readonly available: boolean, private readonly failClean = false) {}

  async isAvailable(): Promise<boolean> {
    this.availabilityChecks++
    return this.available
  }

  async cleanToPointer(cwd: string, filePath: string, contents: Buffer): Promise<Buffer> {
    this.cleanCalls.push({ cwd, filePath, bytes: Buffer.from(contents) })
    if (this.failClean) throw new Error("fixture clean failure")
    const hash = createHash("sha256").update(contents).digest("hex")
    return Buffer.from(GitLfs.createPointer(hash, contents.length), "utf8")
  }
}

describe("AutoGit checkpoint filter policy", () => {
  const roots: string[] = []

  afterEach(async () => {
    await Promise.all(roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true })))
  })

  it("refuses a changed custom-filter path without executing its clean command", async () => {
    const { root, git } = await initRepo()
    roots.push(root)
    await run(git, root, ["config", "filter.demo.clean", "cat"])
    await fs.writeFile(path.join(root, ".gitattributes"), "tracked.txt filter=demo\n")
    await fs.writeFile(path.join(root, "tracked.txt"), "parent\n")
    const parentOid = await commitAll(git, root, "parent")

    // If AutoGit accidentally delegates this path to `hash-object --path`, Git will
    // launch this command. The safe checkpoint policy must reject the driver first.
    await run(git, root, ["config", "filter.demo.clean", "sh -c 'touch \"$PWD/filter-ran\"; cat'"])
    const builder = new CheckpointBuilder(git)
    await expect(builder.buildCheckpointCommit({
      repoPath: root,
      sessionId: "czs_0123456789abcdef",
      parentOid,
      leaseGeneration: 3,
      snapshot: snapshot([{
        fileId: "file-tracked",
        path: "tracked.txt",
        kind: "text",
        mode: 0o100644,
        contentHash: createHash("sha256").update("changed\n").digest("hex"),
        textContent: "changed\n",
      }]),
    })).rejects.toBeInstanceOf(UnsupportedGitFilterError)
    await expect(fs.stat(path.join(root, "filter-ran"))).rejects.toMatchObject({ code: "ENOENT" })
  })

  it("uses barrier .gitattributes immediately and stores an LFS pointer instead of payload bytes", async () => {
    const { root, git } = await initRepo()
    roots.push(root)
    await fs.writeFile(path.join(root, "README.md"), "parent\n")
    const parentOid = await commitAll(git, root, "parent")
    const bytes = Buffer.from("large-ish binary fixture\0payload")
    const revision = binaryRevision("file-asset", bytes)
    const fakeLfs = new FakeLfs(true)
    const builder = new CheckpointBuilder(git, {
      lfs: fakeLfs,
      resolveBinary: async (requested) => requested.revisionId === revision.revisionId ? bytes : Buffer.alloc(0),
    })

    const result = await builder.buildCheckpointCommit({
      repoPath: root,
      sessionId: "czs_0123456789abcdef",
      parentOid,
      leaseGeneration: 4,
      snapshot: snapshot([
        {
          fileId: "attrs",
          path: ".gitattributes",
          kind: "text",
          mode: 0o100644,
          contentHash: createHash("sha256").update("asset.bin filter=lfs -text\n").digest("hex"),
          textContent: "asset.bin filter=lfs -text\n",
        },
        {
          fileId: "file-asset",
          path: "asset.bin",
          kind: "binary",
          mode: 0o100644,
          contentHash: revision.contentHash,
          binaryRevision: revision,
        },
      ], "b".repeat(64)),
    })

    expect(fakeLfs.availabilityChecks).toBe(1)
    expect(fakeLfs.cleanCalls).toHaveLength(1)
    expect(fakeLfs.cleanCalls[0]).toMatchObject({ cwd: root, filePath: "asset.bin" })
    expect(fakeLfs.cleanCalls[0]!.bytes.equals(bytes)).toBe(true)
    const stored = (await git.process.execute(["show", `${result.commitOid}:asset.bin`], { cwd: root })).stdoutBuffer
    const pointer = GitLfs.parsePointer(stored)
    expect(pointer).toEqual({ oid: `sha256:${revision.contentHash}`, size: bytes.length })
    expect(stored.equals(bytes)).toBe(false)
    expect(await run(git, root, ["show", `${result.commitOid}:.gitattributes`])).toBe("asset.bin filter=lfs -text")
  })

  it("preserves an existing LFS pointer without requiring git-lfs or materializing the object", async () => {
    const { root, git } = await initRepo()
    roots.push(root)
    await fs.writeFile(path.join(root, "README.md"), "parent\n")
    const parentOid = await commitAll(git, root, "parent")
    const objectHash = "c".repeat(64)
    const pointerBytes = Buffer.from(GitLfs.createPointer(objectHash, 9_999_999), "utf8")
    const revision = binaryRevision("file-pointer", pointerBytes, "rev-pointer")
    const fakeLfs = new FakeLfs(false)
    const builder = new CheckpointBuilder(git, { lfs: fakeLfs, resolveBinary: async () => pointerBytes })

    const result = await builder.buildCheckpointCommit({
      repoPath: root,
      sessionId: "czs_0123456789abcdef",
      parentOid,
      leaseGeneration: 5,
      snapshot: snapshot([
        {
          fileId: "attrs",
          path: ".gitattributes",
          kind: "text",
          mode: 0o100644,
          contentHash: createHash("sha256").update("asset.bin filter=lfs -text\n").digest("hex"),
          textContent: "asset.bin filter=lfs -text\n",
        },
        {
          fileId: "file-pointer",
          path: "asset.bin",
          kind: "binary",
          mode: 0o100644,
          contentHash: revision.contentHash,
          binaryRevision: revision,
        },
      ], "c".repeat(64)),
    })

    expect(fakeLfs.availabilityChecks).toBe(0)
    expect(fakeLfs.cleanCalls).toHaveLength(0)
    const stored = (await git.process.execute(["show", `${result.commitOid}:asset.bin`], { cwd: root })).stdoutBuffer
    expect(stored.equals(pointerBytes)).toBe(true)
  })

  it("holds a materialized LFS path when git-lfs is unavailable", async () => {
    const { root, git } = await initRepo()
    roots.push(root)
    await fs.writeFile(path.join(root, "README.md"), "parent\n")
    const parentOid = await commitAll(git, root, "parent")
    const bytes = Buffer.from("materialized payload")
    const revision = binaryRevision("file-asset", bytes)
    const fakeLfs = new FakeLfs(false)
    const builder = new CheckpointBuilder(git, { lfs: fakeLfs, resolveBinary: async () => bytes })

    await expect(builder.buildCheckpointCommit({
      repoPath: root,
      sessionId: "czs_0123456789abcdef",
      parentOid,
      leaseGeneration: 6,
      snapshot: snapshot([
        {
          fileId: "attrs",
          path: ".gitattributes",
          kind: "text",
          mode: 0o100644,
          contentHash: createHash("sha256").update("asset.bin filter=lfs -text\n").digest("hex"),
          textContent: "asset.bin filter=lfs -text\n",
        },
        {
          fileId: "file-asset",
          path: "asset.bin",
          kind: "binary",
          mode: 0o100644,
          contentHash: revision.contentHash,
          binaryRevision: revision,
        },
      ], "d".repeat(64)),
    })).rejects.toBeInstanceOf(GitLfsUnavailableError)
    expect(fakeLfs.availabilityChecks).toBe(1)
    expect(fakeLfs.cleanCalls).toHaveLength(0)
  })
})
