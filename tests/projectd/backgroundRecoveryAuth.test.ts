import { randomBytes } from "node:crypto"
import { expect, it, vi } from "vitest"
import { getFunctionName } from "convex/server"
import { BackgroundIdentityError } from "../../apps/projectd/src/identity/BackgroundIdentityError"
import { BackgroundDeviceIdentityManager } from "../../apps/projectd/src/identity/BackgroundDeviceIdentity"
import { unwrapSessionKey, wrapSessionKey } from "../../apps/projectd/src/identity/SessionRoomKeys"
import { BackgroundAccessDenied, shareBackgroundRecoveryKeys, getBackgroundRecoveryAccess, refreshBackgroundSession, type BackgroundSessionRequest } from "../../apps/projectd/src/collaboration/BackgroundSessionAuth"

const cloud = vi.hoisted(() => ({ query: vi.fn(), mutation: vi.fn() }))
vi.mock("convex/browser", () => ({ ConvexHttpClient: class {
  setAuth(): void {}
  query = cloud.query
  mutation = cloud.mutation
} }))

it("recovers existing key generations without initializing or sharing keys and requires the exact ticket scope", async () => {
  const manager = new BackgroundDeviceIdentityManager()
  const identity = await manager.generateNewIdentity()
  const auth = vi.spyOn(manager, "authenticateWithCloud").mockResolvedValue({ token: "device-token", principalId: "principal", expiresAt: Date.now() + 60_000 })
  const request: BackgroundSessionRequest = { publicSessionId: "czs_0123456789abcdef", projectId: "project", branchName: "session-branch",
    workspaceId: "workspace", rootPath: "/unused/recovery", background: { gatewayUrl: "https://gateway.example", convexUrl: "https://example.convex.cloud" } }
  const keys = [1, 2].map((keyVersion) => {
    const plaintext = randomBytes(32).toString("base64")
    return { plaintext, keyVersion, ...wrapSessionKey(identity, JSON.stringify(identity.publicKeyJwk), plaintext) }
  })
  let lifecycle = "PAUSED"
  let missingKey = false
  cloud.query.mockImplementation(async (reference) => {
    switch (getFunctionName(reference)) {
      case "collaborationSessions:getByPublicId": return { _id: "session", projectId: "project", branchName: "session-branch", lifecycle }
      case "collaborationSessions:getSessionKeyForDevice": return missingKey ? { status: "not_initialized" } : { status: "ready", ...keys[1] }
      case "collaborationSessions:getSessionKeyringForDevice": return { activeKeyVersion: 2, keys }
      default: throw new Error("Recovery queried a key-sharing operation")
    }
  })
  let wrongScope = false
  const fetcher = vi.fn(async (_input: unknown, init?: RequestInit) => {
    const body = JSON.parse(String(init?.body)) as { recovery?: boolean; closePaused?: boolean }
    return Response.json({ wsUrl: "wss://gateway.example/collab/sessions/ws", token: "scoped-token", keyVersion: 2,
      role: "project_manager", sessionAccess: wrongScope ? undefined : body.closePaused ? "paused_close" : "recovery" })
  })
  vi.stubGlobal("fetch", fetcher)
  try {
    for (const scope of ["recovery", "paused_close"] as const) {
      const result = await getBackgroundRecoveryAccess(request, identity, manager, scope)
      expect(result).toMatchObject({ ticket: { sessionAccess: scope }, roomKeyBase64: keys[1].plaintext,
        roomKeyVersion: 2, previousRoomKeysBase64: { 1: keys[0].plaintext } })
      expect(result).not.toHaveProperty("rootPath")
      expect(JSON.parse(String(fetcher.mock.calls.at(-1)?.[1]?.body))).toMatchObject(
        scope === "recovery" ? { recovery: true } : { closePaused: true })
    }
    await expect(refreshBackgroundSession(request, identity, manager)).rejects.toThrow(/no longer active/)
    // Cloud recovery does not need a local workspace, branch, or descriptor.
    const cloudOnly = { publicSessionId: request.publicSessionId, projectId: request.projectId, background: request.background }
    await expect(getBackgroundRecoveryAccess(cloudOnly, identity, manager)).resolves.toMatchObject({ roomKeyVersion: 2 })
    await expect(getBackgroundRecoveryAccess({ ...cloudOnly, projectId: "another-project" }, identity, manager)).rejects.toThrow(/does not match/)
    const originalWrappedKey = keys[1].wrappedKey
    keys[1].wrappedKey = "invalid secret envelope"
    await expect(getBackgroundRecoveryAccess(cloudOnly, identity, manager)).rejects.toMatchObject({
      code: "SESSION_KEY_UNREADABLE", message: expect.not.stringContaining("secret envelope"),
    })
    keys[1].wrappedKey = originalWrappedKey
    lifecycle = "CLOSED"
    await expect(getBackgroundRecoveryAccess(request, identity, manager)).resolves.toMatchObject({ roomKeyVersion: 2 })
    wrongScope = true
    await expect(getBackgroundRecoveryAccess(request, identity, manager)).rejects.toThrow(/wrong access scope/)
    missingKey = true
    const before = fetcher.mock.calls.length
    await expect(getBackgroundRecoveryAccess(request, identity, manager)).rejects.toMatchObject({ code: "SESSION_KEY_MISSING", message: expect.stringContaining("Waiting for the current session key") })
    expect(fetcher).toHaveBeenCalledTimes(before)
    lifecycle = "ACTIVE"
    await expect(getBackgroundRecoveryAccess(request, identity, manager)).rejects.toThrow(/no retained recovery state/)
    expect(cloud.mutation).not.toHaveBeenCalled()
    auth.mockRejectedValueOnce(new BackgroundIdentityError("DEVICE_AUTH_REJECTED", "Device rejected"))
    await expect(getBackgroundRecoveryAccess(request, identity, manager)).rejects.toBeInstanceOf(BackgroundAccessDenied)
  } finally {
    auth.mockRestore()
    vi.unstubAllGlobals()
    cloud.query.mockReset()
    cloud.mutation.mockReset()
  }
})


