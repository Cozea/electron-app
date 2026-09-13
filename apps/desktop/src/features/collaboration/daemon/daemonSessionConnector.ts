/**
 * Connects a live collaboration session to the cozea-projectd daemon (P10, P13).
 *
 * The app holds the device identity, so it supplies the two things the daemon
 * cannot get on its own: the session room key, unwrapped with this device's key,
 * and short-lived room tickets from the gateway. The daemon does the syncing.
 */

import type { ProjectdSessionStatus, ProjectdSessionTicket } from "@cozea/projectd-protocol"
import type { ElectronAPI } from "@shared/electronApiTypes"

export type SessionKeyState =
  | {
      status: "ready"
      keyVersion: number
      wrappedKey: string
      wrapAlgorithm: string
      senderPublicKeyJwk: string
    }
  | { status: "missing_for_device" | "not_initialized"; keyVersion: number }

export interface SessionKeyRecipient {
  principalId: string
  identityKey: string
  encryptionPublicKeyJwk: string
}

export interface SessionKeyringState {
  activeKeyVersion: number
  keys: Array<{
    keyVersion: number
    wrappedKey: string
    wrapAlgorithm: string
    senderPublicKeyJwk: string
  }>
}

export interface DaemonSessionDeps {
  getSessionKey(sessionId: string): Promise<SessionKeyState>
  getSessionKeyring(sessionId: string): Promise<SessionKeyringState>
  initializeSessionKey(input: { sessionId: string; wrapAlgorithm: string; wrappedKey: string }): Promise<{ created: boolean; keyVersion?: number }>
  listMembersNeedingKey(sessionId: string, keyVersion: number): Promise<SessionKeyRecipient[]>
  shareSessionKey(input: {
    sessionId: string
    keyVersion: number
    recipientPrincipalId: string
    wrapAlgorithm: string
    wrappedKey: string
  }): Promise<unknown>
  getOwnEncryptionPublicKeyJwk(): Promise<string>
  wrapRoomKey(input: { roomKeyBase64: string; recipientPublicKeyJwk: string }): Promise<{ wrappedKey: string; wrapAlgorithm: string }>
  unwrapRoomKey(input: { senderPublicKeyJwk: string; wrappedKey: string; wrapAlgorithm?: string }): Promise<{ roomKeyBase64: string }>
  generateRoomKeyBase64(): string
  requestTicket(publicSessionId: string): Promise<ProjectdSessionTicket>
  daemon: Pick<ElectronAPI["projectd"]["sessions"], "attach" | "detach" | "updateTicket" | "onEvent">
}

export class SessionKeyNotSharedError extends Error {
  constructor() {
    super("Waiting for a teammate who has the session key to share it with this device.")
    this.name = "SessionKeyNotSharedError"
  }
}

async function resolveCurrentSessionRoomKey(
  deps: DaemonSessionDeps,
  sessionId: string,
): Promise<{ roomKeyBase64: string; keyVersion: number }> {
  let state = await deps.getSessionKey(sessionId)
  if (state.status === "not_initialized") {
    const keyVersion = state.keyVersion
    const roomKeyBase64 = deps.generateRoomKeyBase64()
    const wrapped = await deps.wrapRoomKey({
      roomKeyBase64,
      recipientPublicKeyJwk: await deps.getOwnEncryptionPublicKeyJwk(),
    })
    const initialized = await deps
      .initializeSessionKey({ sessionId, wrapAlgorithm: wrapped.wrapAlgorithm, wrappedKey: wrapped.wrappedKey })
      // Viewers cannot create it; they wait for a writer like any device without a copy.
      .catch(() => ({ created: false as const }))
    if (initialized.created) return { roomKeyBase64, keyVersion: initialized.keyVersion ?? keyVersion }
    state = await deps.getSessionKey(sessionId)
  }
  if (state.status !== "ready") {
    throw new SessionKeyNotSharedError()
  }
  const { roomKeyBase64 } = await deps.unwrapRoomKey({
    senderPublicKeyJwk: state.senderPublicKeyJwk,
    wrappedKey: state.wrappedKey,
    wrapAlgorithm: state.wrapAlgorithm,
  })
  return { roomKeyBase64, keyVersion: state.keyVersion }
}

/** The session's current room key; this device creates it when it is the first writer to connect. */
export async function resolveSessionRoomKey(deps: DaemonSessionDeps, sessionId: string): Promise<string> {
  return (await resolveCurrentSessionRoomKey(deps, sessionId)).roomKeyBase64
}

export interface ResolvedSessionRoomKeys {
  roomKeyBase64: string
  roomKeyVersion: number
  previousRoomKeysBase64: Record<string, string>
}

/** Resolves the active key plus older generations this member retains for historical replay. */
export async function resolveSessionRoomKeys(deps: DaemonSessionDeps, sessionId: string): Promise<ResolvedSessionRoomKeys> {
  const current = await resolveCurrentSessionRoomKey(deps, sessionId)
  const keyring = await deps.getSessionKeyring(sessionId)
  if (keyring.activeKeyVersion !== current.keyVersion) {
    throw new SessionKeyNotSharedError()
  }
  const previousRoomKeysBase64: Record<string, string> = {}
  for (const key of keyring.keys) {
    if (key.keyVersion >= current.keyVersion) continue
    const unwrapped = await deps.unwrapRoomKey({
      senderPublicKeyJwk: key.senderPublicKeyJwk,
      wrappedKey: key.wrappedKey,
      wrapAlgorithm: key.wrapAlgorithm,
    })
    previousRoomKeysBase64[String(key.keyVersion)] = unwrapped.roomKeyBase64
  }
  return { roomKeyBase64: current.roomKeyBase64, roomKeyVersion: current.keyVersion, previousRoomKeysBase64 }
}

