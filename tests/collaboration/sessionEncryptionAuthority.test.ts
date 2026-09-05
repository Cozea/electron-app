import { beforeEach, describe, expect, it, vi } from "vitest"
import { initialize, share, waitingDevices } from "../../convex/collaborationEncryption"

const mocks = vi.hoisted(() => ({
  user: { _id: "alice", identityKey: "czd_alice", encryptionPublicKeyJwk: "public-alice" },
  authority: vi.fn(),
}))
vi.mock("../../convex/_generated/server", () => ({ query: (value: { handler: unknown }) => value.handler, mutation: (value: { handler: unknown }) => value.handler }))
vi.mock("../../convex/lib/deviceAuth", () => ({ requireAuthenticatedDevice: async () => mocks.user, isRegisteredDevicePrincipal: (user: { status?: string } | null) => user && user.status !== "revoked" }))
vi.mock("../../convex/collaborationRoomAuthorization", () => ({ authorizeCollaborationParticipant: mocks.authority }))
function wrap(sender = "czd_alice") {
  return { senderPublicKeyJwk: "public-alice", wrapAlgorithm: "ECDH-P256+A256GCM", wrappedKey: JSON.stringify({ v: 1, alg: "ECDH-P256+A256GCM", iv: Buffer.alloc(12).toString("base64"), ciphertext: Buffer.alloc(48).toString("base64"), aad: Buffer.from(JSON.stringify({ senderDeviceId: sender })).toString("base64") }) }
}
function fixture() {
  const records: Array<Record<string, unknown>> = []
  const ctx = { db: {
    get: async (id: string) => ({ _id: id, identityKey: `czd_${id}`, encryptionPublicKeyJwk: `public-${id}` }),
    insert: vi.fn(async (table: string, value: Record<string, unknown>) => { records.push({ table, ...value }); return "id" }),
    query: (table: string) => ({ withIndex: (_index: string, filter: (q: { eq: (key: string, value: unknown) => unknown }) => unknown) => {
      const conditions: Record<string, unknown> = {}
      const q = { eq: (key: string, value: unknown) => { conditions[key] = value; return q } }; filter(q)
      const result = () => records.filter(row => row.table === table && Object.entries(conditions).every(([key, value]) => row[key] === value))
      return { collect: async () => result(), take: async (count: number) => result().slice(0, count) }
    } }),
  } }
  return { ctx, records }
}
const invoke = (fn: unknown, ctx: unknown, args: unknown): Promise<unknown> => (fn as (ctx: unknown, args: unknown) => Promise<unknown>)(ctx, args)
const authority = { allowed: true, role: "editor", keyVersion: 1, projectId: "p", roomId: "session:s", sessionDocumentId: "sdoc" }
beforeEach(() => { vi.clearAllMocks(); mocks.authority.mockResolvedValue(authority) })

describe("session-bound device key authority", () => {
  it("denies observers and forged wrapping identities without storing keys", async () => {
    const f = fixture()
    mocks.authority.mockResolvedValue({ ...authority, keyVersion: null, role: "observer" })
    await expect(invoke(initialize, f.ctx, { sessionId: "s", ...wrap() })).rejects.toThrow("editor")
    mocks.authority.mockResolvedValue({ ...authority, keyVersion: null })
    await expect(invoke(initialize, f.ctx, { sessionId: "s", ...wrap("czd_impostor") })).rejects.toThrow("sender")
    expect(f.ctx.db.insert).not.toHaveBeenCalled()
  })

  it("creates the initializer's device envelope without touching legacy project data", async () => {
    const f = fixture(); mocks.authority.mockResolvedValue({ ...authority, keyVersion: null })
    expect(await invoke(initialize, f.ctx, { sessionId: "s", ...wrap() })).toEqual({ created: true, keyVersion: 1 })
    expect(f.records).toHaveLength(2)
    expect(f.records[1]).toMatchObject({ recipientUserId: "alice", recipientDeviceId: "czd_alice", roomId: "session:s" })
    mocks.authority.mockResolvedValue(authority)
    expect(await invoke(initialize, f.ctx, { sessionId: "s", ...wrap() })).toEqual({ created: false, keyVersion: 1 })
    expect(f.records).toHaveLength(2)
  })

  it("requires the sender to hold the current key and rechecks the recipient at sharing time", async () => {
    const f = fixture()
    await expect(invoke(share, f.ctx, { sessionId: "s", recipientUserId: "bob", keyVersion: 1, ...wrap() })).rejects.toThrow("holding")
    f.records.push({ table: "projectCollabWrappedKeys", projectId: "p", roomId: "session:s", recipientDeviceId: "czd_alice", keyVersion: 1 })
    mocks.authority.mockImplementation(async (_ctx: unknown, userId: string) => userId === "bob" ? { allowed: false } : authority)
    await expect(invoke(share, f.ctx, { sessionId: "s", recipientUserId: "bob", keyVersion: 1, ...wrap() })).rejects.toThrow("membership")
    expect(f.ctx.db.insert).not.toHaveBeenCalled()
    mocks.authority.mockResolvedValue(authority)
    await expect(invoke(share, f.ctx, { sessionId: "s", recipientUserId: "bob", keyVersion: 2, ...wrap() })).rejects.toThrow("current")
    await expect(invoke(share, f.ctx, { sessionId: "s", recipientUserId: "bob", keyVersion: 1, ...wrap() })).resolves.toEqual({ stored: true })
    await expect(invoke(share, f.ctx, { sessionId: "s", recipientUserId: "bob", keyVersion: 1, ...wrap() })).resolves.toEqual({ stored: false })
  })

  it("does not expose waiting-device keys to observers", async () => {
    const f = fixture(); mocks.authority.mockResolvedValue({ ...authority, role: "observer" })
    expect(await invoke(waitingDevices, f.ctx, { sessionId: "s" })).toEqual([])
  })
})