it("explicitly shares existing frozen-session generations without tickets, initialization, or a local descriptor", async () => {
  const manager = new BackgroundDeviceIdentityManager()
  const identity = await manager.generateNewIdentity()
  const recipient = await manager.generateNewIdentity()
  const auth = vi.spyOn(manager, "authenticateWithCloud").mockResolvedValue({ token: "token", principalId: "sender", expiresAt: Date.now() + 60_000 })
  const keys = [1, 2].map((keyVersion) => {
    const plaintext = randomBytes(32).toString("base64")
    return { keyVersion, plaintext, ...wrapSessionKey(identity, JSON.stringify(identity.publicKeyJwk), plaintext) }
  })
  let lifecycle = "CLOSED"
  let activeKeyVersion = 2
  let missing = false
  const delivered = new Map<number, string>()
  cloud.query.mockImplementation(async (reference, args) => {
    switch (getFunctionName(reference)) {
      case "collaborationSessions:getByPublicId": return { _id: "session", projectId: "project", lifecycle }
      case "collaborationSessions:getSessionKeyForDevice": return missing ? { status: "missing_for_device" } : { status: "ready", ...keys[1] }
      case "collaborationSessions:getSessionKeyringForDevice": return { activeKeyVersion, keys }
      case "collaborationSessions:listMembersNeedingSessionKey": return delivered.has(args.keyVersion) ? [] : [{ principalId: "recipient", encryptionPublicKeyJwk: JSON.stringify(recipient.publicKeyJwk) }]
      default: throw new Error("Unexpected recovery query")
    }
  })
  cloud.mutation.mockImplementation(async (reference, args) => {
    expect(getFunctionName(reference)).toBe("collaborationSessions:shareSessionKey")
    expect(args.recipientPrincipalId).toBe("recipient")
    delivered.set(args.keyVersion, unwrapSessionKey(recipient, { ...args, senderPublicKeyJwk: JSON.stringify(identity.publicKeyJwk) }))
    return { shared: true }
  })
  const fetcher = vi.fn(() => { throw new Error("Key sharing must not request a room ticket") })
  vi.stubGlobal("fetch", fetcher)
  const request = { publicSessionId: "czs_0123456789abcdef", projectId: "project", background: { gatewayUrl: "https://gateway.example", convexUrl: "https://example.convex.cloud" } }
  try {
    await expect(shareBackgroundRecoveryKeys(request, identity, manager)).resolves.toEqual({ shared: 2 })
    expect([...delivered.entries()]).toEqual(keys.map((key) => [key.keyVersion, key.plaintext]))
    await expect(shareBackgroundRecoveryKeys(request, identity, manager)).resolves.toEqual({ shared: 0 })
    activeKeyVersion = 3
    await expect(shareBackgroundRecoveryKeys(request, identity, manager)).rejects.toMatchObject({ code: "SESSION_KEY_CHANGED" })
    activeKeyVersion = 2
    missing = true
    await expect(shareBackgroundRecoveryKeys(request, identity, manager)).rejects.toMatchObject({ code: "SESSION_KEY_MISSING" })
    lifecycle = "ACTIVE"
    await expect(shareBackgroundRecoveryKeys(request, identity, manager)).rejects.toThrow(/no retained recovery state/)
    expect(cloud.mutation).toHaveBeenCalledTimes(2)
    expect(fetcher).not.toHaveBeenCalled()
  } finally {
    auth.mockRestore()
    vi.unstubAllGlobals()
    cloud.query.mockReset()
    cloud.mutation.mockReset()
  }
})
