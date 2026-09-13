import { randomBytes, webcrypto } from "node:crypto"
import fs from "node:fs"
import os from "node:os"
import path from "node:path"
import { describe, expect, it } from "vitest"
import { BackgroundDeviceIdentityManager } from "../../apps/projectd/src/identity/BackgroundDeviceIdentity"
import { BackgroundSessionStore, type BackgroundSessionDescriptor } from "../../apps/projectd/src/collaboration/BackgroundSessionStore"
import { wrapSessionKey, unwrapSessionKey } from "../../apps/projectd/src/identity/SessionRoomKeys"
import { PendingBinaryStore } from "../../apps/projectd/src/collaboration/PendingBinaryStore"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

describe("durable background collaboration credentials", () => {
  it("restores encrypted session intent after SQLite reopen and forgets an explicit leave", async () => {
    const directory = fs.mkdtempSync(path.join(os.tmpdir(), "cozea-background-"))
    const filename = path.join(directory, "sessions.sqlite")
    const manager = new BackgroundDeviceIdentityManager()
    const identity = await manager.generateNewIdentity()
    const descriptor: BackgroundSessionDescriptor = {
      publicSessionId: "czs_0123456789abcdef", projectId: "project", workspaceId: "workspace",
      rootPath: directory, roomKeyBase64: randomBytes(32).toString("base64"), roomKeyVersion: 1,
      ticket: { wsUrl: "wss://room.example", token: "private-session-ticket", role: "developer" },
      background: { gatewayUrl: "https://gateway.example", convexUrl: "https://example.convex.cloud" },
    }
    let database = new ProjectdDatabase(filename)
    try {
      new BackgroundSessionStore(database).save(descriptor, identity)
      database.close()
      expect(fs.readFileSync(filename).includes(Buffer.from(descriptor.roomKeyBase64))).toBe(false)
      expect(fs.readFileSync(filename).includes(Buffer.from(descriptor.ticket.token))).toBe(false)
      database = new ProjectdDatabase(filename)
      const store = new BackgroundSessionStore(database)
      expect(store.list(identity)).toEqual([descriptor])
      expect(store.findActive(descriptor.publicSessionId, identity)).toEqual(descriptor)
      expect(store.list(await manager.generateNewIdentity())).toEqual([])
      store.remove(descriptor.publicSessionId)
      expect(store.findActive(descriptor.publicSessionId, identity)).toBeNull()
      expect(store.list(identity)).toEqual([])
      expect(store.listRecovery(identity)).toEqual([descriptor])
      expect(store.listRecovery(await manager.generateNewIdentity())).toEqual([])
      const beforeDenial = store.accessState(descriptor.publicSessionId, identity).generation
      store.denyAccess(descriptor.publicSessionId, identity)
      expect(store.acceptFreshAccess(descriptor.publicSessionId, identity, beforeDenial)).toBe(false)
      database.close()
      database = new ProjectdDatabase(filename)
      expect(new BackgroundSessionStore(database).list(identity)).toEqual([])
      expect(new BackgroundSessionStore(database).listRecovery(identity)).toEqual([descriptor])
      const recoveredStore = new BackgroundSessionStore(database)
      const denied = recoveredStore.accessState(descriptor.publicSessionId, identity)
      expect(denied.denied).toBe(true)
      expect(recoveredStore.accessState(descriptor.publicSessionId, await manager.generateNewIdentity()).denied).toBe(false)
      expect(recoveredStore.acceptFreshAccess(descriptor.publicSessionId, identity, denied.generation)).toBe(true)
      expect(recoveredStore.accessState(descriptor.publicSessionId, identity).denied).toBe(false)
      const damagedId = "czs_ffffffffffffffff"
      recoveredStore.save({ ...descriptor, publicSessionId: damagedId }, identity)
      database.db.prepare("UPDATE background_sessions SET envelope=? WHERE session_id=?").run(randomBytes(64), damagedId)
      new PendingBinaryStore(database, { sessionId: descriptor.publicSessionId, roomKey: Buffer.from(descriptor.roomKeyBase64, "base64") })
        .stage({ path: "private.bin", fileId: null, baseRevisionId: null, mode: 0o100644 }, Buffer.from([0, 1]))
      const entries = recoveredStore.discoverRecovery(identity)
      expect(recoveredStore.findRecovery(descriptor.publicSessionId, identity)).toEqual(descriptor)
      expect(() => recoveredStore.findRecovery(damagedId, identity)).toThrow()
      expect(recoveredStore.findRecovery(descriptor.publicSessionId, await manager.generateNewIdentity())).toBeNull()
      expect(entries).toEqual([
        { publicSessionId: damagedId, projectId: null, workspaceId: null, branchName: null,
          source: "joined", descriptorState: "unreadable", hasRetainedKey: false, pendingBatches: 0, pendingBinaryVersions: 0, requiresOnlineVerification: false, snapshotSequence: null },
        { publicSessionId: descriptor.publicSessionId, projectId: "project", workspaceId: "workspace", branchName: null,
          source: "left", descriptorState: "readable", hasRetainedKey: true, pendingBatches: 0, pendingBinaryVersions: 1, requiresOnlineVerification: false, snapshotSequence: null },
      ])
      const serialized = JSON.stringify(entries)
      expect(serialized).not.toContain(descriptor.roomKeyBase64)
      expect(serialized).not.toContain(descriptor.ticket.token)
      expect(serialized).not.toContain(descriptor.rootPath)
      expect(recoveredStore.discoverRecovery(await manager.generateNewIdentity())).toEqual([])
    } finally {
      database.close()
      fs.rmSync(directory, { recursive: true, force: true })
    }
  })

  it("interoperates with Electron's WebCrypto ECDH/AES-GCM envelopes and rejects tampering", async () => {
    const manager = new BackgroundDeviceIdentityManager()
    const sender = await manager.generateNewIdentity()
    const recipient = await manager.generateNewIdentity()
    const roomKey = randomBytes(32).toString("base64")
    const wrapped = wrapSessionKey(sender, JSON.stringify(recipient.publicKeyJwk), roomKey)
    expect(unwrapSessionKey(recipient, wrapped)).toBe(roomKey)
    const envelope = JSON.parse(wrapped.wrappedKey)
    const privateKey = await webcrypto.subtle.importKey("jwk", recipient.privateKeyJwk,
      { name: "ECDH", namedCurve: "P-256" }, false, ["deriveKey"])
    const publicKey = await webcrypto.subtle.importKey("jwk", sender.publicKeyJwk,
      { name: "ECDH", namedCurve: "P-256" }, false, [])
    const key = await webcrypto.subtle.deriveKey({ name: "ECDH", public: publicKey }, privateKey,
      { name: "AES-GCM", length: 256 }, false, ["encrypt", "decrypt"])
    const plaintext = await webcrypto.subtle.decrypt({ name: "AES-GCM",
      iv: Buffer.from(envelope.iv, "base64"), additionalData: Buffer.from(envelope.aad, "base64") },
    key, Buffer.from(envelope.ciphertext, "base64"))
    expect(Buffer.from(plaintext).toString("base64")).toBe(roomKey)
    const ciphertext = await webcrypto.subtle.encrypt({ name: "AES-GCM",
      iv: Buffer.from(envelope.iv, "base64"), additionalData: Buffer.from(envelope.aad, "base64") },
    key, Buffer.from(roomKey, "base64"))
    expect(unwrapSessionKey(recipient, { ...wrapped,
      wrappedKey: JSON.stringify({ ...envelope, ciphertext: Buffer.from(ciphertext).toString("base64") }) })).toBe(roomKey)
    const corrupted = Buffer.from(envelope.ciphertext, "base64")
    corrupted[0] ^= 1
    expect(() => unwrapSessionKey(recipient, { ...wrapped,
      wrappedKey: JSON.stringify({ ...envelope, ciphertext: corrupted.toString("base64") }) })).toThrow()
  })
})
