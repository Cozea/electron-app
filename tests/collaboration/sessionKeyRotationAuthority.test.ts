import { beforeEach, afterEach, expect, it, vi } from "vitest"
import { authorizeCollaborationParticipant } from "../../convex/collaborationRoomAuthorization"
import { activateRotationFromServer, beginRotation, rotationCheckpointAuthorityForServer, share } from "../../convex/collaborationEncryption"
import type { QueryCtx } from "../../convex/_generated/server"
import type { Id } from "../../convex/_generated/dataModel"

const mocks = vi.hoisted(() => ({ user: { _id: "alice", identityKey: "czd_alice", encryptionPublicKeyJwk: "public-alice" }, access: new Set(["alice", "bob", "carol"]) }))
vi.mock("../../convex/_generated/server", () => ({ query: (x: { handler: unknown }) => x.handler, mutation: (x: { handler: unknown }) => x.handler }))
vi.mock("../../convex/lib/deviceAuth", () => ({ requireAuthenticatedDevice: async () => mocks.user, isRegisteredDevicePrincipal: (user: { status?: string } | null) => Boolean(user && user.status !== "revoked") }))
vi.mock("../../convex/lib/projectAccess", () => ({ canAccessProject: async (_ctx: unknown, _project: unknown, user: string) => mocks.access.has(user), canEditProject: async () => true, canManageProject: async () => true }))
const invoke = (fn: unknown, ctx: unknown, args: unknown): Promise<unknown> => (fn as (ctx: unknown, args: unknown) => Promise<unknown>)(ctx, args)
interface Row { _id: string; [key: string]: unknown }
function fixture() {
  const rows: Record<string, Row[]> = {
    users: ["alice", "bob", "carol"].map(id => ({ _id: id, identityKey: `czd_${id}`, encryptionPublicKeyJwk: `public-${id}` })),
    collaborationSessions: [{ _id: "session", sessionId: "s", projectId: "p", repositoryId: "github:1", generation: 3, status: "active", revision: 1 }],
    collaborationParticipants: ["alice", "bob", "carol"].map(id => ({ _id: `participant-${id}`, sessionId: "session", userId: id, role: "editor" })),
    collaborationRepositoryBindings: [{ _id: "binding", projectId: "p", repositoryId: "github:1", repositoryNumericId: "1", organizationId: "org", installationId: "install", enabled: true }],
    collaborationVerifiedRepositories: [{ _id: "repo", organizationId: "org", repositoryNumericId: "1", installationId: "install", verifiedAt: 1 }],
    projectCollabRoomKeys: [{ _id: "key-1", projectId: "p", roomId: "session:s", keyVersion: 1, status: "active" }],
    projectCollabWrappedKeys: ["alice", "bob"].map(id => ({ _id: `wrap-${id}`, projectId: "p", roomId: "session:s", keyVersion: 1, recipientUserId: id, recipientDeviceId: `czd_${id}` })),
  }
  const get = (id: string) => Object.values(rows).flat().find(row => row._id === id) ?? null
  const ctx = { db: {
    get: async (id: string) => get(id),
    patch: async (id: string, value: Record<string, unknown>) => Object.assign(get(id)!, value),
    insert: async (table: string, value: Record<string, unknown>) => { const id = `new-${Object.values(rows).flat().length}`; (rows[table] ??= []).push({ _id: id, ...value }); return id },
    query: (table: string) => ({ withIndex: (_name: string, filter: (q: { eq: (key: string, value: unknown) => unknown }) => unknown) => {
      const matches: Record<string, unknown> = {}; const q = { eq: (key: string, value: unknown) => { matches[key] = value; return q } }; filter(q)
      const selected = () => (rows[table] ?? []).filter(row => Object.entries(matches).every(([key, value]) => row[key] === value))
      return { unique: async () => selected()[0] ?? null, collect: async () => selected(), take: async (count: number) => selected().slice(0, count) }
    } }),
  } } as unknown as QueryCtx
  const authority = (user = "alice") => authorizeCollaborationParticipant(ctx, user as Id<"users">, "s")
  const wrap = { senderPublicKeyJwk: "public-alice", wrapAlgorithm: "ECDH-P256+A256GCM", wrappedKey: JSON.stringify({ v: 1, alg: "ECDH-P256+A256GCM", iv: Buffer.alloc(12).toString("base64"), ciphertext: Buffer.alloc(48).toString("base64"), aad: Buffer.from(JSON.stringify({ senderDeviceId: "czd_alice" })).toString("base64") }) }
  return { rows, ctx, get, authority, wrap }
}
beforeEach(() => { mocks.access = new Set(["alice", "bob", "carol"]); vi.stubEnv("AI_GATEWAY_SECRET", "test-server") })
afterEach(() => vi.unstubAllEnvs())