/** Wraps the room key for every member who has no copy yet; returns how many copies it shared. */
export async function shareSessionKeyWithMembers(
  deps: DaemonSessionDeps,
  sessionId: string,
): Promise<number> {
  let shared = 0
  const keyring = await deps.getSessionKeyring(sessionId)
  for (const key of [...keyring.keys].sort((a, b) => a.keyVersion - b.keyVersion)) {
    const { roomKeyBase64 } = await deps.unwrapRoomKey(key)
    for (const recipient of await deps.listMembersNeedingKey(sessionId, key.keyVersion)) {
      const wrapped = await deps.wrapRoomKey({ roomKeyBase64, recipientPublicKeyJwk: recipient.encryptionPublicKeyJwk })
      await deps.shareSessionKey({
        sessionId,
        keyVersion: key.keyVersion,
        recipientPrincipalId: recipient.principalId,
        wrapAlgorithm: wrapped.wrapAlgorithm,
        wrappedKey: wrapped.wrappedKey,
      })
      shared += 1
    }
  }
  return shared
}

export interface DaemonSessionTarget {
  sessionId: string
  publicSessionId: string
  projectId: string
  workspaceId: string
  rootPath: string
  principalId: string | null
  /** The session's branch: the daemon syncs the folder only while it is checked out, and saves to it. */
  branchName?: string | null
  /** Share env files (.env) through the session although Git ignores them. */
  shareEnvironmentFiles?: boolean
  /** The branch the session's work merges into; the daemon tracks how far it moved. */
  targetBranch?: string | null
  /** When the session started, in epoch milliseconds. */
  sessionStartedAt?: number | null
  /** Included in the effect identity so a rotation reconnects projectd immediately. */
  keyVersionHint?: number | null
}

export interface DaemonSessionConnection {
  readonly roomKeyBase64: string
  readonly roomKeyVersion: number
  /** Stops handling the session's daemon events, leaving the session attached. */
  stopListening(): void
  disconnect(): Promise<void>
}

/**
 * Attaches the folder to the session in the daemon and keeps its room ticket
 * fresh: the daemon asks for a new ticket whenever the current one expires.
 */
export async function connectDaemonSession(
  deps: DaemonSessionDeps,
  target: DaemonSessionTarget,
  onStatus?: (status: ProjectdSessionStatus) => void,
  onError?: (error: Error & { code?: string }) => void,
): Promise<DaemonSessionConnection> {
  const { roomKeyBase64, roomKeyVersion, previousRoomKeysBase64 } = await resolveSessionRoomKeys(deps, target.sessionId)

  let listening = true
  const refreshTicket = async () => {
    try {
      const ticket = await deps.requestTicket(target.publicSessionId)
      const result = await deps.daemon.updateTicket(target.publicSessionId, ticket)
      if (!result.success) throw Object.assign(new Error(result.error), { code: result.code })
    } catch (error) {
      const failure = error instanceof Error ? error : new Error("Could not refresh session access. Retry when the connection is available.")
      if (listening) onError?.(failure)
    }
  }
  const unsubscribeEvents = deps.daemon.onEvent((event) => {
    if (event.publicSessionId !== target.publicSessionId) return
    if (event.event === "status") onStatus?.(event.payload as ProjectdSessionStatus)
    if (event.event === "background_error") {
      const payload = event.payload as { message?: unknown; code?: unknown } | null
      if (payload && typeof payload.message === "string") {
        onError?.(Object.assign(new Error(payload.message), { code: typeof payload.code === "string" ? payload.code : undefined }))
      }
    }
    if (event.event === "ticket_needed") void refreshTicket()
  })

  const unsubscribe = () => { listening = false; unsubscribeEvents() }

  try {
    const ticket = await deps.requestTicket(target.publicSessionId)
    const result = await deps.daemon.attach({
      publicSessionId: target.publicSessionId,
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      rootPath: target.rootPath,
      roomKeyBase64,
      roomKeyVersion,
      previousRoomKeysBase64,
      ticket,
      actor: target.principalId ? { principalId: target.principalId } : undefined,
      ...(target.branchName ? { branchName: target.branchName } : {}),
      ...(target.shareEnvironmentFiles ? { shareEnvironmentFiles: true } : {}),
      ...(target.targetBranch ? { targetBranch: target.targetBranch } : {}),
      ...(target.sessionStartedAt ? { sessionStartedAt: target.sessionStartedAt } : {}),
    })
    if (!result.success) {
      throw new Error(result.error)
    }
    if (result.status) onStatus?.(result.status)
  } catch (error) {
    unsubscribe()
    throw error
  }

  return {
    roomKeyBase64,
    roomKeyVersion,
    stopListening: unsubscribe,
    disconnect: async () => {
      unsubscribe()
      await deps.daemon.detach(target.publicSessionId)
    },
  }
}
