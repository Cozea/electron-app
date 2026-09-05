import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createHash, createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { afterEach, beforeEach, describe, expect, it } from "vitest"
import { SessionKeyCache } from "../../apps/desktop/electron/collaboration/SessionKeyCache"
import { COLLABORATION_RECOVERY_LIMIT_BYTES } from "../../shared/collaborationRecovery"
import type { CollabSessionDescriptor } from "../../shared/CollaborationTransport"
let root: string
const sealKey = randomBytes(32)
const sealer = {
  isEncryptionAvailable: () => true,
  encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", sealKey, iv); const data = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), data]) },
  decryptString(value: Buffer) { const cipher = createDecipheriv("aes-256-gcm", sealKey, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString() },
}
const digest = createHash("sha256").update("s").digest("hex")
const descriptor = (version: number) => ({ projectId: "p", sessionId: "s", roomId: "session:s", deviceId: "device", protocolVersion: "2.1", collabWsUrl: "wss://example.test",
  token: "not-persisted", encryption: { roomId: "session:s", status: "ready", encryptionRequired: true, activeKeyVersion: version,
    wrappedRoomKey: `wrapped-${version}`, senderPublicKeyJwk: "public", wrapAlgorithm: "ECDH-P256+A256GCM" } }) as CollabSessionDescriptor
const cache = () => new SessionKeyCache(path.join(root, "device-keys"), sealer, root)
beforeEach(async () => { root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-key-retention-")) })
afterEach(async () => { await fs.rm(root, { recursive: true, force: true }) })

describe("bounded sealed-key retention", () => {
  it("counts other recovery files and preserves the previous key when admission is full", async () => {
    await cache().save(descriptor(1))
    const before = await fs.readFile(path.join(root, "device-keys", `${digest}.sealed`))
    const huge = await fs.open(path.join(root, "retained-budget-fixture"), "w")
    try { await huge.truncate(COLLABORATION_RECOVERY_LIMIT_BYTES) } finally { await huge.close() }
    await expect(cache().save(descriptor(2))).rejects.toThrow("storage is full")
    expect(await fs.readFile(path.join(root, "device-keys", `${digest}.sealed`))).toEqual(before)
    expect(await cache().versions("s")).toEqual([1])
  })
  it("serializes independent handles and cannot replace a newer current key with stale authority", async () => {
    await cache().save(descriptor(1))
    await Promise.all([cache().save(descriptor(2)), cache().save(descriptor(3))])
    expect((await cache().recover("p", "s", "device"))?.encryption.activeKeyVersion).toBe(3)
    expect(await cache().versions("s")).toEqual([1, 2, 3])
    await expect(cache().save(descriptor(2))).rejects.toThrow("moved forward")
    await cache().save(descriptor(4), false)
    expect((await cache().recover("p", "s", "device"))?.encryption.activeKeyVersion).toBe(3)
    expect((await cache().recover("p", "s", "device", 4))?.encryption.activeKeyVersion).toBe(4)
  })
  it("removes only proven older versions and retains current and pending rotation keys", async () => {
    await cache().save(descriptor(1)); await cache().save(descriptor(2)); await cache().save(descriptor(3), false)
    await expect(cache().retireUnusedVersions("s", 2, [2])).rejects.toThrow("changed")
    await expect(cache().retireUnusedVersions("s", 2, [3])).rejects.toThrow("changed")
    expect((await cache().retireUnusedVersions("s", 2, [1])).files).toBe(1)
    expect(await cache().versions("s")).toEqual([2, 3])
    expect((await cache().recover("p", "s", "device"))?.encryption.activeKeyVersion).toBe(2)
    expect((await cache().retireUnusedVersions("s", 2, [1])).files).toBe(0)
  })
  it("pauses at the version bound without evicting any retained envelope", async () => {
    const directory = path.join(root, "device-keys")
    await fs.mkdir(directory)
    for (let version = 1; version <= 64; version++) await fs.writeFile(path.join(directory, `${digest}-v${version}.sealed`), "retained opaque key")
    await expect(cache().save(descriptor(65))).rejects.toThrow("retention is full")
    expect(await cache().versions("s")).toHaveLength(64)
    expect(await fs.readFile(path.join(directory, `${digest}-v1.sealed`), "utf8")).toBe("retained opaque key")
  })
  it("rejects a linked sealed record and retains the unrelated target", async () => {
    const directory = path.join(root, "device-keys"), target = path.join(root, "unrelated")
    await fs.mkdir(directory); await fs.writeFile(target, "ordinary data")
    await fs.symlink(target, path.join(directory, `${digest}.sealed`))
    await expect(cache().recover("p", "s", "device")).rejects.toThrow("Unsafe")
    await expect(cache().save(descriptor(1))).rejects.toThrow("Unsafe")
    expect(await fs.readFile(target, "utf8")).toBe("ordinary data")
  })
})
