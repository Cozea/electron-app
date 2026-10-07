import { describe, expect, it } from "vitest"
import type { FunctionArgs, FunctionReference, FunctionReturnType } from "convex/server"

import { api } from "../../convex/_generated/api"
import type { Id } from "../../convex/_generated/dataModel"
import type { MutationCtx } from "../../convex/_generated/server"
import * as projects from "../../convex/projects"
import { createDeviceIdentityKey } from "../../shared/deviceIdentity"

interface FixtureRow extends Record<string, unknown> {
  _id: string
}

// Convex exposes this test entry point at runtime but strips it from public
// declarations. Restore its signature from the generated API at this boundary.
function withHandler<Ref extends FunctionReference<"query" | "mutation">>(
  _reference: Ref,
  endpoint: unknown,
): { _handler: (ctx: MutationCtx, args: FunctionArgs<Ref>) => Promise<FunctionReturnType<Ref>> } {
  return endpoint as {
    _handler: (ctx: MutationCtx, args: FunctionArgs<Ref>) => Promise<FunctionReturnType<Ref>>
  }
}

const archive = withHandler(api.projects.archive, projects.archive)
const create = withHandler(api.projects.create, projects.create)
const getAccessibleBySlug = withHandler(api.projects.getAccessibleBySlug, projects.getAccessibleBySlug)
const getAccessibleByRouteKey = withHandler(api.projects.getAccessibleByRouteKey, projects.getAccessibleByRouteKey)
const listForCurrentUser = withHandler(api.projects.listForCurrentUser, projects.listForCurrentUser)
const listSummariesForCurrentUser = withHandler(api.projects.listSummariesForCurrentUser, projects.listSummariesForCurrentUser)

function fixture(authenticated = true) {
  const callerId = "principal_caller" as Id<"devicePrincipals">
  const otherId = "principal_other" as Id<"devicePrincipals">
  const identityKey = createDeviceIdentityKey(new Uint8Array(16))
  const ownProjectId = "project_own" as Id<"projects">
  const otherProjectId = "project_other" as Id<"projects">
  const tables = new Map<string, FixtureRow[]>([
    ["devicePrincipals", [{
      _id: callerId, identityKey, displayName: "Caller", platform: "darwin",
      encryptionPublicKeyJwk: "{}", encryptionPublicKeyAlgorithm: "ECDH",
      encryptionFingerprint: "encryption", signingPublicKeyJwk: "{}",
      signingPublicKeyAlgorithm: "ECDSA", signingFingerprint: "signing",
      status: "active", signingKeyVersion: 1, tokenValidAfter: 0,
    }]],
    ["projects", [
      { _id: ownProjectId, name: "Own", slug: "own", status: "active", createdBy: callerId, updatedAt: 1 },
      { _id: otherProjectId, name: "Other", slug: "other", status: "active", createdBy: otherId, updatedAt: 1 },
    ]],
    ["projectMembers", [
      { _id: "member_own", projectId: ownProjectId, principalId: callerId, role: "project_manager" },
      { _id: "member_other", projectId: otherProjectId, principalId: otherId, role: "project_manager" },
    ]],
  ])
  const writes: string[] = []
  const reads: string[] = []
  const rows = (table: string) => tables.get(table) ?? []
  const ctx = {
    auth: {
      getUserIdentity: async () => authenticated
        ? { subject: identityKey, key_version: 1, token_issued_at: 1 }
        : null,
    },
    db: {
      normalizeId(table: string, id: string) {
        return rows(table).some((row) => row._id === id) ? id : null
      },
      query(table: string) {
        reads.push(table)
        const filters = new Map<string, unknown>()
        const index = {
          eq(field: string, value: unknown) { filters.set(field, value); return index },
        }
        const matching = () => rows(table).filter((row) =>
          [...filters].every(([key, value]) => row[key] === value),
        )
        const query = {
          withIndex(_name: string, build: (range: typeof index) => unknown) {
            build(index)
            return query
          },
          collect: async () => matching(),
          first: async () => matching()[0] ?? null,
          unique: async () => matching()[0] ?? null,
        }
        return query
      },
      get: async (id: string) => [...tables.values()].flat().find((row) => row._id === id) ?? null,
      insert: async (table: string, data: Record<string, unknown>) => {
        const id = `${table}_${rows(table).length + 1}`
        tables.set(table, [...rows(table), { ...data, _id: id }])
        writes.push(table)
        return id
      },
      patch: async (id: string, patch: Record<string, unknown>) => {
        const row = [...tables.values()].flat().find((entry) => entry._id === id)
        if (!row) throw new Error("Missing fixture row")
        Object.assign(row, patch)
        writes.push(id)
      },
    },
  } as unknown as MutationCtx
  return { ctx, callerId, otherId, ownProjectId, otherProjectId, tables, reads, writes }
}

