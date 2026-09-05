import { describe, expect, it } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto"
import { SessionKeyCache } from "../../apps/desktop/electron/collaboration/SessionKeyCache"
import type { CollabSessionDescriptor } from "../../shared/CollaborationTransport"

describe("device-sealed collaboration key cache", () => {
  it("retains only sealed key envelopes, rejects a different device and never stores bearer credentials", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-key-cache-")), key = randomBytes(32)
    const sealer = {
      isEncryptionAvailable: () => true,
      encryptString(value: string) { const iv = randomBytes(12), cipher = createCipheriv("aes-256-gcm", key, iv); const encrypted = Buffer.concat([cipher.update(value), cipher.final()]); return Buffer.concat([iv, cipher.getAuthTag(), encrypted]) },
      decryptString(value: Buffer) { const cipher = createDecipheriv("aes-256-gcm", key, value.subarray(0, 12)); cipher.setAuthTag(value.subarray(12, 28)); return Buffer.concat([cipher.update(value.subarray(28)), cipher.final()]).toString() },
    }
    try {
      const cache = new SessionKeyCache(root, sealer)
      await cache.save({ projectId: "p", sessionId: "s", roomId: "session:s", deviceId: "device-a", protocolVersion: "2.1", collabWsUrl: "wss://room.test", token: "BEARER_MUST_NOT_PERSIST", encryption: { roomId: "session:s", status: "ready", encryptionRequired: true, activeKeyVersion: 1, wrappedRoomKey: "WRAPPED_KEY", senderPublicKeyJwk: "public-key", wrapAlgorithm: "ECDH-P256+A256GCM" } } as CollabSessionDescriptor)
      const bytes = await fs.readFile(path.join(root, (await fs.readdir(root))[0]!))
      expect(bytes.toString()).not.toContain("WRAPPED_KEY")
      expect(sealer.decryptString(bytes)).not.toContain("BEARER_MUST_NOT_PERSIST")
      expect((await new SessionKeyCache(root, sealer).recover("p", "s", "device-a"))?.encryption.wrappedRoomKey).toBe("WRAPPED_KEY")
      const original = await cache.recover("p", "s", "device-a")
      const next = { ...original!, token: "TRANSIENT_TOKEN", encryption: { ...original!.encryption, activeKeyVersion: 2, wrappedRoomKey: "NEW_WRAPPED_KEY" } }
      await cache.save(next, false)
      expect((await cache.recover("p", "s", "device-a"))?.encryption.activeKeyVersion).toBe(1)
      expect((await cache.recover("p", "s", "device-a", 2))?.encryption.wrappedRoomKey).toBe("NEW_WRAPPED_KEY")
      await cache.save(next)
      expect(await cache.versions("s")).toEqual([1, 2])
      expect((await cache.recover("p", "s", "device-a"))?.encryption.activeKeyVersion).toBe(2)
      expect((await cache.recover("p", "s", "device-a", 1))?.encryption.wrappedRoomKey).toBe("WRAPPED_KEY")
      await expect(cache.recover("p", "s", "device-b")).rejects.toThrow("cannot unlock")
      await expect(new SessionKeyCache(root, { ...sealer, isEncryptionAvailable: () => false }).recover("p", "s", "device-a")).rejects.toThrow("secure storage")
    } finally { await fs.rm(root, { recursive: true, force: true }) }
  })
})
