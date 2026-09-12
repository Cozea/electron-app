import { BackgroundIdentityError } from "../identity/BackgroundIdentityError"
import { randomBytes } from "node:crypto"
import { ConvexHttpClient } from "convex/browser"
import { api } from "../../../../convex/_generated/api"
import type { ProjectdSessionTicket } from "@cozea/projectd-protocol"
import { BackgroundDeviceIdentityManager, type StoredDeviceIdentity } from "../identity/BackgroundDeviceIdentity"
import { unwrapSessionKey, wrapSessionKey } from "../identity/SessionRoomKeys"
import type { BackgroundSessionDescriptor } from "./BackgroundSessionStore"

export class BackgroundAccessDenied extends Error {
  readonly code: string
  constructor(message: string, code = "SESSION_ACCESS_DENIED") { super(message); this.code = code }
}
export type BackgroundSessionRequest = Omit<BackgroundSessionDescriptor, "ticket" | "roomKeyBase64">
export type BackgroundRecoveryRequest = Pick<BackgroundSessionRequest, "publicSessionId" | "projectId" | "background"> & { branchName?: string }
export type RecoveryAccessScope = "recovery" | "paused_close"
export interface BackgroundRecoveryAccess {
  publicSessionId: string
  ticket: ProjectdSessionTicket & { sessionAccess: RecoveryAccessScope }
  roomKeyBase64: string
  roomKeyVersion: number
  previousRoomKeysBase64: Record<string, string>
}

function readExistingKey(identity: StoredDeviceIdentity, wrapped: Parameters<typeof unwrapSessionKey>[1]): string {
  try { return unwrapSessionKey(identity, wrapped) } catch {
    throw new BackgroundAccessDenied("This device cannot decrypt the shared session key. Retry after verifying its key access with an authorized member. Retained local data has been kept.", "SESSION_KEY_UNREADABLE")
  }
}

/** Uses the device principal and wrapped keys, independently of Electron/React. */
export async function refreshBackgroundSession(
  descriptor: BackgroundSessionRequest,
  identity: StoredDeviceIdentity,
  manager: BackgroundDeviceIdentityManager,
): Promise<BackgroundSessionDescriptor> {
  return { ...descriptor, ...await resolveBackgroundSession(descriptor, identity, manager) }
}

/** Retrieves existing keys only. Recovery must never initialize or distribute keys. */
export async function getBackgroundRecoveryAccess(
  descriptor: BackgroundRecoveryRequest,
  identity: StoredDeviceIdentity,
  manager: BackgroundDeviceIdentityManager,
  scope: RecoveryAccessScope = "recovery",
): Promise<BackgroundRecoveryAccess> {
  const resolved = await resolveBackgroundSession(descriptor, identity, manager, scope)
  return { publicSessionId: resolved.publicSessionId, ticket: { ...resolved.ticket, sessionAccess: scope },
    roomKeyBase64: resolved.roomKeyBase64, roomKeyVersion: resolved.roomKeyVersion!,
    previousRoomKeysBase64: resolved.previousRoomKeysBase64 ?? {} }
}

async function authenticateSession(
  descriptor: BackgroundRecoveryRequest,
  identity: StoredDeviceIdentity,
  manager: BackgroundDeviceIdentityManager,
  frozen: boolean,
) {
  const { gatewayUrl, convexUrl } = descriptor.background
  for (const value of [gatewayUrl, convexUrl]) {
    const url = new URL(value)
    if (url.protocol !== "https:" && !(url.protocol === "http:" && url.hostname === "127.0.0.1")) {
      throw new Error("Background authentication requires a trusted HTTPS service")
    }
  }
  const auth = await manager.authenticateWithCloud(gatewayUrl, fetch, identity).catch((error: unknown) => {
    if (error instanceof BackgroundIdentityError && error.code === "DEVICE_AUTH_REJECTED") {
      throw new BackgroundAccessDenied(error.message, error.code)
    }
    throw error
  })
  const client = new ConvexHttpClient(convexUrl, {
    fetch: (input, init) => fetch(input, { ...init, redirect: "error", signal: AbortSignal.timeout(15_000) }),
  })
  client.setAuth(auth.token)
  const session = await client.query(api.collaborationSessions.getByPublicId, { publicSessionId: descriptor.publicSessionId })
  if (!session || (frozen ? !["PAUSED", "CLOSED"].includes(session.lifecycle) : session.lifecycle !== "ACTIVE")) {
    throw new BackgroundAccessDenied(frozen ? "Session has no retained recovery state" : "Session is no longer active")
  }
  if (String(session.projectId) !== descriptor.projectId || (descriptor.branchName !== undefined && session.branchName !== descriptor.branchName)) {
    throw new BackgroundAccessDenied("Session does not match this project and branch")
  }
  return { client, session, auth }
}

