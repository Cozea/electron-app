import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { inventoryRecoveryStorage, withRecoveryStorageBudget } from "../../apps/desktop/electron/collaboration/RecoveryStorageBudget"
let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-recovery-budget-")) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
async function file(relative: string, size: number) { const target = path.join(root, relative); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.writeFile(target, Buffer.alloc(size)); return target }

describe("aggregate encrypted recovery storage admission", () => {
  it("counts all key versions, pending atomic writes and displaced projection backups", async () => {
    await file("g3/room/outbox-a.json", 3)
    await file("g3/room/keys/2/ingress-b.json", 5)
    await file("g3/room/keys/3/checkpoint.json", 7)
    await file("g3/room/.lost.pending", 11)
    await file("retained/session/source.retained", 13)
    const inventory = await inventoryRecoveryStorage(root)
    expect(inventory).toMatchObject({ bytes: 39, files: 5, outboxRecords: 1, editorIngressRecords: 1, checkpointRecords: 1, projectionBackups: 1, pendingFiles: 1 })
    expect(JSON.stringify(inventory)).not.toMatch(/source|session|room|lost/)
  })
  it("serializes concurrent allocations across independent rooms and store instances", async () => {
    const write = (name: string) => withRecoveryStorageBudget(root, 6, () => file(name, 6), { limits: { bytes: 10 } })
    const outcomes = await Promise.allSettled([write("a"), write("b")])
    expect(outcomes.filter(item => item.status === "fulfilled")).toHaveLength(1)
    expect((await inventoryRecoveryStorage(root)).bytes).toBe(6)
  })
  it("does not hide old keys or reclaim pending records when the room quota is reached", async () => {
    const original = await file("g3/room/outbox-a.json", 6)
    await file("g3/room/keys/2/checkpoint.json", 4)
    await expect(withRecoveryStorageBudget(root, 1, () => file("g3/room/keys/3/new", 1), { roomRoot: path.join(root, "g3/room"), limits: { bytes: 100, roomBytes: 10 } })).rejects.toThrow("key versions")
    expect((await fs.readFile(original)).length).toBe(6)
    expect((await inventoryRecoveryStorage(root)).bytes).toBe(10)
  })
  it("fails closed on symlinks and bounded-inventory overflow without following targets", async () => {
    await file("ordinary/source", 2)
    await fs.mkdir(path.join(root, "recovery"))
    await fs.symlink(path.join(root, "ordinary"), path.join(root, "recovery/escape"))
    await expect(inventoryRecoveryStorage(path.join(root, "recovery"))).rejects.toThrow("link")
    await expect(inventoryRecoveryStorage(path.join(root, "ordinary"), 0)).rejects.toThrow("entry limit")
    expect((await fs.readFile(path.join(root, "ordinary/source"))).length).toBe(2)
  })
  it("releases the allocation gate after failed writes and budgets atomic replacement peaks", async () => {
    await file("old", 8)
    await expect(withRecoveryStorageBudget(root, 4, async () => {}, { limits: { bytes: 10 } })).rejects.toThrow("full")
    await expect(withRecoveryStorageBudget(root, 1, async () => { throw new Error("disk failed") }, { limits: { bytes: 10 } })).rejects.toThrow("disk failed")
    await withRecoveryStorageBudget(root, 2, () => file("after", 2), { limits: { bytes: 10 } })
    expect((await inventoryRecoveryStorage(root)).bytes).toBe(10)
  })
})
