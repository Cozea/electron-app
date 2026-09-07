#!/usr/bin/env python3
from pathlib import Path

# Align generation-3 runtime contracts with current main's pure device-principal
# identity model and canonical repository credential response.
transport_path = Path("shared/CollaborationTransport.ts")
transport = transport_path.read_text()
old_descriptor = '''  protocolVersion: string\n  deviceId: string\n  deviceFingerprint?: string\n  devicePublicKeyJwk?: string\n'''
new_descriptor = '''  protocolVersion: string\n  principalId: string\n  identityKey: string\n  displayName?: string\n  encryptionFingerprint?: string\n  encryptionPublicKeyJwk?: string\n'''
if old_descriptor in transport:
    transport = transport.replace(old_descriptor, new_descriptor, 1)
elif "principalId: string" not in transport or "identityKey: string" not in transport:
    raise SystemExit("CollaborationTransport principal descriptor anchor missing")
transport_path.write_text(transport)

cache_path = Path("apps/desktop/electron/collaboration/SessionKeyCache.ts")
cache = cache_path.read_text()
cache = cache.replace("  deviceId: string\n  roomId: string\n", "  identityKey: string\n  principalId: string\n  roomId: string\n")
cache = cache.replace(
    "deviceId: session.deviceId,\n      roomId:",
    "identityKey: session.identityKey, principalId: session.principalId,\n      roomId:",
)
cache = cache.replace("old.deviceId !== session.deviceId", "old.identityKey !== session.identityKey || old.principalId !== session.principalId")
cache = cache.replace("async recover(projectId: string, sessionId: string, deviceId: string, version?: number)", "async recover(projectId: string, sessionId: string, identityKey: string, version?: number)")
cache = cache.replace("value.deviceId !== deviceId", "value.identityKey !== identityKey")
cache_path.write_text(cache)

