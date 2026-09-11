import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"

import { GitService } from "../../apps/projectd/src/git/GitService"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { BarrierCapture, type BarrierDescriptor } from "../../apps/projectd/src/autogit/BarrierCapture"
import { CheckpointBuilder } from "../../apps/projectd/src/autogit/CheckpointBuilder"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

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
})
