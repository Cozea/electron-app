import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"

let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-durable-session-")) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
const pending = { id: "pending", projectId: "p", roomId: "session:s", keyVersion: 1, updateBinary: "opaque-encrypted-update", timestamp: 1 }

describe("durable encrypted session recovery", () => {
  it("restores pending and acknowledged data independently across a restart and checkpoint replacement", async () => {
    const store = new DurableSessionStore(root, "session:s")
    await store.enqueue(pending)
    await store.saveAcknowledged(1, "encrypted-ack-1")
    await store.saveAcknowledged(2, "encrypted-ack-2")
    const restarted = new DurableSessionStore(root, "session:s")
    expect(await restarted.list("session:s", 1)).toEqual([pending])
    expect((await restarted.recover()).updates.map(update => update.sequence)).toEqual([1, 2])
    await restarted.saveCheckpoint({ generation: 3, roomId: "session:s", keyVersion: 1, sequence: 1, snapshotBinary: "encrypted-checkpoint-1" })
    const recovered = new DurableSessionStore(root, "session:s")
    expect((await recovered.recover()).updates.map(update => update.sequence)).toEqual([2])
    expect(await recovered.list("session:s", 1)).toEqual([pending])
    await recovered.acknowledge("pending")
    expect(await new DurableSessionStore(root, "session:s").list("session:s", 1)).toEqual([])
  })
  it("does not hide outbox data when keys change or overwrite an id with different bytes", async () => {
    const store = new DurableSessionStore(root, "session:s")
    await store.enqueue(pending)
    await expect(store.enqueue({ ...pending, updateBinary: "different" })).rejects.toThrow("reused")
    await expect(store.list("session:s", 2)).rejects.toThrow("previous room key")
    expect(await store.list("session:s", 1)).toEqual([pending])
  })
  it("requires external operation identity and admission together on enqueue and recovery", async () => {
    const store = new DurableSessionStore(root, "session:s")
    await expect(store.enqueue({ ...pending, externalOperationId: "external_1" })).rejects.toThrow()
    await expect(store.enqueue({ ...pending, externalAdmission: "held" })).rejects.toThrow()
    await store.enqueue(pending)
    const filename = path.join(store.directory, "outbox-pending.json")
    const record = JSON.parse(await fs.readFile(filename, "utf8"))
    await fs.writeFile(filename, JSON.stringify({ ...record, externalOperationId: "external_1" }))
    await expect(store.list("session:s", 1)).rejects.toThrow()
  })
  it("retains corrupt records and reports sequence gaps instead of inventing a receive cursor", async () => {
    const store = new DurableSessionStore(root, "session:s")
    await store.saveAcknowledged(2, "gap")
    await expect(store.recover()).rejects.toThrow("gap")
    await store.enqueue(pending)
    await fs.writeFile(path.join(store.directory, "outbox-pending.json"), "truncated{")
    await expect(store.list("session:s", 1)).rejects.toThrow("retained for recovery")
    expect(await fs.readFile(path.join(store.directory, "outbox-pending.json"), "utf8")).toBe("truncated{")
  })
})
