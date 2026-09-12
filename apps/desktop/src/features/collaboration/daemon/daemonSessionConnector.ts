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

export interface DaemonSessionDeps {
  getSessionKey(sessionId: string): Promise<SessionKeyState>
  initializeSessionKey(input: { sessionId: string; wrapAlgorithm: string; wrappedKey: string }): Promise<{ created: boolean }>
  listMembersNeedingKey(sessionId: string): Promise<SessionKeyRecipient[]>
  shareSessionKey(input: {
    sessionId: string
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

/** The session's room key; this device creates it when it is the first writer to connect. */
export async function resolveSessionRoomKey(deps: DaemonSessionDeps, sessionId: string): Promise<string> {
  let state = await deps.getSessionKey(sessionId)
  if (state.status === "not_initialized") {
    const roomKeyBase64 = deps.generateRoomKeyBase64()
    const wrapped = await deps.wrapRoomKey({
      roomKeyBase64,
      recipientPublicKeyJwk: await deps.getOwnEncryptionPublicKeyJwk(),
    })
    const created = await deps
      .initializeSessionKey({ sessionId, wrapAlgorithm: wrapped.wrapAlgorithm, wrappedKey: wrapped.wrappedKey })
      .then((result) => result.created)
      // Viewers cannot create it; they wait for a writer like any device without a copy.
      .catch(() => false)
    if (created) return roomKeyBase64
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
  return roomKeyBase64
}

/** Wraps the room key for every member who has no copy yet; returns how many copies it shared. */
export async function shareSessionKeyWithMembers(
  deps: DaemonSessionDeps,
  sessionId: string,
  roomKeyBase64: string,
): Promise<number> {
  let shared = 0
  for (const recipient of await deps.listMembersNeedingKey(sessionId)) {
    const wrapped = await deps.wrapRoomKey({ roomKeyBase64, recipientPublicKeyJwk: recipient.encryptionPublicKeyJwk })
    await deps.shareSessionKey({
      sessionId,
      recipientPrincipalId: recipient.principalId,
      wrapAlgorithm: wrapped.wrapAlgorithm,
      wrappedKey: wrapped.wrappedKey,
    })
    shared += 1
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
}

export interface DaemonSessionConnection {
  readonly roomKeyBase64: string
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
): Promise<DaemonSessionConnection> {
  const roomKeyBase64 = await resolveSessionRoomKey(deps, target.sessionId)

  const refreshTicket = async () => {
    try {
      const ticket = await deps.requestTicket(target.publicSessionId)
      await deps.daemon.updateTicket(target.publicSessionId, ticket)
    } catch (error) {
      console.warn("[DaemonSession] Could not refresh the session room ticket", error)
    }
  }
  const unsubscribe = deps.daemon.onEvent((event) => {
    if (event.publicSessionId !== target.publicSessionId) return
    if (event.event === "status") onStatus?.(event.payload as ProjectdSessionStatus)
    if (event.event === "ticket_needed") void refreshTicket()
  })

  try {
    const ticket = await deps.requestTicket(target.publicSessionId)
    const result = await deps.daemon.attach({
      publicSessionId: target.publicSessionId,
      workspaceId: target.workspaceId,
      projectId: target.projectId,
      rootPath: target.rootPath,
      roomKeyBase64,
      ticket,
      actor: target.principalId ? { principalId: target.principalId } : undefined,
      ...(target.branchName ? { branchName: target.branchName } : {}),
      ...(target.shareEnvironmentFiles ? { shareEnvironmentFiles: true } : {}),
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
    stopListening: unsubscribe,
    disconnect: async () => {
      unsubscribe()
      await deps.daemon.detach(target.publicSessionId)
    },
  }
}
