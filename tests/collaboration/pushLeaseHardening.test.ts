import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getPushVerificationContextForServer } from "../../convex/collaborationRepositories"
import { leaveSession, closeSession } from "../../convex/collaborationSessions"

const mocks = vi.hoisted(() => ({ user: { _id: "u1", identityKey: "machine_1", status: "active" } }))
vi.mock("../../convex/_generated/server", () => ({
  query: (definition: { handler: unknown }) => definition.handler,
  mutation: (definition: { handler: unknown }) => definition.handler,
}))
vi.mock("../../convex/lib/deviceAuth", () => ({ requireAuthenticatedDevice: vi.fn(async () => mocks.user) }))
vi.mock("../../convex/lib/projectAccess", () => ({ canAccessProject: vi.fn(async () => true), canEditProject: vi.fn(async () => true), canManageProject: vi.fn(async () => true), getProjectAccessState: vi.fn(async () => ({ project: {}, isCreator: true })) }))

function fixture(expiresAt = Date.now() + 60_000) {
  const now = Date.now()
  const session = { _id: "session_doc", sessionId: "s", projectId: "p", repositoryId: "github:1", targetBranch: "main", sessionBranch: "cozea/collab/s", baseCommitSha: "a".repeat(40), publishedThroughSequence: 0, roomHeadSequence: 1, createdByUserId: "u1", status: "pushing", revision: 1, commitLeaseUserId: "u1", commitLeaseExpiresAt: expiresAt, pendingCommitSha: "b".repeat(40), pendingCommitThroughSequence: 1, pendingCommitCreatedAt: now, createdAt: now, updatedAt: now }
  const participant = { _id: "participant_1", userId: "u1", role: "editor" }
  const binding = { _id: "binding", enabled: true, projectId: "p", repositoryId: "github:1", accessPolicy: "organization" }
  const tables: Record<string, unknown> = { users: mocks.user, collaborationSessions: session, collaborationParticipants: participant, collaborationRepositoryBindings: binding }
  const patch = vi.fn(async () => undefined)
  const ctx = { db: { query: (table: string) => ({ withIndex: () => ({ unique: async () => tables[table], collect: async () => [tables[table]] }) }), patch, insert: vi.fn(async () => "event") } }
  return { session, participant, ctx, patch }
}
function invoke(fn: unknown, ctx: unknown, args: unknown): Promise<unknown> {
  return (fn as (ctx: unknown, args: unknown) => Promise<unknown>)(ctx, args)
}
beforeEach(() => { vi.clearAllMocks(); vi.stubEnv("AI_GATEWAY_SECRET", "test-gateway-secret") })

afterEach(() => vi.unstubAllEnvs())

describe("push authorization and in-flight state", () => {
  it("rejects expired leases before issuing a write credential", async () => {
    const f = fixture(Date.now() - 1)
    await expect(invoke(getPushVerificationContextForServer, f.ctx, { serverSecret: "test-gateway-secret", identityKey: "machine_1", sessionId: "s" })).resolves.toEqual({ allowed: false })
  })
  it("keeps publication state when the publisher leaves during verification", async () => {
    const f = fixture()
    const result = await invoke(leaveSession, f.ctx, { sessionId: "s" })
    expect(result).toMatchObject({ left: true, session: { status: "pushing", commitLeaseUserId: "u1", pendingCommitSha: "b".repeat(40) } })
    expect(f.patch).toHaveBeenCalledTimes(1)
    expect(f.patch).toHaveBeenCalledWith("participant_1", expect.objectContaining({ leftAt: expect.any(Number) }))
  })
  it("does not close the room while publication is being verified", async () => {
    const f = fixture()
    await expect(invoke(closeSession, f.ctx, { sessionId: "s" })).rejects.toThrow(/Push verification/)
    expect(f.patch).not.toHaveBeenCalled()
  })
})
