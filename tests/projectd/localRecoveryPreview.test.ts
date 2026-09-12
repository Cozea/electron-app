import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"

import { LocalRecoveryPreviewFile, previewLocalRecovery } from "../../apps/projectd/src/collaboration/LocalRecoveryPreview"
import { LocalReplicaStore } from "../../apps/projectd/src/collaboration/LocalReplicaStore"
import { OutboundBatchQueue } from "../../apps/projectd/src/collaboration/OutboundBatchQueue"
import { PendingBinaryStore } from "../../apps/projectd/src/collaboration/PendingBinaryStore"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

function byPath(entries: LocalRecoveryPreviewFile[], path: string): LocalRecoveryPreviewFile[] {
  return entries.filter((entry) => entry.path === path)
}

describe("local frozen-session recovery preview", () => {
  it("inspects retained snapshot plus journal without reading workspace or staged binary payloads", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-recovery-preview-"))
    const db = new ProjectdDatabase(path.join(root, "journal.sqlite"))
    const sessionId = "czs_0123456789abcdef"
    const roomKey = randomBytes(32)
    const keys = { sessionId, roomKey }
    const workspace = path.join(root, "workspace")
    await fs.mkdir(path.join(workspace, "src"), { recursive: true })
    await fs.writeFile(path.join(workspace, "src/main.ts"), "newer workspace bytes that are not retained")

    const replica = new SessionReplica(sessionId, "preview-fixture")
    const actor = { actorType: "user" as const, principalId: "principal" }
    const text = replica.createFile({ path: "src/main.ts", kind: "text", content: "snapshot text", actor })
    replica.createFile({ path: "collision.txt", kind: "text", content: "first", actor })
    replica.createFile({ path: "collision.txt", kind: "text", content: "second", actor })
    const binary = replica.createFile({ path: "asset.bin", kind: "binary", actor })
    replica.binaryStore.addRevision({ revisionId: "rev-a", fileId: binary.fileId, baseRevisionId: null,
      contentHash: "a".repeat(64), encryptedManifestRef: "fixture-a", size: 11, actor, createdAt: 1 })
    replica.binaryStore.addRevision({ revisionId: "rev-b", fileId: binary.fileId, baseRevisionId: null,
      contentHash: "b".repeat(64), encryptedManifestRef: "fixture-b", size: 12, actor, createdAt: 2 })
    replica.tree.createEntry({ path: "link", kind: "symlink", symlinkTarget: `../${"target/".repeat(900)}`, actor })
    const retired = replica.createFile({ path: "reuse.bin", kind: "binary", actor })
    replica.deleteFile(retired.fileId, actor)

    // Advance export watermarks before snapshotting so the next batch contains
    // only the edit that happened after the retained snapshot.
    replica.exportBatch()
    new LocalReplicaStore(db, keys).save({ sequence: 7, replica: replica.captureSnapshot() })
    const retainedText = `pending journal edit\n${"x".repeat(9 * 1024)}`
    replica.updateTextContent(text.fileId, retainedText)
    const pending = replica.exportBatch()!
    const queue = new OutboundBatchQueue(db, keys)
    queue.enqueue(pending)

    const stagedStore = new PendingBinaryStore(db, keys)
    stagedStore.stage({ path: "asset.bin", fileId: binary.fileId, baseRevisionId: "rev-b", mode: 0o100644 }, Buffer.from("staged-existing"))
    const pendingOnly = stagedStore.stage({ path: "reuse.bin", fileId: null, baseRevisionId: null, mode: 0o100644 }, Buffer.from("new-file"))
    // Preview must depend on encrypted intent metadata only, not payload chunks.
    db.db.prepare("DELETE FROM pending_binary_chunks WHERE session_id=? AND revision_id=?")
      .run(sessionId, pendingOnly.revisionId)

    const descriptor = {
      publicSessionId: sessionId,
      projectId: "project",
      workspaceId: "workspace",
      rootPath: workspace,
      roomKeyBase64: roomKey.toString("base64"),
      background: { gatewayUrl: "https://unused.example", convexUrl: "https://unused.convex.cloud" },
    }

    try {
      const preview = previewLocalRecovery(db, descriptor, { limit: 100 })
      expect(preview).toMatchObject({ publicSessionId: sessionId, snapshotSequence: 7, pendingBatches: 1,
        pendingBinaryVersions: 2, conflicts: { pathCollisions: 1, binary: 1 } })
      expect(preview.totalEntries).toBe(preview.entries.length)

      const textPreview = byPath(preview.entries, "src/main.ts")[0]!
      expect(textPreview.textPreview).toMatch(/^pending journal edit/)
      expect(textPreview.textPreview).not.toContain("newer workspace bytes")
      expect(textPreview.textTruncated).toBe(true)
      expect(Buffer.byteLength(textPreview.textPreview!, "utf8")).toBeLessThanOrEqual(8 * 1024)

      const binaryPreview = byPath(preview.entries, "asset.bin")[0]!
      expect(binaryPreview).toMatchObject({ fileId: binary.fileId, revisionCount: 2, pendingBinaryVersions: 1 })
      expect(binaryPreview.conflictKinds).toContain("binary_concurrent_revision")

      const symlinkPreview = byPath(preview.entries, "link")[0]!
      expect(symlinkPreview.symlinkTargetTruncated).toBe(true)
      expect(Buffer.byteLength(symlinkPreview.symlinkTarget!, "utf8")).toBeLessThanOrEqual(4 * 1024)

      const collision = byPath(preview.entries, "collision.txt")
      expect(collision).toHaveLength(2)
      expect(collision.every((entry) => entry.conflictKinds.includes("path_collision"))).toBe(true)

      // C17: path reuse never merges identities. The tombstoned old file remains
      // distinct from a pending new binary that happens to use the same path.
      const reusedPath = byPath(preview.entries, "reuse.bin")
      expect(reusedPath).toHaveLength(2)
      expect(reusedPath.some((entry) => entry.fileId === retired.fileId && entry.deleted)).toBe(true)
      expect(reusedPath.some((entry) => entry.cursor.startsWith("pending:") && entry.fileId === null && !entry.deleted)).toBe(true)

      const first = previewLocalRecovery(db, descriptor, { limit: 1 })
      expect(first.entries).toHaveLength(1)
      expect(first.nextCursor).not.toBeNull()
      const second = previewLocalRecovery(db, descriptor, { afterCursor: first.nextCursor!, limit: 1 })
      expect(second.entries).toHaveLength(1)
      expect(second.entries[0]!.cursor).not.toBe(first.entries[0]!.cursor)
      expect(() => previewLocalRecovery(db, descriptor, { afterCursor: "file:stale" })).toThrow(/changed/)

      expect(queue.getPendingBatches(sessionId)).toHaveLength(1)
      expect(stagedStore.count()).toBe(2)
      expect(() => previewLocalRecovery(db, { ...descriptor, roomKeyBase64: randomBytes(32).toString("base64") }))
        .toThrow()
    } finally {
      db.close()
      await fs.rm(root, { recursive: true, force: true })
    }
  })
})