it.each(["device", "membership", "participant"])("requires rotation after %s removal and never shares the new key with a removed device", async kind => {
  const f = fixture()
  expect(await f.authority()).toMatchObject({ allowed: true, rotationRequired: false, keyVersion: 1 })
  if (kind === "device") f.get("bob")!.status = "revoked"
  if (kind === "membership") mocks.access.delete("bob")
  if (kind === "participant") f.get("participant-bob")!.leftAt = Date.now()
  expect(await f.authority()).toMatchObject({ rotationRequired: true, keyVersion: 1 })
  expect(await f.authority("bob")).toEqual({ allowed: false })
  expect(await invoke(beginRotation, f.ctx, { sessionId: "s", ...f.wrap })).toEqual({ created: true, keyVersion: 2 })
  expect(await invoke(beginRotation, f.ctx, { sessionId: "s", ...f.wrap })).toEqual({ created: false, keyVersion: 2 })
  await expect(invoke(share, f.ctx, { sessionId: "s", recipientUserId: "bob", keyVersion: 2, ...f.wrap })).rejects.toThrow("membership")
  await invoke(share, f.ctx, { sessionId: "s", recipientUserId: "carol", keyVersion: 2, ...f.wrap })
  expect(await invoke(rotationCheckpointAuthorityForServer, f.ctx, { sessionId: "s", userId: "alice", serverSecret: "test-server" })).toMatchObject({ previousKeyVersion: 1, keyVersion: 2 })
  await expect(invoke(activateRotationFromServer, f.ctx, { sessionId: "s", keyVersion: 2, sequence: 4, serverSecret: "forged" })).rejects.toThrow("Unauthorized")
  await invoke(activateRotationFromServer, f.ctx, { sessionId: "s", keyVersion: 2, sequence: 4, serverSecret: "test-server" })
  expect(await f.authority()).toMatchObject({ keyVersion: 2, rotationRequired: false })
  expect(f.get("key-1")!.status).toBe("revoked")
  expect(await f.authority("carol")).toMatchObject({ allowed: true, keyVersion: 2 })
})

it("supersedes a pending key if access changes again before activation", async () => {
  const f = fixture(); f.get("participant-bob")!.leftAt = 1
  await invoke(beginRotation, f.ctx, { sessionId: "s", ...f.wrap })
  await invoke(share, f.ctx, { sessionId: "s", recipientUserId: "carol", keyVersion: 2, ...f.wrap })
  mocks.access.delete("carol")
  await expect(invoke(activateRotationFromServer, f.ctx, { sessionId: "s", keyVersion: 2, sequence: 4, serverSecret: "test-server" })).rejects.toThrow("recipients changed")
  expect(await invoke(beginRotation, f.ctx, { sessionId: "s", ...f.wrap })).toEqual({ created: true, keyVersion: 3 })
  expect(f.rows.projectCollabRoomKeys!.find(row => row.keyVersion === 2)?.status).toBe("revoked")
  expect(await f.authority()).toMatchObject({ keyVersion: 1, pendingKeyVersion: 3, rotationRequired: true })
  f.get("participant-alice")!.role = "observer"
  await expect(invoke(beginRotation, f.ctx, { sessionId: "s", ...f.wrap })).rejects.toThrow("editor")
})

it("rejects old-generation room authority without disturbing ordinary project identities", async () => {
  const f = fixture(); delete f.get("session")!.generation
  expect(await f.authority()).toEqual({ allowed: false })
  expect(f.rows.users).toHaveLength(3)
})
