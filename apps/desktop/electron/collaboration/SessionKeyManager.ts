import { ensureCollabDeviceIdentity, unwrapRoomKeyFromSender, wrapRoomKeyForRecipient } from "../collabKeys"
import { generateRoomKeyBase64 } from "../../../../shared/collaborationCipher"
import type { CollabSessionDescriptor } from "../../../../shared/CollaborationTransport"
import { DeviceCollaborationGateway } from "./DeviceCollaborationGateway"
import type { SessionKeyCache } from "./SessionKeyCache"

interface RotationStatus {
  required: boolean; currentKeyVersion: number | null; pendingKeyVersion: number | null
  wrappedRoomKey: string | null; senderPublicKeyJwk: string | null; wrapAlgorithm: string | null
}

export class SessionKeyManager {
  private readonly gateway: DeviceCollaborationGateway
  private readonly cache?: SessionKeyCache
  constructor(gateway: DeviceCollaborationGateway, cache?: SessionKeyCache) { this.gateway = gateway; this.cache = cache }

  async descriptor(projectId: string, sessionId: string): Promise<CollabSessionDescriptor> {
    const identity = await ensureCollabDeviceIdentity()
    const descriptor = await this.gateway.post<CollabSessionDescriptor>("/collab/v2/session", {
      projectId, sessionId, clientType: "electron", deviceId: identity.deviceId, deviceLabel: identity.deviceLabel,
      platform: identity.platform, publicKeyJwk: identity.publicKeyJwk, publicKeyAlgorithm: identity.publicKeyAlgorithm, fingerprint: identity.fingerprint,
    })
    if (descriptor.projectId !== projectId || descriptor.sessionId !== sessionId || descriptor.deviceId !== identity.deviceId || descriptor.encryption.roomId !== descriptor.roomId || !descriptor.encryption.encryptionRequired) throw new Error("Session encryption authority does not match this device")
    return descriptor
  }

  async ensure(projectId: string, sessionId: string, role: "editor" | "observer"): Promise<{ session: CollabSessionDescriptor; roomKeyBase64: string; keyVersion: number } | null> {
    let session = await this.descriptor(projectId, sessionId)
    if (session.encryption.status === "room_not_initialized" && role === "editor") {
      const identity = await ensureCollabDeviceIdentity()
      const wrapped = await wrapRoomKeyForRecipient({ roomKeyBase64: generateRoomKeyBase64(), recipientPublicKeyJwk: identity.publicKeyJwk })
      await this.gateway.post("/collab/v2/keys", { operation: "initialize", sessionId, wrappedKey: wrapped.wrappedKey, wrapAlgorithm: wrapped.wrapAlgorithm, senderPublicKeyJwk: wrapped.senderPublicKeyJwk })
      // A simultaneous initializer may have won. Always unwrap the canonical
      // device envelope returned by the server, never keep our speculative key.
      session = await this.descriptor(projectId, sessionId)
    }
    const encryption = session.encryption
    if (encryption.status === "device_revoked") throw new Error("This device no longer has session access")
    if (encryption.status !== "ready") return null
    if (!encryption.wrappedRoomKey || !encryption.senderPublicKeyJwk || !encryption.wrapAlgorithm || !encryption.activeKeyVersion) throw new Error("Encrypted session key is incomplete")
    const { roomKeyBase64 } = await unwrapRoomKeyFromSender({ wrappedKey: encryption.wrappedRoomKey, senderPublicKeyJwk: encryption.senderPublicKeyJwk, wrapAlgorithm: encryption.wrapAlgorithm })
    if (Buffer.from(roomKeyBase64, "base64").length !== 32) throw new Error("Invalid session encryption key")
    await this.cache?.save(session)
    return { session, roomKeyBase64, keyVersion: encryption.activeKeyVersion }
  }

