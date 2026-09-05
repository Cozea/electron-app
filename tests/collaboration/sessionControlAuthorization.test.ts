import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { createSession, acquireCommitLease } from "../../convex/collaborationSessions"
import { upsertBinding, getAuthorizationForServer } from "../../convex/collaborationRepositories"
import { authorizeCollaborationParticipant } from "../../convex/collaborationRoomAuthorization"
import type { QueryCtx } from "../../convex/_generated/server"
import type { Id } from "../../convex/_generated/dataModel"
// Exercise production handlers, device claims and project/org access helpers;
// only registration and the database/verified JWT platform boundaries are controlled.
vi.mock("../../convex/_generated/server", () => ({ query: (definition: { handler: unknown }) => definition.handler, mutation: (definition: { handler: unknown }) => definition.handler }))
type Row = Record<string, unknown> & { _id: string; table: string }
const BASE = "a".repeat(40), PUBLISHED = "b".repeat(40), now = 1_800_000_000_000
const identityKey = `czd_${"a".repeat(26)}`
const invoke = <T = Record<string, unknown>>(fn: unknown, ctx: unknown, args: unknown): Promise<T> => (fn as (ctx: unknown, args: unknown) => Promise<T>)(ctx, args)
beforeEach(() => { vi.stubEnv("COLLABORATION_G3_CREATE_ENABLED", "1"); vi.stubEnv("AI_GATEWAY_SECRET", "test-only-secret"); vi.spyOn(Date, "now").mockReturnValue(now) })
afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks() })
function fixture() {
  const rows: Row[] = []
  const add = (table: string, id: string, fields: Record<string, unknown>): Row => { const row: Row = { ...fields, table, _id: id }; rows.push(row); return row }
  const user = add("users", "alice", { identityKey, deviceLabel: "Device", platform: "darwin", encryptionPublicKeyJwk: "public", encryptionPublicKeyAlgorithm: "algorithm",
    encryptionFingerprint: "fingerprint", signingPublicKeyJwk: "public", signingPublicKeyAlgorithm: "algorithm", signingFingerprint: "fingerprint", status: "active", signingKeyVersion: 1, tokenValidAfter: 0 })
  const project = add("projects", "project", { createdBy: "alice", organizationId: "org", status: "active" })
  add("organizations", "org", { createdBy: "alice", groupId: "czg_org-identity" })
  const binding = add("collaborationRepositoryBindings", "binding", { projectId: "project", organizationId: "org", repositoryId: "github:1", repositoryNumericId: "1", provider: "github",
    installationId: "100", owner: "Cozea", name: "repo", fullName: "Cozea/repo", cloneUrl: "https://github.com/Cozea/repo.git", htmlUrl: "https://github.com/Cozea/repo",
    defaultBranch: "main", enabled: true, accessPolicy: "organization", createdByUserId: "alice", createdAt: now, updatedAt: now })
  const verified = add("collaborationVerifiedRepositories", "verified", { organizationId: "org", repositoryNumericId: "1", installationId: "100", owner: "Cozea", name: "repo", defaultBranch: "main", verifiedAt: now - 1000 })
  const resolution = add("collaborationRepositoryResolutions", "resolution", { bindingId: "binding", userId: "alice", projectId: "project", repositoryId: "github:1", branch: "main", commitSha: BASE, expiresAt: now + 60_000 })
  const claims = { subject: identityKey, key_version: 1, token_issued_at: now / 1000 }
  const db = {
    get: async (id: string) => rows.find(row => row._id === id) ?? null,
    insert: vi.fn(async (table: string, fields: Record<string, unknown>) => { const id = `${table}-${rows.length}`; add(table, id, fields); return id }),
    patch: vi.fn(async (id: string, fields: Record<string, unknown>) => { Object.assign(rows.find(row => row._id === id)!, fields) }),
    query: (table: string) => ({ withIndex: (_name: string, filter: (query: { eq(key: string, value: unknown): unknown }) => unknown) => {
      const conditions: Record<string, unknown> = {}
      const query = { eq(key: string, value: unknown) { conditions[key] = value; return query } }; filter(query)
      const result = () => rows.filter(row => row.table === table && Object.entries(conditions).every(([key, value]) => row[key] === value))
      return { unique: async () => { const matches = result(); if (matches.length > 1) throw new Error("Duplicate fixture index"); return matches[0] ?? null },
        first: async () => result()[0] ?? null, collect: async () => result(), take: async (count: number) => result().slice(0, count) }
    } }),
  }
  const ctx = { db, auth: { getUserIdentity: async () => claims } }
  const args = { generation: 3, projectId: "project", repositoryId: "github:1", targetBranch: "main", baseCommitSha: BASE, creationToken: "creation", resolutionId: "resolution" }
  const bindArgs = { projectId: "project", repositoryNumericId: "1", installationId: "100", owner: "Cozea", name: "repo", defaultBranch: "main", accessPolicy: "organization", enabled: true }
  return { rows, add, user, project, binding, verified, resolution, claims, db, ctx, args, bindArgs }
}

