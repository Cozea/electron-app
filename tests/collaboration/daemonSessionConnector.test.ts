import { describe, expect, it, vi } from "vitest"

import type { ProjectdSessionStatus } from "@cozea/projectd-protocol"
import type { ProjectdSessionEvent } from "@shared/electronApiTypes"

import {
  SessionKeyNotSharedError,
  connectDaemonSession,
  resolveSessionRoomKey,
  shareSessionKeyWithMembers,
  type DaemonSessionDeps,
  type SessionKeyState,
} from "../../apps/desktop/src/features/collaboration/daemon/daemonSessionConnector"

const TICKET = { wsUrl: "wss://gateway.test/collab/sessions/ws?sessionId=czs_0123456789abcdef", token: "t1", role: "developer" as const }
const TARGET = {
  sessionId: "session_1",
  publicSessionId: "czs_0123456789abcdef",
  projectId: "project_1",
  workspaceId: "workspace_1",
  rootPath: "/Users/dev/project",
  principalId: "principal_me",
}

function statusFor(state: ProjectdSessionStatus["state"]): ProjectdSessionStatus {
  return {
    publicSessionId: TARGET.publicSessionId,
    workspaceId: TARGET.workspaceId,
    rootPath: TARGET.rootPath,
    state,
    role: "developer",
    lastAppliedSessionSeq: 0,
    pendingBatches: 0,
    pendingBinaryVersions: 0,
    fileCount: 0,
    skippedPaths: [],
    lastError: null,
    updatedAt: 0,
  }
}