/** Explicit recovery action; never creates keys, joins a room, or changes lifecycle. */
export async function shareBackgroundRecoveryKeys(
  descriptor: BackgroundRecoveryRequest,
  identity: StoredDeviceIdentity,
  manager: BackgroundDeviceIdentityManager,
): Promise<{ shared: number }> {
  const { client, session } = await authenticateSession(descriptor, identity, manager, true)
  const sessionId = session._id
  const state = await client.query(api.collaborationSessions.getSessionKeyForDevice, { sessionId })
  if (state.status !== "ready") throw new BackgroundAccessDenied("This device does not hold the current session key. Ask a member who has it to share recovery keys.", "SESSION_KEY_MISSING")
  // Prove local possession too, before writing any wrapped copies.
  readExistingKey(identity, state)
  const keys = await client.query(api.collaborationSessions.getSessionKeyringForDevice, { sessionId })
  if (keys.activeKeyVersion !== state.keyVersion) throw new BackgroundAccessDenied("Session key changed. Retry sharing recovery keys.", "SESSION_KEY_CHANGED")
  const plaintext = keys.keys.map((key) => ({ keyVersion: key.keyVersion, value: readExistingKey(identity, key) }))
  let shared = 0
  for (const key of plaintext) {
    const recipients = await client.query(api.collaborationSessions.listMembersNeedingSessionKey, { sessionId, keyVersion: key.keyVersion })
    for (const recipient of recipients) {
      const wrapped = wrapSessionKey(identity, recipient.encryptionPublicKeyJwk, key.value)
      const result = await client.mutation(api.collaborationSessions.shareSessionKey, {
        sessionId, keyVersion: key.keyVersion, recipientPrincipalId: recipient.principalId,
        wrappedKey: wrapped.wrappedKey, wrapAlgorithm: wrapped.wrapAlgorithm,
      })
      if (result.shared) shared++
    }
  }
  return { shared }
}

async function resolveBackgroundSession(
  descriptor: BackgroundRecoveryRequest,
  identity: StoredDeviceIdentity,
  manager: BackgroundDeviceIdentityManager,
  scope?: RecoveryAccessScope,
) {
  const { client, session, auth } = await authenticateSession(descriptor, identity, manager, scope !== undefined)
  const { gatewayUrl } = descriptor.background
  const sessionId = session._id
  let state = await client.query(api.collaborationSessions.getSessionKeyForDevice, { sessionId })
  if (state.status === "not_initialized" && !scope) {
    const key = randomBytes(32).toString("base64")
    const wrapped = wrapSessionKey(identity, JSON.stringify(identity.publicKeyJwk), key)
    await client.mutation(api.collaborationSessions.initializeSessionKey, {
      sessionId, wrappedKey: wrapped.wrappedKey, wrapAlgorithm: wrapped.wrapAlgorithm,
    })
    state = await client.query(api.collaborationSessions.getSessionKeyForDevice, { sessionId })
  }
  if (state.status !== "ready") throw new BackgroundAccessDenied("Waiting for the current session key. Ask an authorized member with the key to share recovery keys for a paused or closed session, or open an active session, then retry. Retained local data has been kept.", "SESSION_KEY_MISSING")
  const keys = await client.query(api.collaborationSessions.getSessionKeyringForDevice, { sessionId })
  if (keys.activeKeyVersion !== state.keyVersion) throw new BackgroundAccessDenied("Session key changed during refresh. Retry to retrieve the current key.", "SESSION_KEY_CHANGED")
  const roomKeyBase64 = readExistingKey(identity, state)
  const previousRoomKeysBase64: Record<string, string> = {}
  for (const key of keys.keys) {
    if (key.keyVersion < keys.activeKeyVersion) previousRoomKeysBase64[String(key.keyVersion)] = readExistingKey(identity, key)
  }
  // Share old generations first: replay and binary revisions may predate rotation.
  // Each mutation rechecks both devices' active membership and the sender's keys.
  for (const key of scope ? [] : keys.keys) {
    const recipients = await client.query(api.collaborationSessions.listMembersNeedingSessionKey, {
      sessionId, keyVersion: key.keyVersion,
    })
    const plaintext = readExistingKey(identity, key)
    for (const recipient of recipients) {
      const wrapped = wrapSessionKey(identity, recipient.encryptionPublicKeyJwk, plaintext)
      await client.mutation(api.collaborationSessions.shareSessionKey, {
        sessionId, keyVersion: key.keyVersion, recipientPrincipalId: recipient.principalId,
        wrappedKey: wrapped.wrappedKey, wrapAlgorithm: wrapped.wrapAlgorithm,
      })
    }
  }
  const response = await fetch(`${gatewayUrl}/collab/sessions/connect`, {
    method: "POST", redirect: "error", signal: AbortSignal.timeout(15_000),
    headers: { "content-type": "application/json", authorization: `Bearer ${auth.token}` },
    body: JSON.stringify({ publicSessionId: descriptor.publicSessionId, clientType: "electron",
      ...(scope === "recovery" ? { recovery: true } : scope === "paused_close" ? { closePaused: true } : {}) }),
  })
  if (response.status === 401 || response.status === 403) throw new BackgroundAccessDenied("Session access was revoked or paused")
  if (!response.ok) throw new Error(`Session ticket refresh failed (${response.status})`)
  const ticket = await response.json() as ProjectdSessionTicket & { keyVersion: number; sessionAccess?: RecoveryAccessScope }
  if (ticket.sessionAccess !== scope) throw new BackgroundAccessDenied("Session ticket has the wrong access scope")
  if (ticket.keyVersion !== keys.activeKeyVersion) throw new BackgroundAccessDenied("Session key changed during ticket issuance. Retry to retrieve the current key.", "SESSION_KEY_CHANGED")
  return { publicSessionId: descriptor.publicSessionId, ticket, roomKeyBase64, roomKeyVersion: keys.activeKeyVersion, previousRoomKeysBase64,
    actor: { principalId: auth.principalId, identityKey: identity.identityKey },
    targetBranch: session.targetBranch, shareEnvironmentFiles: session.shareEnvironmentFiles === true,
    sessionStartedAt: session.createdAt,
  }
}