manager_path = Path("apps/desktop/electron/collaboration/SessionKeyManager.ts")
manager_path.write_text(r'''import { ensureCollabDeviceIdentity, unwrapRoomKeyFromSender, wrapRoomKeyForRecipient } from "../collabKeys"
import { generateRoomKeyBase64 } from "../../../../shared/collaborationCipher"
import type { CollabSessionDescriptor } from "../../../../shared/CollaborationTransport"
import { DeviceCollaborationGateway } from "./DeviceCollaborationGateway"
import type { SessionKeyCache } from "./SessionKeyCache"

interface RotationStatus {
  required: boolean
  currentKeyVersion: number | null
  pendingKeyVersion: number | null
  wrappedRoomKey: string | null
  senderPublicKeyJwk: string | null
  wrapAlgorithm: string | null
}

export class SessionKeyManager {
  private readonly gateway: DeviceCollaborationGateway
  private readonly cache?: SessionKeyCache
  constructor(gateway: DeviceCollaborationGateway, cache?: SessionKeyCache) {
    this.gateway = gateway
    this.cache = cache
  }

  async descriptor(projectId: string, sessionId: string): Promise<CollabSessionDescriptor> {
    const identity = await ensureCollabDeviceIdentity()
    const descriptor = await this.gateway.post<CollabSessionDescriptor>("/collab/v2/session", {
      projectId,
      sessionId,
      clientType: "electron",
    })
    if (
      descriptor.projectId !== projectId ||
      descriptor.sessionId !== sessionId ||
      descriptor.identityKey !== identity.identityKey ||
      !descriptor.principalId ||
      descriptor.encryption.roomId !== descriptor.roomId ||
      !descriptor.encryption.encryptionRequired
    ) {
      throw new Error("Session encryption authority does not match this device principal")
    }
    return descriptor
  }

  async ensure(
    projectId: string,
    sessionId: string,
    role: "editor" | "observer",
  ): Promise<{ session: CollabSessionDescriptor; roomKeyBase64: string; keyVersion: number } | null> {
    let session = await this.descriptor(projectId, sessionId)
    if (session.encryption.status === "room_not_initialized" && role === "editor") {
      const identity = await ensureCollabDeviceIdentity()
      const roomKeyBase64 = generateRoomKeyBase64()
      const wrapped = await wrapRoomKeyForRecipient({ roomKeyBase64, recipientPublicKeyJwk: identity.publicKeyJwk })
      await this.gateway.post("/collab/v2/keys", {
        operation: "initialize",
        sessionId,
        wrappedKey: wrapped.wrappedKey,
        wrapAlgorithm: wrapped.wrapAlgorithm,
        senderPublicKeyJwk: wrapped.senderPublicKeyJwk,
      })
      // A simultaneous initializer may have won. Always unwrap the canonical
      // envelope returned by the server, never retain a speculative key.
      session = await this.descriptor(projectId, sessionId)
    }
    const encryption = session.encryption
    if (encryption.status === "device_revoked") throw new Error("This device principal no longer has session access")
    if (encryption.status !== "ready") return null
    if (!encryption.wrappedRoomKey || !encryption.senderPublicKeyJwk || !encryption.wrapAlgorithm || !encryption.activeKeyVersion) {
      throw new Error("Encrypted session key is incomplete")
    }
    const { roomKeyBase64 } = await unwrapRoomKeyFromSender({
      wrappedKey: encryption.wrappedRoomKey,
      senderPublicKeyJwk: encryption.senderPublicKeyJwk,
      wrapAlgorithm: encryption.wrapAlgorithm,
    })
    if (Buffer.from(roomKeyBase64, "base64").length !== 32) throw new Error("Invalid session encryption key")
    await this.cache?.save(session)
    return { session, roomKeyBase64, keyVersion: encryption.activeKeyVersion }
  }

  versions(sessionId: string): Promise<number[]> {
    return this.cache?.versions(sessionId) ?? Promise.resolve([])
  }

  retireUnusedVersions(sessionId: string, currentVersion: number, versions: number[]): Promise<{ files: number; bytes: number }> {
    return this.cache?.retireUnusedVersions(sessionId, currentVersion, versions) ?? Promise.resolve({ files: 0, bytes: 0 })
  }

  async recoverKey(projectId: string, sessionId: string, keyVersion?: number): Promise<{
    roomKeyBase64: string
    keyVersion: number
    session: CollabSessionDescriptor
  } | null> {
    const identity = await ensureCollabDeviceIdentity()
    const value = await this.cache?.recover(projectId, sessionId, identity.identityKey, keyVersion)
    if (!value) return null
    const encryption = value.encryption
    if (!encryption.wrappedRoomKey || !encryption.senderPublicKeyJwk || !encryption.wrapAlgorithm || !encryption.activeKeyVersion) {
      throw new Error("Cached session key is incomplete")
    }
    const unwrapped = await unwrapRoomKeyFromSender({
      wrappedKey: encryption.wrappedRoomKey,
      senderPublicKeyJwk: encryption.senderPublicKeyJwk,
      wrapAlgorithm: encryption.wrapAlgorithm,
    })
    if (Buffer.from(unwrapped.roomKeyBase64, "base64").length !== 32) throw new Error("Cached session key is invalid")
    return {
      roomKeyBase64: unwrapped.roomKeyBase64,
      keyVersion: encryption.activeKeyVersion,
      session: {
        projectId,
        sessionId,
        roomId: value.roomId,
        principalId: value.principalId,
        identityKey: value.identityKey,
        encryption,
        protocolVersion: value.protocolVersion,
        collabWsUrl: value.collabWsUrl,
        token: "",
      },
    }
  }

  async supplyWaitingPrincipals(sessionId: string, roomKeyBase64: string, keyVersion: number): Promise<void> {
    const waiting = await this.gateway.post<Array<{
      principalId: string
      identityKey: string
      publicKeyJwk: string
      keyVersion: number
    }>>("/collab/v2/keys", { operation: "waitingPrincipals", sessionId, keyVersion })
    if (!Array.isArray(waiting) || waiting.length > 100) throw new Error("Invalid waiting-principal response")
    for (const recipient of waiting) {
      if (recipient.keyVersion !== keyVersion) throw new Error("Room key changed; reconnect before sharing principal access")
      const wrapped = await wrapRoomKeyForRecipient({ roomKeyBase64, recipientPublicKeyJwk: recipient.publicKeyJwk })
      await this.gateway.post("/collab/v2/keys", {
        operation: "share",
        sessionId,
        recipientPrincipalId: recipient.principalId,
        recipientIdentityKey: recipient.identityKey,
        keyVersion,
        wrappedKey: wrapped.wrappedKey,
        wrapAlgorithm: wrapped.wrapAlgorithm,
        senderPublicKeyJwk: wrapped.senderPublicKeyJwk,
      })
    }
  }

  rotationStatus(sessionId: string): Promise<RotationStatus> {
    return this.gateway.post("/collab/v2/keys", { operation: "rotationStatus", sessionId })
  }

  async prepareRotation(projectId: string, sessionId: string): Promise<{
    session: CollabSessionDescriptor
    roomKeyBase64: string
    keyVersion: number
  } | null> {
    const identity = await ensureCollabDeviceIdentity()
    const wrap = await wrapRoomKeyForRecipient({ roomKeyBase64: generateRoomKeyBase64(), recipientPublicKeyJwk: identity.publicKeyJwk })
    await this.gateway.post("/collab/v2/keys", {
      operation: "beginRotation",
      sessionId,
      wrappedKey: wrap.wrappedKey,
      wrapAlgorithm: wrap.wrapAlgorithm,
      senderPublicKeyJwk: wrap.senderPublicKeyJwk,
    })
    const status = await this.rotationStatus(sessionId)
    if (!status.required || !status.pendingKeyVersion || !status.wrappedRoomKey || !status.senderPublicKeyJwk || !status.wrapAlgorithm) return null
    const { roomKeyBase64 } = await unwrapRoomKeyFromSender({
      wrappedKey: status.wrappedRoomKey,
      senderPublicKeyJwk: status.senderPublicKeyJwk,
      wrapAlgorithm: status.wrapAlgorithm,
    })
    const session = await this.descriptor(projectId, sessionId)
    session.encryption = {
      ...session.encryption,
      status: "ready",
      activeKeyVersion: status.pendingKeyVersion,
      wrappedRoomKey: status.wrappedRoomKey,
      senderPublicKeyJwk: status.senderPublicKeyJwk,
      wrapAlgorithm: status.wrapAlgorithm,
    }
    await this.cache?.save(session, false)
    await this.supplyWaitingPrincipals(sessionId, roomKeyBase64, status.pendingKeyVersion)
    return { session, roomKeyBase64, keyVersion: status.pendingKeyVersion }
  }
}
''')

print("PR141 phase 7 principal-native generation-3 runtime contracts applied")
