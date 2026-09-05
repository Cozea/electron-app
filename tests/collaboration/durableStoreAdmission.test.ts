import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
let root: string
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-store-admission-")) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })
const pending = { id: "same", roomId: "session:s", projectId: "p", keyVersion: 1, timestamp: 1, updateBinary: "first ciphertext" }
describe("independent recovery-store handle admission", () => {
  it("never races a reused outbox identity into replacement ciphertext", async () => {
    const a = new DurableSessionStore(root, "session:s"), b = new DurableSessionStore(root, "session:s")
    const outcomes = await Promise.allSettled([a.enqueue(pending), b.enqueue({ ...pending, updateBinary: "different ciphertext" })])
    expect(outcomes.map(result => result.status)).toEqual(["fulfilled", "rejected"])
    expect(await b.list("session:s", 1)).toEqual([pending])
    await Promise.all([a.flush(), b.flush().catch(() => {})])
  })
  it("rejects a key-version/physical-directory mismatch before writing", async () => {
    const a = new DurableSessionStore(root, "session:s", 2)
    await expect(a.enqueue(pending)).rejects.toThrow("Invalid")
    await expect(fs.stat(a.directory)).rejects.toMatchObject({ code: "ENOENT" })
  })
  it("serializes a replacement checkpoint with reads from another handle", async () => {
    const a = new DurableSessionStore(root, "session:s"), b = new DurableSessionStore(root, "session:s")
    await a.saveAcknowledged(1, "encrypted update")
    const checkpoint = { generation: 3 as const, roomId: "session:s", keyVersion: 1, sequence: 1, snapshotBinary: "durable replacement" }
    const replacement = a.saveCheckpoint(checkpoint)
    const read = b.recover()
    await replacement
    expect(await read).toEqual({ checkpoint, updates: [] })
  })
})