describe("verified repository and Start authority", () => {
  it("records the immutable resolved target and retries creation after session publication", async () => {
    const f = fixture()
    const created = await invoke(createSession, f.ctx, f.args)
    expect(created.targetCommitSha).toBe(BASE)
    const row = f.rows.find(row => row.table === "collaborationSessions")!
    Object.assign(row, { status: "active", baseCommitSha: PUBLISHED, publishedCommitSha: PUBLISHED, publishedThroughSequence: 2, roomHeadSequence: 2 })
    const writes = f.db.insert.mock.calls.length
    expect((await invoke(createSession, f.ctx, f.args)).id).toBe(created.id)
    expect(f.db.insert.mock.calls.length).toBe(writes)
    await expect(invoke(createSession, f.ctx, { ...f.args, baseCommitSha: PUBLISHED })).rejects.toThrow("different session parameters")
  })
  it.each(["revoked", "expired", "moved", "rebound"])("rejects a previously resolved branch after its access is %s", async change => {
    const f = fixture()
    if (change === "revoked") f.add("collaborationInstallationRevocations", "revoked", { installationId: "100", revokedAt: now })
    if (change === "expired") f.resolution.expiresAt = now
    if (change === "moved") f.project.organizationId = "other"
    if (change === "rebound") f.binding.repositoryId = "github:2"
    await expect(invoke(createSession, f.ctx, f.args)).rejects.toThrow("Resolve the authorized")
    expect(f.db.insert).not.toHaveBeenCalled()
  })
  it.each(["device", "token", "token-boundary", "viewer", "gate"])("rejects Start before writing when %s authority is unavailable", async change => {
    const f = fixture()
    if (change === "device") f.user.status = "revoked"
    if (change === "token") f.claims.key_version = 2
    if (change === "token-boundary") { f.user.tokenValidAfter = now; f.claims.token_issued_at -= 2 }
    if (change === "viewer") { f.project.createdBy = "other"; f.add("projectMembers", "member", { projectId: "project", userId: "alice", role: "viewer" }) }
    if (change === "gate") vi.stubEnv("COLLABORATION_G3_CREATE_ENABLED", "0")
    await expect(invoke(createSession, f.ctx, f.args)).rejects.toThrow()
    expect(f.db.insert).not.toHaveBeenCalled()
  })
  it("refuses forged installations and cross-organization repository catalogs", async () => {
    const f = fixture()
    await expect(invoke(upsertBinding, f.ctx, { ...f.bindArgs, installationId: "999" })).rejects.toThrow("verified GitHub installation")
    f.verified.organizationId = "other"
    await expect(invoke(upsertBinding, f.ctx, f.bindArgs)).rejects.toThrow("verified GitHub installation")
    expect(f.db.insert).not.toHaveBeenCalled(); expect(f.db.patch).not.toHaveBeenCalled()
  })
  it("requires organization administration even from a project creator", async () => {
    const f = fixture()
    f.rows.find(row => row._id === "org")!.createdBy = "other"
    await expect(invoke(upsertBinding, f.ctx, f.bindArgs)).rejects.toThrow("Only organization admins")
    expect(f.db.patch).not.toHaveBeenCalled()
  })
  it("keeps an observer from acquiring publication authority even when they own the project", async () => {
    const f = fixture(), created = await invoke(createSession, f.ctx, f.args)
    f.rows.find(row => row.table === "collaborationSessions")!.status = "active"
    f.rows.find(row => row.table === "collaborationParticipants")!.role = "observer"
    f.db.patch.mockClear(); f.db.insert.mockClear()
    expect((await authorizeCollaborationParticipant(f.ctx as unknown as QueryCtx, "alice" as Id<"users">, created.id as string))).toMatchObject({ allowed: true, role: "observer" })
    await expect(invoke(acquireCommitLease, f.ctx, { sessionId: created.id })).rejects.toThrow("active editor")
    expect(f.db.patch).not.toHaveBeenCalled(); expect(f.db.insert).not.toHaveBeenCalled()
  })
  it("revokes repository credentials and connected-room access after a project organization changes", async () => {
    const f = fixture()
    const created = await invoke(createSession, f.ctx, f.args)
    f.rows.find(row => row.table === "collaborationSessions")!.status = "active"
    const authorization = { serverSecret: "test-only-secret", identityKey, projectId: "project", operation: "read" }
    expect((await invoke(getAuthorizationForServer, f.ctx, authorization)).allowed).toBe(true)
    expect((await authorizeCollaborationParticipant(f.ctx as unknown as QueryCtx, "alice" as Id<"users">, created.id as string)).allowed).toBe(true)
    f.project.organizationId = "other"
    expect((await invoke(getAuthorizationForServer, f.ctx, authorization)).allowed).toBe(false)
    expect((await authorizeCollaborationParticipant(f.ctx as unknown as QueryCtx, "alice" as Id<"users">, created.id as string)).allowed).toBe(false)
  })
})