describe("project endpoints derive caller authority", () => {
  it("normalizes legacy route keys and checks the authenticated device's membership", async () => {
    const f = fixture()
    expect(await getAccessibleByRouteKey._handler(f.ctx, { projectKey: f.ownProjectId })).toMatchObject({ _id: f.ownProjectId })
    expect(await getAccessibleByRouteKey._handler(f.ctx, { projectKey: f.otherProjectId })).toBeNull()
    expect(await getAccessibleByRouteKey._handler(f.ctx, { projectKey: "lpj_" + "a".repeat(32) })).toBeNull()
    expect(await getAccessibleByRouteKey._handler(f.ctx, { projectKey: "invalid-route" })).toBeNull()
    expect(f.writes).toEqual([])
  })

  it("requires authentication before interpreting a legacy route key", async () => {
    const f = fixture(false)
    await expect(getAccessibleByRouteKey._handler(f.ctx, { projectKey: "lpj_" + "a".repeat(32) })).rejects.toThrow("Authentication required")
    expect(f.reads).toEqual([])
  })
  it("rejects another principal's claim before reading their memberships", async () => {
    const f = fixture()
    await expect(listForCurrentUser._handler(f.ctx, { principalId: f.otherId })).rejects.toThrow("does not match")
    await expect(listSummariesForCurrentUser._handler(f.ctx, { principalId: f.otherId })).rejects.toThrow("does not match")
    await expect(getAccessibleBySlug._handler(f.ctx, { slug: "other", principalId: f.otherId })).rejects.toThrow("does not match")
    expect(f.reads.every((table) => table === "devicePrincipals")).toBe(true)
  })

  it("lists only the verified device's projects without requiring a caller claim", async () => {
    const f = fixture()
    expect((await listForCurrentUser._handler(f.ctx, {})).map((project) => project._id)).toEqual([f.ownProjectId])
    expect((await listSummariesForCurrentUser._handler(f.ctx, {})).map((project) => project._id)).toEqual([f.ownProjectId])
    expect(await getAccessibleBySlug._handler(f.ctx, { slug: "other" })).toEqual({ status: "not_found" })
    expect(await getAccessibleBySlug._handler(f.ctx, { slug: "own", principalId: f.callerId })).toMatchObject({
      status: "ok", project: { _id: f.ownProjectId },
    })
  })

  it("creates ownership and membership from auth and resumes the same token", async () => {
    const f = fixture()
    const args = { name: "New", creationPath: "fresh" as const, creationToken: "attempt-one", status: "active" as const }
    const first = await create._handler(f.ctx, args)
    const retry = await create._handler(f.ctx, { ...args, principalId: f.callerId })
    expect(first.resumed).toBe(false)
    expect(retry).toEqual({ ...first, resumed: true })
    expect(f.tables.get("projects")?.find((row) => row._id === first.projectId)?.createdBy).toBe(f.callerId)
    expect(f.tables.get("projectMembers")?.find((row) => row.projectId === first.projectId)).toMatchObject({
      principalId: f.callerId, addedBy: f.callerId,
    })
    expect(f.writes.filter((table) => table === "projects")).toHaveLength(1)
  })

  it("cannot create as a different device", async () => {
    const f = fixture()
    await expect(create._handler(f.ctx, {
      name: "Wrong owner", creationPath: "fresh", principalId: f.otherId,
    })).rejects.toThrow("does not match")
    expect(f.writes).toEqual([])
  })

  it("cannot borrow a manager's identity for shared archival", async () => {
    const f = fixture()
    f.tables.get("projectMembers")?.push({
      _id: "member_developer", projectId: f.otherProjectId, principalId: f.callerId, role: "developer",
    })
    await expect(archive._handler(f.ctx, {
      projectId: f.otherProjectId, principalId: f.otherId,
    })).rejects.toThrow("does not match")
    await expect(archive._handler(f.ctx, {
      projectId: f.otherProjectId, principalId: f.callerId,
    })).rejects.toThrow("Only project managers")
    expect(f.writes).toEqual([])
    await archive._handler(f.ctx, { projectId: f.ownProjectId, principalId: f.callerId })
    expect(f.tables.get("projects")?.find((row) => row._id === f.ownProjectId)?.status).toBe("archived")
  })

  it("requires a verified device even when no caller claim is supplied", async () => {
    const f = fixture(false)
    await expect(listForCurrentUser._handler(f.ctx, {})).rejects.toThrow("Authentication required")
    await expect(create._handler(f.ctx, { name: "Offline", creationPath: "fresh" })).rejects.toThrow("Authentication required")
    expect(f.reads).toEqual([])
    expect(f.writes).toEqual([])
  })
})
