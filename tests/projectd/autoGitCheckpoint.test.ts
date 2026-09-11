import { execFileSync } from "node:child_process"
import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GitService } from "../../apps/projectd/src/git/GitService"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { BarrierCapture, type BarrierDescriptor } from "../../apps/projectd/src/autogit/BarrierCapture"
import { CheckpointBuilder } from "../../apps/projectd/src/autogit/CheckpointBuilder"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

/** Commits everything in the folder as a person would, without their hooks or signing. */
function commitAll(dir: string): string {
  const run = (...args: string[]) =>
    execFileSync(
      "git",
      [
        "-c",
        "user.name=Cozea Test",
        "-c",
        "user.email=test@cozea.invalid",
        "-c",
        "commit.gpgsign=false",
        "-c",
        "core.hooksPath=/dev/null",
        ...args,
      ],
      { cwd: dir, encoding: "utf8" },
    ).trim()
  run("add", "-A")
  run("commit", "-q", "-m", "parent")
  return run("rev-parse", "HEAD")
}

describe("P17 AutoGit barriers, deterministic checkpoint commit, periodic push", () => {
  const actor: ChangeActor = { actorType: "user", principalId: "user_p17" }
  const tmpDir = "/tmp"
  let testRepoDir: string
  let gitService: GitService
  let checkpointBuilder: CheckpointBuilder

  const sessionId = "sess_p17_test"

  beforeEach(async () => {
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testRepoDir = path.join(tmpDir, `test_p17_repo_${id}`)
    fs.mkdirSync(testRepoDir, { recursive: true })

    gitService = new GitService()
    await gitService.initRepo(testRepoDir, "main")
    checkpointBuilder = new CheckpointBuilder(gitService)
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

  it("captures immutable barrier snapshot while CRDT edits continue (Section 15.3 - 15.4)", () => {
    const replica = new SessionReplica(sessionId, "leader_client")

    // State at barrier seq 10
    const f1 = replica.createFile({
      path: "src/app.ts",
      kind: "text",
      content: "console.log('version 1');",
      actor,
    })

    const barrier: BarrierDescriptor = {
      barrierId: "bar_10",
      sessionSeq: 10,
      serverTime: 1700000000000,
    }

    const snapshot = BarrierCapture.captureSnapshot(barrier, replica)
    expect(snapshot.sessionSeq).toBe(10)
    expect(snapshot.files).toHaveLength(1)
    expect(snapshot.files[0].path).toBe("src/app.ts")
    expect(snapshot.files[0].textContent).toBe("console.log('version 1');")

    // Edits continue after barrier (seq 11, 12...)
    replica.updateTextContent(f1.fileId, "console.log('version 2 after barrier');")

    // The captured barrier snapshot remains immutable!
    expect(snapshot.files[0].textContent).toBe("console.log('version 1');")
  })

  it("builds deterministic commit reproduced identically across failover (Section 15.7)", async () => {
    const replica = new SessionReplica(sessionId, "leader_1")
    replica.createFile({
      path: "index.js",
      kind: "text",
      content: "const x = 42;\n",
      actor,
    })

    const barrier: BarrierDescriptor = {
      barrierId: "barrier_deterministic_test",
      sessionSeq: 5,
      serverTime: 1726000000000, // Fixed serverTime
    }

    const snapshot = BarrierCapture.captureSnapshot(barrier, replica)

    // Leader 1 creates commit
    const commit1 = await checkpointBuilder.buildCheckpointCommit({
      repoPath: testRepoDir,
      sessionId,
      parentOid: null,
      leaseGeneration: 1,
      snapshot,
    })

    expect(commit1.commitOid).toMatch(/^[a-f0-9]{40}$/)
    expect(commit1.commitMessage).toContain("Cozea-Barrier: barrier_deterministic_test")
    expect(commit1.commitMessage).toContain("Cozea-Seq: 5")

    // Successor Leader 2 reproduces commit from the exact same barrier snapshot & generation
    const commit2 = await checkpointBuilder.buildCheckpointCommit({
      repoPath: testRepoDir,
      sessionId,
      parentOid: null,
      leaseGeneration: 1,
      snapshot,
    })

    // Critical assertion: Exact byte-for-byte deterministic commit OID match!
    expect(commit2.commitOid).toBe(commit1.commitOid)
    expect(commit2.treeOid).toBe(commit1.treeOid)
  })

  it("creates checkpoint commit with symlinks and file modes without mutating working directory", async () => {
    const replica = new SessionReplica(sessionId, "leader_client")
    replica.createFile({
      path: "bin/start.sh",
      kind: "text",
      mode: 0o100755, // +x
      content: "#!/bin/sh\necho 'running'\n",
      actor,
    })

    const symlinkFile = replica.createFile({
      path: "bin/run",
      kind: "symlink",
      actor,
    })
    replica.tree.setSymlinkTarget(symlinkFile.fileId, "start.sh", actor)

    const barrier: BarrierDescriptor = {
      barrierId: "barrier_symlink_test",
      sessionSeq: 8,
      serverTime: 1726000050000,
    }
    const snapshot = BarrierCapture.captureSnapshot(barrier, replica)

    // Build commit in isolated staging
    const result = await checkpointBuilder.buildCheckpointCommit({
      repoPath: testRepoDir,
      sessionId,
      parentOid: null,
      leaseGeneration: 1,
      snapshot,
    })

    expect(result.commitOid).toBeDefined()

    // Verify commit tree contents via ls-tree
    const lsTree = await gitService.process.execute(["ls-tree", "-r", result.treeOid], {
      cwd: testRepoDir,
    })

    // 100755 for start.sh, 120000 for symlink run
    expect(lsTree.stdout).toContain("100755 blob")
    expect(lsTree.stdout).toContain("bin/start.sh")
    expect(lsTree.stdout).toContain("120000 blob")
    expect(lsTree.stdout).toContain("bin/run")

    // Working directory remained completely untouched!
    expect(fs.existsSync(path.join(testRepoDir, "bin"))).toBe(false)
  })

  const listTree = async (treeish: string, cwd = testRepoDir) =>
    (await gitService.process.execute(["ls-tree", "-r", "--name-only", treeish], { cwd })).stdout.trim().split("\n")
  const showFile = async (spec: string, cwd = testRepoDir) =>
    (await gitService.process.execute(["show", spec], { cwd })).stdout

  it("keeps what the session never carries and removes what the session deleted or renamed away", async () => {
    fs.mkdirSync(path.join(testRepoDir, "assets"), { recursive: true })
    fs.writeFileSync(path.join(testRepoDir, "README.md"), "# Demo\n")
    fs.writeFileSync(path.join(testRepoDir, "old.md"), "renamed away\n")
    fs.writeFileSync(path.join(testRepoDir, "gone.md"), "deleted in the session\n")
    fs.writeFileSync(path.join(testRepoDir, "assets/logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    fs.writeFileSync(path.join(testRepoDir, "big.log"), "x".repeat(2048))
    // A filter such as LFS stores bytes other than the folder's; no driver is needed to mark the path.
    fs.writeFileSync(path.join(testRepoDir, ".gitattributes"), "*.psd filter=cozea-test\n")
    fs.writeFileSync(path.join(testRepoDir, "design.psd"), "stored by a filter\n")
    const parentOid = commitAll(testRepoDir)

    const replica = new SessionReplica(sessionId, "leader_client")
    replica.createFile({ path: "README.md", kind: "text", content: "# Demo v2\n", actor })
    replica.createFile({ path: ".gitattributes", kind: "text", content: "*.psd filter=cozea-test\n", actor })
    const moved = replica.createFile({ path: "old.md", kind: "text", content: "renamed away\n", actor })
    replica.renameFile(moved.fileId, "docs/new.md", actor)
    const gone = replica.createFile({ path: "gone.md", kind: "text", content: "deleted in the session\n", actor })
    replica.deleteFile(gone.fileId, actor)
    const snapshot = BarrierCapture.captureSnapshot(
      { barrierId: "barrier_retention_test", sessionSeq: 6, serverTime: 1726000100000 },
      replica,
    )

    const result = await checkpointBuilder.buildCheckpointCommit({
      repoPath: testRepoDir,
      sessionId,
      parentOid,
      leaseGeneration: 1,
      snapshot,
      maxTextFileBytes: 1024,
    })

    expect(result.parentTreeOid).not.toBe(result.treeOid)
    expect(await listTree(result.commitOid)).toEqual([
      ".gitattributes",
      "README.md",
      "assets/logo.png",
      "big.log",
      "design.psd",
      "docs/new.md",
    ])
    expect(await showFile(`${result.commitOid}:README.md`)).toBe("# Demo v2\n")
    // The repository's own branch and index are untouched.
    const head = await gitService.process.execute(["rev-parse", "HEAD"], { cwd: testRepoDir })
    expect(head.stdout.trim()).toBe(parentOid)
  })

  it("reports a checkpoint that would change nothing", async () => {
    fs.writeFileSync(path.join(testRepoDir, "README.md"), "# Demo\n")
    fs.writeFileSync(path.join(testRepoDir, "logo.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x00, 0x01]))
    const parentOid = commitAll(testRepoDir)

    const replica = new SessionReplica(sessionId, "leader_client")
    replica.createFile({ path: "README.md", kind: "text", content: "# Demo\n", actor })
    const snapshot = BarrierCapture.captureSnapshot(
      { barrierId: "barrier_unchanged_test", sessionSeq: 2, serverTime: 1726000200000 },
      replica,
    )
    const result = await checkpointBuilder.buildCheckpointCommit({
      repoPath: testRepoDir,
      sessionId,
      parentOid,
      leaseGeneration: 1,
      snapshot,
    })
    expect(result.treeOid).toBe(result.parentTreeOid)
  })

  it("places a session folder below the repository root and leaves the rest of the repository alone", async () => {
    fs.mkdirSync(path.join(testRepoDir, "app"), { recursive: true })
    fs.writeFileSync(path.join(testRepoDir, "app/index.ts"), "export const version = 1\n")
    fs.writeFileSync(path.join(testRepoDir, "app/stale.ts"), "export {}\n")
    fs.writeFileSync(path.join(testRepoDir, "outside.md"), "not part of the session\n")
    const parentOid = commitAll(testRepoDir)

    const replica = new SessionReplica(sessionId, "leader_client")
    replica.createFile({ path: "index.ts", kind: "text", content: "export const version = 2\n", actor })
    const snapshot = BarrierCapture.captureSnapshot(
      { barrierId: "barrier_prefix_test", sessionSeq: 3, serverTime: 1726000300000 },
      replica,
    )
    const result = await checkpointBuilder.buildCheckpointCommit({
      repoPath: path.join(testRepoDir, "app"),
      sessionId,
      parentOid,
      leaseGeneration: 1,
      snapshot,
      pathPrefix: "app/",
    })

    expect(await listTree(result.commitOid)).toEqual(["app/index.ts", "outside.md"])
    expect(await showFile(`${result.commitOid}:app/index.ts`)).toBe("export const version = 2\n")
  })
})
