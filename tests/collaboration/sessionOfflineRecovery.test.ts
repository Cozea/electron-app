import { afterEach, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { readOfflineRecovery, saveOfflineRecovery } from "../../apps/desktop/electron/collaboration/SessionOfflineRecovery"
import { encryptPayload, envelopeToBytes } from "../../shared/collaborationCipher"
const roots: string[] = []
afterEach(async () => { for (const root of roots.splice(0)) await fs.rm(root, { recursive: true, force: true }) })
const cipher = { keyVersion: 2, roomKeyBase64: Buffer.alloc(32, 2).toString("base64") }
it.each([
  { entries: [{}] },
  { entries: [{ id: "recovery", incomplete: true, branch: "AAA=", files: [], sources: [{ keyVersion: 9, id: "source" }], resolved: [], saves: {} }] },
  { entries: [{ id: "recovery", incomplete: true, branch: "AAA=", files: [], sources: [{ keyVersion: 1, id: "source" }], resolved: ["missing-file"], saves: {} }] },
])("rejects malformed encrypted recovery state without modifying it: %j", async invalid => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-offline-journal-")); roots.push(root)
  const store = new DurableSessionStore(root, "session:s", 2)
  const envelope = await encryptPayload({ ...cipher, kind: "yjs_snapshot", plaintext: Buffer.from(JSON.stringify({ version: 1, ...invalid })), metadata: { purpose: "offline-recovery", sessionId: "s" } })
  const encoded = Buffer.from(envelopeToBytes(envelope)).toString("base64"); await store.saveRecoveryJournal(encoded)
  await expect(readOfflineRecovery(store, cipher, "s")).rejects.toThrow("malformed")
  expect(await store.readRecoveryJournal()).toBe(encoded)
})
it("retains an explicit incomplete entry even when no file history could be reconstructed", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-offline-incomplete-")); roots.push(root)
  const store = new DurableSessionStore(root, "session:s", 2)
  const journal = { version: 1 as const, entries: [{ id: "legacy", incomplete: true, branch: "AAA=", files: [], sources: [{ keyVersion: 1, id: "unresolved-source" }], resolved: [], saves: {} }] }
  await saveOfflineRecovery(store, cipher, "s", journal)
  expect(await readOfflineRecovery(store, cipher, "s")).toEqual(journal)
})