function createDeps(keyStates: SessionKeyState[]) {
  const listeners = new Set<(event: ProjectdSessionEvent) => void>()
  const deps = {
    getSessionKey: vi.fn(async () => keyStates.shift() ?? { status: "missing_for_device" as const, keyVersion: 1 }),
    getSessionKeyring: vi.fn(async () => ({
      activeKeyVersion: 1,
      keys: [{ keyVersion: 1, wrappedKey: "w", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" }],
    })),
    initializeSessionKey: vi.fn(async () => ({ created: true })),
    listMembersNeedingKey: vi.fn(async () => [
      { principalId: "principal_a", identityKey: "czd_a", encryptionPublicKeyJwk: '{"kty":"EC","x":"a"}' },
      { principalId: "principal_b", identityKey: "czd_b", encryptionPublicKeyJwk: '{"kty":"EC","x":"b"}' },
    ]),
    shareSessionKey: vi.fn(async () => ({ shared: true })),
    getOwnEncryptionPublicKeyJwk: vi.fn(async () => '{"kty":"EC","x":"me"}'),
    wrapRoomKey: vi.fn(async (input: { roomKeyBase64: string; recipientPublicKeyJwk: string }) => ({
      wrappedKey: `wrapped(${input.roomKeyBase64} for ${input.recipientPublicKeyJwk})`,
      wrapAlgorithm: "ECDH-P256+A256GCM",
    })),
    unwrapRoomKey: vi.fn(async () => ({ roomKeyBase64: "shared-room-key" })),
    generateRoomKeyBase64: vi.fn(() => "fresh-room-key"),
    requestTicket: vi.fn(async () => TICKET),
    daemon: {
      attach: vi.fn(async () => ({ success: true as const, status: statusFor("starting") })),
      detach: vi.fn(async () => ({ success: true as const, detached: true })),
      updateTicket: vi.fn(async () => ({ success: true as const, status: statusFor("live") })),
      onEvent: vi.fn((listener: (event: ProjectdSessionEvent) => void) => {
        listeners.add(listener)
        return () => {
          listeners.delete(listener)
        }
      }),
    },
  } satisfies DaemonSessionDeps
  const emit = (event: ProjectdSessionEvent) => {
    for (const listener of listeners) listener(event)
  }
  return { deps, emit, listeners }
}

describe("resolveSessionRoomKey", () => {
  it("creates the key and wraps a copy for this device when the session has none", async () => {
    const { deps } = createDeps([{ status: "not_initialized", keyVersion: 1 }])

    expect(await resolveSessionRoomKey(deps, "session_1")).toBe("fresh-room-key")
    expect(deps.wrapRoomKey).toHaveBeenCalledWith({ roomKeyBase64: "fresh-room-key", recipientPublicKeyJwk: '{"kty":"EC","x":"me"}' })
    expect(deps.initializeSessionKey).toHaveBeenCalledWith({
      sessionId: "session_1",
      wrapAlgorithm: "ECDH-P256+A256GCM",
      wrappedKey: 'wrapped(fresh-room-key for {"kty":"EC","x":"me"})',
    })
  })

  it("uses the key another device created first", async () => {
    const { deps } = createDeps([
      { status: "not_initialized", keyVersion: 1 },
      { status: "ready", keyVersion: 1, wrappedKey: "w", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
    ])
    deps.initializeSessionKey.mockResolvedValueOnce({ created: false })

    expect(await resolveSessionRoomKey(deps, "session_1")).toBe("shared-room-key")
    expect(deps.unwrapRoomKey).toHaveBeenCalledWith({ senderPublicKeyJwk: "{}", wrappedKey: "w", wrapAlgorithm: "ECDH-P256+A256GCM" })
  })

  it("waits for a teammate when the key exists but this device has no copy", async () => {
    const { deps } = createDeps([{ status: "missing_for_device", keyVersion: 1 }])
    await expect(resolveSessionRoomKey(deps, "session_1")).rejects.toBeInstanceOf(SessionKeyNotSharedError)
    expect(deps.initializeSessionKey).not.toHaveBeenCalled()
  })
})

describe("shareSessionKeyWithMembers", () => {
  it("wraps the key for each member's own public key", async () => {
    const { deps } = createDeps([])

    expect(await shareSessionKeyWithMembers(deps, "session_1")).toBe(2)
    expect(deps.shareSessionKey).toHaveBeenCalledWith({
      sessionId: "session_1",
      keyVersion: 1,
      recipientPrincipalId: "principal_b",
      wrapAlgorithm: "ECDH-P256+A256GCM",
      wrappedKey: 'wrapped(shared-room-key for {"kty":"EC","x":"b"})',
    })
  })
})

describe("connectDaemonSession", () => {
  it("attaches the folder with the key and a ticket, and refreshes the ticket on request", async () => {
    const { deps, emit, listeners } = createDeps([
      { status: "ready", keyVersion: 1, wrappedKey: "w", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
    ])
    const statuses: string[] = []

    const connection = await connectDaemonSession(deps, TARGET, (status) => statuses.push(status.state))
    expect(deps.daemon.attach).toHaveBeenCalledWith({
      publicSessionId: TARGET.publicSessionId,
      workspaceId: TARGET.workspaceId,
      projectId: TARGET.projectId,
      rootPath: TARGET.rootPath,
      roomKeyBase64: "shared-room-key",
      roomKeyVersion: 1,
      previousRoomKeysBase64: {},
      ticket: TICKET,
      actor: { principalId: "principal_me" },
    })

    emit({ publicSessionId: TARGET.publicSessionId, event: "status", payload: statusFor("live") })
    emit({ publicSessionId: "czs_ffffffffffffffff", event: "status", payload: statusFor("failed") })
    emit({ publicSessionId: TARGET.publicSessionId, event: "ticket_needed", payload: {} })
    await vi.waitFor(() => expect(deps.daemon.updateTicket).toHaveBeenCalledWith(TARGET.publicSessionId, TICKET))
    expect(statuses).toEqual(["starting", "live"])

    await connection.disconnect()
    expect(deps.daemon.detach).toHaveBeenCalledWith(TARGET.publicSessionId)
    expect(listeners.size).toBe(0)
  })

  it("forwards scoped background failures and rejected ticket updates without dropping recovery codes", async () => {
    const { deps, emit } = createDeps([
      { status: "ready", keyVersion: 1, wrappedKey: "w", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
    ])
    const failures = vi.fn()
    const connection = await connectDaemonSession(deps, TARGET, undefined, failures)
    emit({ publicSessionId: "czs_ffffffffffffffff", event: "background_error", payload: { code: "SESSION_KEY_MISSING", message: "wrong session" } })
    expect(failures).not.toHaveBeenCalled()
    emit({ publicSessionId: TARGET.publicSessionId, event: "background_error", payload: {
      code: "SESSION_KEY_MISSING", message: "Ask an authorized member to share the current key.",
    } })
    expect(failures).toHaveBeenLastCalledWith(expect.objectContaining({ code: "SESSION_KEY_MISSING", message: expect.stringContaining("current key") }))
    deps.daemon.updateTicket.mockResolvedValueOnce({ success: false, code: "DEVICE_AUTH_REJECTED", error: "Verify device access" } as never)
    emit({ publicSessionId: TARGET.publicSessionId, event: "ticket_needed", payload: {} })
    await vi.waitFor(() => expect(failures).toHaveBeenLastCalledWith(expect.objectContaining({ code: "DEVICE_AUTH_REJECTED" })))
    connection.stopListening()
    emit({ publicSessionId: TARGET.publicSessionId, event: "background_error", payload: { code: "KEYCHAIN_UNAVAILABLE", message: "Unlock" } })
    expect(failures).toHaveBeenCalledTimes(2)
  })

  it("passes older authorized keys to projectd so a rotated session can replay historical batches", async () => {
    const { deps } = createDeps([
      { status: "ready", keyVersion: 2, wrappedKey: "w2", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
      { status: "ready", keyVersion: 2, wrappedKey: "w2", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
    ])
    deps.getSessionKeyring.mockResolvedValueOnce({
      activeKeyVersion: 2,
      keys: [
        { keyVersion: 1, wrappedKey: "w1", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
        { keyVersion: 2, wrappedKey: "w2", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
      ],
    })
    deps.unwrapRoomKey
      .mockResolvedValueOnce({ roomKeyBase64: "current-key" })
      .mockResolvedValueOnce({ roomKeyBase64: "old-key" })

    await connectDaemonSession(deps, TARGET)
    expect(deps.daemon.attach).toHaveBeenCalledWith(
      expect.objectContaining({
        roomKeyBase64: "current-key",
        roomKeyVersion: 2,
        previousRoomKeysBase64: { "1": "old-key" },
      }),
    )
  })

  it("names the session branch, so the daemon pauses the folder off it and saves to it", async () => {
    const { deps } = createDeps([
      { status: "ready", keyVersion: 1, wrappedKey: "w", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
    ])

    await connectDaemonSession(deps, { ...TARGET, branchName: "feat/live" })
    expect(deps.daemon.attach).toHaveBeenCalledWith(expect.objectContaining({ branchName: "feat/live" }))
  })

  it("tells the daemon when the session shares env files", async () => {
    const { deps } = createDeps([
      { status: "ready", keyVersion: 1, wrappedKey: "w", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
    ])

    await connectDaemonSession(deps, { ...TARGET, shareEnvironmentFiles: true })
    expect(deps.daemon.attach).toHaveBeenCalledWith(expect.objectContaining({ shareEnvironmentFiles: true }))
  })

  it("reports a daemon that is not running and stops listening", async () => {
    const { deps, listeners } = createDeps([
      { status: "ready", keyVersion: 1, wrappedKey: "w", wrapAlgorithm: "ECDH-P256+A256GCM", senderPublicKeyJwk: "{}" },
    ])
    deps.daemon.attach.mockResolvedValueOnce({ success: false, error: "connect ENOENT /tmp/cozea-projectd-501.sock" } as never)

    await expect(connectDaemonSession(deps, TARGET)).rejects.toThrow(/ENOENT/)
    expect(listeners.size).toBe(0)
  })
})