  versions(sessionId: string): Promise<number[]> { return this.cache?.versions(sessionId) ?? Promise.resolve([]) }
  retireUnusedVersions(sessionId: string, currentVersion: number, versions: number[]): Promise<{ files: number; bytes: number }> {
    return this.cache?.retireUnusedVersions(sessionId, currentVersion, versions) ?? Promise.resolve({ files: 0, bytes: 0 })
  }
  async recoverKey(projectId: string, sessionId: string, keyVersion?: number): Promise<{ roomKeyBase64: string; keyVersion: number; session: CollabSessionDescriptor } | null> {
    const identity = await ensureCollabDeviceIdentity()
    const value = await this.cache?.recover(projectId, sessionId, identity.deviceId, keyVersion)
    if (!value) return null
    const encryption = value.encryption
    if (!encryption.wrappedRoomKey || !encryption.senderPublicKeyJwk || !encryption.wrapAlgorithm || !encryption.activeKeyVersion) throw new Error("Cached session key is incomplete")
    const unwrapped = await unwrapRoomKeyFromSender({ wrappedKey: encryption.wrappedRoomKey, senderPublicKeyJwk: encryption.senderPublicKeyJwk, wrapAlgorithm: encryption.wrapAlgorithm })
    if (Buffer.from(unwrapped.roomKeyBase64, "base64").length !== 32) throw new Error("Cached session key is invalid")
    return { roomKeyBase64: unwrapped.roomKeyBase64, keyVersion: encryption.activeKeyVersion,
      session: { projectId, sessionId, roomId: value.roomId, deviceId: value.deviceId, encryption, protocolVersion: value.protocolVersion, collabWsUrl: value.collabWsUrl, token: "" } }
  }

  async supplyWaitingDevices(sessionId: string, roomKeyBase64: string, keyVersion: number): Promise<void> {
    const waiting = await this.gateway.post<Array<{ userId: string; deviceId: string; publicKeyJwk: string; keyVersion: number }>>("/collab/v2/keys", { operation: "waitingDevices", sessionId, keyVersion })
    if (!Array.isArray(waiting) || waiting.length > 100) throw new Error("Invalid waiting-device response")
    for (const recipient of waiting) {
      if (recipient.keyVersion !== keyVersion) throw new Error("Room key changed; reconnect before sharing device access")
      const wrapped = await wrapRoomKeyForRecipient({ roomKeyBase64, recipientPublicKeyJwk: recipient.publicKeyJwk })
      await this.gateway.post("/collab/v2/keys", { operation: "share", sessionId, recipientUserId: recipient.userId, keyVersion, wrappedKey: wrapped.wrappedKey, wrapAlgorithm: wrapped.wrapAlgorithm, senderPublicKeyJwk: wrapped.senderPublicKeyJwk })
    }
  }

  rotationStatus(sessionId: string): Promise<RotationStatus> { return this.gateway.post("/collab/v2/keys", { operation: "rotationStatus", sessionId }) }

  async prepareRotation(projectId: string, sessionId: string): Promise<{ session: CollabSessionDescriptor; roomKeyBase64: string; keyVersion: number } | null> {
    const identity = await ensureCollabDeviceIdentity()
    const wrap = await wrapRoomKeyForRecipient({ roomKeyBase64: generateRoomKeyBase64(), recipientPublicKeyJwk: identity.publicKeyJwk })
    await this.gateway.post("/collab/v2/keys", { operation: "beginRotation", sessionId, wrappedKey: wrap.wrappedKey, wrapAlgorithm: wrap.wrapAlgorithm, senderPublicKeyJwk: wrap.senderPublicKeyJwk })
    const status = await this.rotationStatus(sessionId)
    if (!status.required || !status.pendingKeyVersion || !status.wrappedRoomKey || !status.senderPublicKeyJwk || !status.wrapAlgorithm) return null
    const { roomKeyBase64 } = await unwrapRoomKeyFromSender({ wrappedKey: status.wrappedRoomKey, senderPublicKeyJwk: status.senderPublicKeyJwk, wrapAlgorithm: status.wrapAlgorithm })
    const session = await this.descriptor(projectId, sessionId)
    session.encryption = { ...session.encryption, status: "ready", activeKeyVersion: status.pendingKeyVersion, wrappedRoomKey: status.wrappedRoomKey, senderPublicKeyJwk: status.senderPublicKeyJwk, wrapAlgorithm: status.wrapAlgorithm }
    // Retain this envelope before uploading anything encrypted with the new key;
    // the active offline key stays unchanged until server activation is verified.
    await this.cache?.save(session, false)
    await this.supplyWaitingDevices(sessionId, roomKeyBase64, status.pendingKeyVersion)
    return { session, roomKeyBase64, keyVersion: status.pendingKeyVersion }
  }
}
