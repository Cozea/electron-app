import { describe, expect, it, vi } from "vitest"

import {
  SessionReplica,
  type CollaborationBatch,
} from "../../apps/projectd/src/collaboration/SessionReplica"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

describe("P07 CRDT tree + per-text-file docs in projectd", () => {
  const actorA: ChangeActor = { actorType: "user", principalId: "user_a", identityKey: "czd_a" }
  const actorB: ChangeActor = { actorType: "user", principalId: "user_b", identityKey: "czd_b" }

  it("converges on concurrent text insertions in two replicas", () => {
    const replicaA = new SessionReplica("session_1", "client_a")
    const replicaB = new SessionReplica("session_1", "client_b")

    // Replica A creates file
    const file = replicaA.createFile({
      path: "src/index.ts",
      kind: "text",
      content: "hello",
      actor: actorA,
    })

    // Sync initial state A -> B
    const batchInit = replicaA.exportBatch()!
    replicaB.applyBatch(batchInit)

    expect(replicaB.textDocs.getTextContent(file.fileId)).toBe("hello")

    // Concurrent edits
    const docA = replicaA.textDocs.getOrCreate(file.fileId)
    docA.text.insert(5, " world") // "hello world"

    const docB = replicaB.textDocs.getOrCreate(file.fileId)
    docB.text.insert(5, " beautiful") // "hello beautiful"

    // Sync both ways
    const batchA = replicaA.exportBatch()!
    const batchB = replicaB.exportBatch()!

    replicaB.applyBatch(batchA)
    replicaA.applyBatch(batchB)

    // Both converge to identical text
    const textA = replicaA.textDocs.getTextContent(file.fileId)
    const textB = replicaB.textDocs.getTextContent(file.fileId)

    expect(textA).toBe(textB)
    expect(textA).toContain("hello")
    expect(textA).toContain("world")
    expect(textA).toContain("beautiful")
  })

  it("converges on concurrent text delete and insert", () => {
    const replicaA = new SessionReplica("session_1", "client_a")
    const replicaB = new SessionReplica("session_1", "client_b")

    const file = replicaA.createFile({
      path: "notes.txt",
      kind: "text",
      content: "The quick brown fox jumps",
      actor: actorA,
    })

    replicaB.applyBatch(replicaA.exportBatch()!)

    // Replica A deletes "brown "
    const docA = replicaA.textDocs.getOrCreate(file.fileId)
    docA.text.delete(10, 6) // "The quick fox jumps"

    // Replica B inserts " lazy" before fox
    const docB = replicaB.textDocs.getOrCreate(file.fileId)
    docB.text.insert(16, " lazy")

    // Sync
    const batchA = replicaA.exportBatch()!
    const batchB = replicaB.exportBatch()!

    replicaB.applyBatch(batchA)
    replicaA.applyBatch(batchB)

    expect(replicaA.textDocs.getTextContent(file.fileId)).toBe(
      replicaB.textDocs.getTextContent(file.fileId),
    )
  })

  it("preserves stable file ID across rename + concurrent text edit", () => {
    const replicaA = new SessionReplica("session_1", "client_a")
    const replicaB = new SessionReplica("session_1", "client_b")

    const file = replicaA.createFile({
      path: "src/utils.ts",
      kind: "text",
      content: "export function helper() {}",
      actor: actorA,
    })

    replicaB.applyBatch(replicaA.exportBatch()!)

    // Replica A renames file
    replicaA.renameFile(file.fileId, "src/helpers.ts", actorA)

    // Replica B concurrently edits content of the same file
    const docB = replicaB.textDocs.getOrCreate(file.fileId)
    docB.text.insert(docB.text.length, "\nexport const version = 2;")

    // Sync both ways
    const batchA = replicaA.exportBatch()!
    const batchB = replicaB.exportBatch()!

    replicaB.applyBatch(batchA)
    replicaA.applyBatch(batchB)

    // Both replicas have the renamed path with the edited content
    expect(replicaA.tree.getEntry(file.fileId)?.path).toBe("src/helpers.ts")
    expect(replicaB.tree.getEntry(file.fileId)?.path).toBe("src/helpers.ts")

    expect(replicaA.textDocs.getTextContent(file.fileId)).toBe(
      replicaB.textDocs.getTextContent(file.fileId),
    )
    expect(replicaA.textDocs.getTextContent(file.fileId)).toContain("version = 2")
  })

  it("detects concurrent rename conflicts", () => {
    const replicaA = new SessionReplica("session_1", "client_a")
    const replicaB = new SessionReplica("session_1", "client_b")

    const file = replicaA.createFile({
      path: "document.txt",
      kind: "text",
      content: "content",
      actor: actorA,
    })

    replicaB.applyBatch(replicaA.exportBatch()!)

    // A renames to notes.txt
    replicaA.renameFile(file.fileId, "notes.txt", actorA)

    // B renames to memo.txt
    replicaB.renameFile(file.fileId, "memo.txt", actorB)

    // Sync
    const batchA = replicaA.exportBatch()!
    const batchB = replicaB.exportBatch()!

    replicaB.applyBatch(batchA)
    replicaA.applyBatch(batchB)

    const conflictsA = replicaA.detectConflicts()
    const conflictsB = replicaB.detectConflicts()

    expect(conflictsA.concurrentRenames).toHaveLength(1)
    expect(conflictsB.concurrentRenames).toHaveLength(1)
    expect(conflictsA.concurrentRenames[0].fileId).toBe(file.fileId)
    const reviewed = conflictsA.concurrentRenames[0].ops.map((op) => op.opId)
    const late = new SessionReplica("session_1", "client_late")
    late.restoreSnapshot(replicaA.captureSnapshot())
    expect(() => replicaA.tree.resolveRenames(file.fileId, "selected.txt", ["stale"], actorA)).toThrow("changed")
    // Choosing the current effective path must still append resolution evidence.
    replicaA.tree.resolveRenames(file.fileId, replicaA.tree.getEntry(file.fileId)!.path, reviewed, actorA)
    expect(replicaA.detectConflicts().concurrentRenames).toHaveLength(0)
    replicaB.tree.resolveRenames(file.fileId, "other-choice.txt", reviewed, actorB)
    const resolutionA = replicaA.exportBatch()!
    const resolutionB = replicaB.exportBatch()!
    replicaA.applyBatch(resolutionB)
    replicaB.applyBatch(resolutionA)
    expect(replicaA.detectConflicts().concurrentRenames).toHaveLength(1)
    expect(replicaA.detectConflicts().concurrentRenames).toEqual(replicaB.detectConflicts().concurrentRenames)
    replicaA.tree.resolveRenames(file.fileId, "resolved.txt", replicaA.detectConflicts().concurrentRenames[0].ops.map((op) => op.opId), actorA)
    replicaB.applyBatch(replicaA.exportBatch()!)
    expect(replicaB.detectConflicts().concurrentRenames).toHaveLength(0)
    late.renameFile(file.fileId, "late.txt", actorB)
    const lateBatch = late.exportBatch()!
    replicaA.applyBatch(lateBatch)
    replicaB.applyBatch(lateBatch)
    expect(replicaA.detectConflicts().concurrentRenames[0].ops.map((op) => op.toPath).sort()).toEqual(["late.txt", "resolved.txt"])
    const restored = new SessionReplica("session_1", "restored")
    restored.restoreSnapshot(replicaA.captureSnapshot())
    expect(restored.detectConflicts().concurrentRenames).toEqual(replicaA.detectConflicts().concurrentRenames)
    expect(restored.textDocs.getTextContent(file.fileId)).toBe("content")
  })

  it("detects delete vs concurrent edit (delete-modify conflict)", () => {
    const replicaA = new SessionReplica("session_1", "client_a")
    const replicaB = new SessionReplica("session_1", "client_b")

    const file = replicaA.createFile({
      path: "config.json",
      kind: "text",
      content: "{}",
      actor: actorA,
    })

    replicaB.applyBatch(replicaA.exportBatch()!)

    // A deletes the file
    replicaA.deleteFile(file.fileId, actorA)

    // B concurrently modifies the file content
    const docB = replicaB.textDocs.getOrCreate(file.fileId)
    docB.text.insert(1, '"debug":true')

    // Sync
    replicaB.applyBatch(replicaA.exportBatch()!)
    replicaA.applyBatch(replicaB.exportBatch()!)

    // A deleted entry exists and text edits exist -> delete_modify conflict
    const confA = replicaA.detectConflicts()
    const confB = replicaB.detectConflicts()

    expect(confA.deleteModifyConflicts).toHaveLength(1)
    expect(confB.deleteModifyConflicts).toHaveLength(1)
    expect(confA.deleteModifyConflicts[0].fileId).toBe(file.fileId)
    const clock = vi.spyOn(Date, "now").mockReturnValue(1)
    try { replicaA.deleteFile(file.fileId, actorA, true) } finally { clock.mockRestore() }
    replicaB.applyBatch(replicaA.exportBatch()!)
    expect(replicaB.detectConflicts().deleteModifyConflicts).toHaveLength(0)
    expect(replicaB.tree.getEntry(file.fileId)?.deleted).toBe(true)
    expect(replicaB.textDocs.getTextContent(file.fileId)).toContain("debug")
    replicaA.textDocs.getOrCreate(file.fileId).text.insert(0, "late")
    replicaB.applyBatch(replicaA.exportBatch()!)
    expect(replicaB.detectConflicts().deleteModifyConflicts).toHaveLength(1)
  })

  it("retains binary edits unseen by deletion and clears only explicitly reviewed edits", () => {
    const a = new SessionReplica("binary_delete", "a")
    const b = new SessionReplica("binary_delete", "b")
    const file = a.createFile({ path: "image.bin", kind: "binary", actor: actorA })
    const base = { revisionId: "base", fileId: file.fileId, baseRevisionId: null, contentHash: "base-hash",
      encryptedManifestRef: "base-manifest", size: 10, actor: actorA, createdAt: 100 }
    a.addBinaryRevision(base)
    b.applyBatch(a.exportBatch()!)
    a.deleteFile(file.fileId, actorA)
    b.addBinaryRevision({ ...base, revisionId: "edit", baseRevisionId: "base", contentHash: "edited" })
    const deletion = a.exportBatch()!
    a.applyBatch(b.exportBatch()!)
    b.applyBatch(deletion)
    expect(a.detectConflicts().deleteModifyConflicts).toHaveLength(1)
    expect(b.detectConflicts().deleteModifyConflicts).toHaveLength(1)
    a.deleteFile(file.fileId, actorA, true)
    b.applyBatch(a.exportBatch()!)
    expect(b.detectConflicts().deleteModifyConflicts).toHaveLength(0)
    expect(b.binaryStore.getRevisions(file.fileId)).toHaveLength(2)
    b.addBinaryRevision({ ...base, revisionId: "late", baseRevisionId: "base", contentHash: "late-edit" })
    a.applyBatch(b.exportBatch()!)
    expect(a.detectConflicts().deleteModifyConflicts).toHaveLength(1)
    const restored = new SessionReplica("binary_delete", "restored")
    restored.restoreSnapshot(a.captureSnapshot())
    expect(restored.detectConflicts().deleteModifyConflicts).toEqual(a.detectConflicts().deleteModifyConflicts)
  })

  it("detects path collisions without silent overwrite (Invariant C18)", () => {
    const replicaA = new SessionReplica("session_1", "client_a")
    const replicaB = new SessionReplica("session_1", "client_b")

    // Concurrently create two files with different fileIds claiming the same path
    const fileA = replicaA.createFile({
      path: "server.ts",
      kind: "text",
      content: "server A",
      actor: actorA,
    })

    const fileB = replicaB.createFile({
      path: "server.ts",
      kind: "text",
      content: "server B",
      actor: actorB,
    })

    // Export batches before cross-applying
    const batchA = replicaA.exportBatch()
    const batchB = replicaB.exportBatch()

    if (batchA) replicaB.applyBatch(batchA)
    if (batchB) replicaA.applyBatch(batchB)

    // Both entries exist
    expect(replicaA.tree.getEntry(fileA.fileId)).not.toBeNull()
    expect(replicaA.tree.getEntry(fileB.fileId)).not.toBeNull()

    // Conflict engine detects collision
    const confA = replicaA.detectConflicts()
    expect(confA.pathCollisions).toHaveLength(1)
    expect(confA.pathCollisions[0].normalizedPath).toBe("server.ts")
    expect(confA.pathCollisions[0].fileIds).toContain(fileA.fileId)
    expect(confA.pathCollisions[0].fileIds).toContain(fileB.fileId)
  })

  it("propagates chmod and symlink operations", () => {
    const replicaA = new SessionReplica("session_1", "client_a")
    const replicaB = new SessionReplica("session_1", "client_b")

    const script = replicaA.createFile({
      path: "run.sh",
      kind: "text",
      mode: 0o100644,
      content: "#!/bin/bash",
      actor: actorA,
    })

    const link = replicaA.createFile({
      path: "symlink.sh",
      kind: "symlink",
      actor: actorA,
    })
    replicaA.tree.setSymlinkTarget(link.fileId, "run.sh", actorA)
    replicaA.tree.chmodEntry(script.fileId, 0o100755, actorA)

    // Sync A -> B
    replicaB.applyBatch(replicaA.exportBatch()!)

    const scriptOnB = replicaB.tree.getEntry(script.fileId)
    expect(scriptOnB?.mode).toBe(0o100755)

    const linkOnB = replicaB.tree.getEntry(link.fileId)
    expect(linkOnB?.kind).toBe("symlink")
    expect(linkOnB?.symlinkTarget).toBe("run.sh")
  })

  it("detects binary concurrent sibling revisions", () => {
    const replicaA = new SessionReplica("session_1", "client_a")
    const replicaB = new SessionReplica("session_1", "client_b")

    const binFile = replicaA.createFile({
      path: "logo.png",
      kind: "binary",
      actor: actorA,
    })

    // Initial binary revision V1
    replicaA.binaryStore.addRevision({
      revisionId: "rev_1",
      fileId: binFile.fileId,
      baseRevisionId: null,
      contentHash: "hash_v1",
      encryptedManifestRef: "ref_1",
      size: 5000,
      actor: actorA,
      createdAt: 1000,
    })

    replicaB.applyBatch(replicaA.exportBatch()!)

    // Concurrent revisions branching from rev_1
    const rev2A = {
      revisionId: "rev_2a",
      fileId: binFile.fileId,
      baseRevisionId: "rev_1",
      contentHash: "hash_v2a",
      encryptedManifestRef: "ref_2a",
      size: 5200,
      actor: actorA,
      createdAt: 2000,
    }
    replicaA.binaryStore.addRevision(rev2A)

    const rev2B = {
      revisionId: "rev_2b",
      fileId: binFile.fileId,
      baseRevisionId: "rev_1",
      contentHash: "hash_v2b",
      encryptedManifestRef: "ref_2b",
      size: 5400,
      actor: actorB,
      createdAt: 2100,
    }
    replicaB.binaryStore.addRevision(rev2B)

    // Sync binary revisions in batch
    const batchA: CollaborationBatch = {
      batchId: "b_a",
      sessionId: "session_1",
      clientId: "client_a",
      operations: [{ type: "binary-revision", revision: rev2A }],
      createdAt: 2000,
    }

    const batchB: CollaborationBatch = {
      batchId: "b_b",
      sessionId: "session_1",
      clientId: "client_b",
      operations: [{ type: "binary-revision", revision: rev2B }],
      createdAt: 2100,
    }

    replicaB.applyBatch(batchA)
    replicaA.applyBatch(batchB)

    const confA = replicaA.detectConflicts()
    const confB = replicaB.detectConflicts()

    expect(confA.binaryConflicts).toHaveLength(1)
    expect(confB.binaryConflicts).toHaveLength(1)
    expect(confA.binaryConflicts[0].conflictingRevisions).toHaveLength(2)
  })

  it("converges deterministically independent of operation delivery order (Exit Gate)", () => {
    // Generate sequences of operations
    const replicaSourceA = new SessionReplica("session_matrix", "client_a")
    const replicaSourceB = new SessionReplica("session_matrix", "client_b")

    const f1 = replicaSourceA.createFile({
      path: "src/a.ts",
      kind: "text",
      content: "initial a",
      actor: actorA,
    })
    const batch1 = replicaSourceA.exportBatch()!

    replicaSourceB.applyBatch(batch1)

    const f2 = replicaSourceB.createFile({
      path: "src/b.ts",
      kind: "text",
      content: "initial b",
      actor: actorB,
    })
    const batch2 = replicaSourceB.exportBatch()!

    replicaSourceA.applyBatch(batch2)

    // A edits f1 and renames f2
    replicaSourceA.updateTextContent(f1.fileId, "initial a modified by A")
    replicaSourceA.renameFile(f2.fileId, "src/b_renamed.ts", actorA)
    const batch3 = replicaSourceA.exportBatch()!

    // B edits f2 and edits f1
    replicaSourceB.updateTextContent(f2.fileId, "initial b modified by B")
    const docB_f1 = replicaSourceB.textDocs.getOrCreate(f1.fileId)
    docB_f1.text.insert(docB_f1.text.length, " and concurrent B")
    const batch4 = replicaSourceB.exportBatch()!

    const allBatches = [batch1, batch2, batch3, batch4]

    // Replica C receives batches in forward order: [1, 2, 3, 4]
    const replicaC = new SessionReplica("session_matrix", "client_c")
    for (const b of allBatches) {
      replicaC.applyBatch(b)
    }

    // Replica D receives batches in shuffled/reverse order: [4, 1, 3, 2]
    const replicaD = new SessionReplica("session_matrix", "client_d")
    const shuffled = [allBatches[3], allBatches[0], allBatches[2], allBatches[1]]
    for (const b of shuffled) {
      replicaD.applyBatch(b)
    }

    // Assert Replica C and Replica D converge to EXACT identical project state!
    const entriesC = replicaC.tree.listLiveEntries().sort((a, b) => a.fileId.localeCompare(b.fileId))
    const entriesD = replicaD.tree.listLiveEntries().sort((a, b) => a.fileId.localeCompare(b.fileId))

    expect(entriesC).toEqual(entriesD)

    for (const entry of entriesC) {
      if (entry.kind === "text") {
        const textC = replicaC.textDocs.getTextContent(entry.fileId)
        const textD = replicaD.textDocs.getTextContent(entry.fileId)
        expect(textC).toBe(textD)
      }
    }
  })
})
