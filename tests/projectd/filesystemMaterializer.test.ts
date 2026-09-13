import fs from "node:fs"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import { FilesystemMaterializer } from "../../apps/projectd/src/filesystem/Materializer"
import { MaterializationIndex } from "../../apps/projectd/src/filesystem/MaterializationIndex"
import { BaselineStore } from "../../apps/projectd/src/collaboration/BaselineStore"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"

describe("P09 CRDT -> filesystem materializer", () => {
  const actorRemote: ChangeActor = { actorType: "user", principalId: "remote_1" }

  const tmpDir = "/tmp"
  let testWorkspaceDir: string
  let testDbPath: string
  let db: ProjectdDatabase
  let index: MaterializationIndex
  let baselineStore: BaselineStore
  let replica: SessionReplica
  let materializer: FilesystemMaterializer

  const sessionId = "sess_mat_test"

  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout", "Date"] })
    const id = `${Date.now()}_${Math.random().toString(36).slice(2)}`
    testWorkspaceDir = path.join(tmpDir, `test_mat_${id}`)
    testDbPath = path.join(tmpDir, `test_mat_db_${id}.sqlite`)

    fs.mkdirSync(testWorkspaceDir, { recursive: true })

    db = new ProjectdDatabase(testDbPath)
    index = new MaterializationIndex(db)
    baselineStore = new BaselineStore()
    replica = new SessionReplica(sessionId, "local_client")
    materializer = new FilesystemMaterializer({
      workspaceRoot: testWorkspaceDir,
      sessionId,
      replica,
      index,
      baselineStore,
      normalDelayMs: 10,
      maxDelayMs: 40,
    })
  })

  afterEach(async () => {
    if (materializer) {
      await materializer.flush()
      materializer.dispose()
    }
    vi.useRealTimers()
    if (db) db.close()
    for (const p of [testWorkspaceDir, testDbPath, `${testDbPath}-wal`, `${testDbPath}-shm`]) {
      try {
        if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true })
      } catch {
        // Ignore
      }
    }
  })

  it("keeps materialized bytes until delete-versus-edit is explicitly resolved", async () => {
    const entry = replica.createFile({ path: "file.txt", kind: "text", content: "base", actor: actorRemote })
    await materializer.materializeFile(entry.fileId, Date.now())
    replica.deleteFile(entry.fileId, actorRemote)
    replica.textDocs.getOrCreate(entry.fileId).text.insert(4, " concurrent")
    expect(replica.detectConflicts().deleteModifyConflicts).toHaveLength(1)
    await materializer.materializeFile(entry.fileId, Date.now())
    expect(fs.readFileSync(path.join(testWorkspaceDir, "file.txt"), "utf8")).toBe("base")
    replica.deleteFile(entry.fileId, actorRemote, true)
    await materializer.materializeFile(entry.fileId, Date.now())
    expect(fs.existsSync(path.join(testWorkspaceDir, "file.txt"))).toBe(false)
    expect(replica.textDocs.getTextContent(entry.fileId)).toBe("base concurrent")
  })

  it("does not follow a replacement symlink when deleting an indexed regular file", async () => {
    const entry = replica.createFile({ path: "file", kind: "text", content: "same bytes", actor: actorRemote })
    await materializer.materializeFile(entry.fileId, Date.now())
    fs.writeFileSync(path.join(testWorkspaceDir, "target"), "same bytes")
    fs.unlinkSync(path.join(testWorkspaceDir, "file"))
    fs.symlinkSync("target", path.join(testWorkspaceDir, "file"))
    replica.deleteFile(entry.fileId, actorRemote)
    await materializer.materializeFile(entry.fileId, Date.now())
    expect(fs.readlinkSync(path.join(testWorkspaceDir, "file"))).toBe("target")
    expect(fs.readFileSync(path.join(testWorkspaceDir, "target"), "utf8")).toBe("same bytes")
  })

  it("materializes remote single-character edit with low latency", async () => {
    const file = replica.createFile({
      path: "counter.ts",
      kind: "text",
      content: "const a = 1;",
      actor: actorRemote,
    })

    materializer.scheduleMaterialization(file.fileId)
    await vi.advanceTimersByTimeAsync(10)
    await materializer.flush()

    const absPath = path.join(testWorkspaceDir, "counter.ts")
    expect(fs.existsSync(absPath)).toBe(true)
    expect(fs.readFileSync(absPath, "utf8")).toBe("const a = 1;")

    // Now remote edits single character '0'
    const doc = replica.textDocs.getOrCreate(file.fileId)
    doc.text.insert(11, "0") // "const a = 10;"

    const start = Date.now()
    materializer.scheduleMaterialization(file.fileId)
    await vi.advanceTimersByTimeAsync(10)
    await materializer.flush()

    expect(fs.readFileSync(absPath, "utf8")).toBe("const a = 10;")
    expect(Date.now() - start).toBeLessThan(150) // Fast low-latency materialization
    expect(materializer.lastLatencyMs).toBeGreaterThan(0)
  })

  it("coalesces rapid 100 updates without overloading disk I/O", async () => {
    const writes = vi.spyOn(materializer, "materializeFile")
    const file = replica.createFile({
      path: "stream.txt",
      kind: "text",
      content: "0",
      actor: actorRemote,
    })

    const doc = replica.textDocs.getOrCreate(file.fileId)

    // Emit 100 rapid text insertions in quick succession
    for (let i = 1; i <= 100; i++) {
      doc.text.insert(doc.text.length, ` ${i}`)
      materializer.scheduleMaterialization(file.fileId)
    }

    // Wait for coalesced writeback
    await vi.advanceTimersByTimeAsync(10)
    await materializer.flush()

    const absPath = path.join(testWorkspaceDir, "stream.txt")
    expect(fs.existsSync(absPath)).toBe(true)

    const finalDiskContent = fs.readFileSync(absPath, "utf8")
    expect(finalDiskContent).toBe(doc.text.toString())
    expect(finalDiskContent).toContain(" 100")
    expect(writes).toHaveBeenCalledTimes(1)
  })

  it("enforces divergent disk protection when local file has un-ingested changes", async () => {
    const file = replica.createFile({
      path: "config.json",
      kind: "text",
      content: '{"v":1}',
      actor: actorRemote,
    })

    // Materialize initial baseline
    materializer.scheduleMaterialization(file.fileId)
    await materializer.flush()

    const absPath = path.join(testWorkspaceDir, "config.json")
    expect(fs.readFileSync(absPath, "utf8")).toBe('{"v":1}')

    // Simulate external editor writing local un-ingested changes directly on disk
    fs.writeFileSync(absPath, '{"v":1,"unmerged_local":true}')

    // Now remote arrives with divergent change
    const doc = replica.textDocs.getOrCreate(file.fileId)
    doc.text.delete(0, doc.text.length)
    doc.text.insert(0, '{"v":2,"remote":true}')

    materializer.scheduleMaterialization(file.fileId)
    await materializer.flush()

    // Divergent disk protection: Local unmerged edits were preserved in a .conflict backup file!
    const filesInDir = fs.readdirSync(testWorkspaceDir)
    const conflictBackup = filesInDir.find((f) => f.startsWith("config.json.conflict."))
    expect(conflictBackup).toBeDefined()

    const backupContent = fs.readFileSync(path.join(testWorkspaceDir, conflictBackup!), "utf8")
    expect(backupContent).toBe('{"v":1,"unmerged_local":true}')

    // And the active file converged to remote CRDT state
    expect(fs.readFileSync(absPath, "utf8")).toBe('{"v":2,"remote":true}')
  })

  it("suppresses materialization on path collisions (Invariant C18)", async () => {
    const fileA = replica.createFile({
      path: "conflict.txt",
      kind: "text",
      content: "file A",
      actor: actorRemote,
    })

    const fileB = replica.createFile({
      path: "conflict.txt",
      kind: "text",
      content: "file B",
      actor: actorRemote,
    })

    // Path collision detected in replica
    const conflicts = replica.detectConflicts()
    expect(conflicts.pathCollisions).toHaveLength(1)

    // Materializer must suppress destructive overwrite
    materializer.scheduleMaterialization(fileA.fileId)
    materializer.scheduleMaterialization(fileB.fileId)
    await vi.advanceTimersByTimeAsync(10)
    await materializer.flush()

    const absPath = path.join(testWorkspaceDir, "conflict.txt")
    // Destructive overwrite was prevented
    expect(fs.existsSync(absPath)).toBe(false)
  })

  it("applies file deletion and removes index entry", async () => {
    const file = replica.createFile({
      path: "temp.txt",
      kind: "text",
      content: "temporary",
      actor: actorRemote,
    })

    materializer.scheduleMaterialization(file.fileId)
    await materializer.flush()

    const absPath = path.join(testWorkspaceDir, "temp.txt")
    expect(fs.existsSync(absPath)).toBe(true)

    // Delete in CRDT
    replica.deleteFile(file.fileId, actorRemote)
    materializer.scheduleMaterialization(file.fileId)
    await materializer.flush()

    expect(fs.existsSync(absPath)).toBe(false)
    expect(index.getByFileId(sessionId, file.fileId)).toBeNull()
  })
})
