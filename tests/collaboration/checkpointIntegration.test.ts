/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { SessionCheckpointClient } from "../../apps/desktop/electron/collaboration/SessionCheckpointClient"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { CollabRoom } from "../../cloudflare/worker/src/durableObjects/CollabRoom"
import { RoomCheckpointStore, type RoomStorage } from "../../cloudflare/worker/src/durableObjects/RoomCheckpointStore"
import { handleCollaborationCheckpoint } from "../../cloudflare/worker/src/routes/collaborationRepositories"
import { COLLABORATION_PROTOCOL_REVISION, type RoomAuthority } from "../../shared/collaborationProtocol"
import type { Env } from "../../cloudflare/worker/src/types"

const network = vi.hoisted(() => ({ role: "editor" as "editor" | "observer", allowed: true }))
vi.mock("../../cloudflare/worker/src/lib/jwt", async original => ({ ...await original<typeof import("../../cloudflare/worker/src/lib/jwt")>(), verifyDeviceAccessToken: vi.fn(async () => ({ sub: "device_fixture" })) }))
vi.mock("../../cloudflare/worker/src/lib/convex", async original => ({ ...await original<typeof import("../../cloudflare/worker/src/lib/convex")>(), requireActiveDeviceAccessInConvex: vi.fn(async () => ({})) }))
vi.mock("convex/browser", () => ({ ConvexHttpClient: class {
  async query() { return { allowed: network.allowed, principalId: "principal_fixture", projectId: "project_fixture", sessionId: "session_fixture", roomId: "session:session_fixture", keyVersion: 1, role: network.role } }
  async mutation() { return null }
} }))

export class MemoryStorage implements RoomStorage {
  data = new Map<string, unknown>()
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.data.get(key)) as T | undefined }
  async put<T>(key: string, value: T): Promise<void>
  async put(entries: Record<string, unknown>): Promise<void>
  async put<T>(key: string | Record<string, unknown>, value?: T): Promise<void> {
    for (const item of typeof key === "string" ? [value] : Object.values(key)) if (JSON.stringify(item).length > 128 * 1024) throw new Error("KV value exceeds production 128 KiB bound")
    if (typeof key === "string") this.data.set(key, structuredClone(value))
    else for (const [name, item] of Object.entries(key)) this.data.set(name, structuredClone(item))
  }
  async delete(key: string): Promise<boolean>
  async delete(keys: string[]): Promise<number>
  async delete(key: string | string[]): Promise<boolean | number> { return typeof key === "string" ? this.data.delete(key) : key.reduce((count, item) => count + Number(this.data.delete(item)), 0) }
  async deleteAll(): Promise<void> { this.data.clear() }
  async list<T>(options: { prefix?: string; start?: string; end?: string; limit?: number } = {}): Promise<Map<string, T>> {
    return new Map([...this.data].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.start || key >= options.start) && (!options.end || key < options.end)).slice(0, options.limit ?? Infinity).map(([key, value]) => [key, structuredClone(value) as T]))
  }
  async transaction<T>(operation: (storage: RoomStorage) => Promise<T>): Promise<T> {
    const before = structuredClone(this.data)
    try { return await operation(this) } catch (error) { this.data = before; throw error }
  }
}
const roots: string[] = []
afterEach(async () => { network.role = "editor"; network.allowed = true; await Promise.all(roots.splice(0).map(root => fs.rm(root, { recursive: true, force: true }))) })
const authority: RoomAuthority = { principalId: "principal_fixture", projectId: "project_fixture", sessionId: "session_fixture", roomId: "session:session_fixture", keyVersion: 1, role: "editor" }

async function fixture() {
  const storage = new MemoryStorage()
  const state = { storage, getWebSockets: () => [], acceptWebSocket: () => {} } as unknown as DurableObjectState
  const env = { AI_GATEWAY_SECRET: "fixture-secret", CONVEX_URL: "https://fixture.convex.cloud" } as Env
  const room = new CollabRoom(state, env)
  env.COLLAB_ROOM = { idFromName: () => ({}), get: () => ({ fetch: (request: Request) => room.fetch(request) }) }
  const request = async (body: Record<string, unknown>) => {
    const response = await handleCollaborationCheckpoint(new Request("https://fixture/collab/v2/checkpoint", { method: "POST", headers: { authorization: "Bearer fixture-device", "content-type": "application/json" }, body: JSON.stringify({ sessionId: authority.sessionId, ...body }) }), env)
    const result = await response.json()
    if (!response.ok) throw new Error(JSON.stringify(result))
    return result
  }
  const client = async (role: "editor" | "observer" = "editor") => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-checkpoint-")); roots.push(root)
    return new SessionCheckpointClient({ sessionId: authority.sessionId, projectId: authority.projectId, roomId: authority.roomId, keyVersion: 1,
      roomKeyBase64: Buffer.alloc(32, 7).toString("base64"), role, store: new DurableSessionStore(root, authority.roomId, 1), request })
  }
  return { storage, env, room, request, client }
}

describe("actual desktop checkpoint client -> gateway route -> durable room", () => {
  it("T01 initializes and reloads the same encrypted canonical history on a fresh client", async () => {
    const f = await fixture()
    const first = await (await f.client()).bootstrap()
    expect(first?.sequence).toBe(0)
    const second = await (await f.client()).bootstrap()
    expect(second?.update).toEqual(first?.update)
    const doc = new Y.Doc()
    try { Y.applyUpdate(doc, second!.update); expect(doc.getMap("session").get("identity")).toEqual({ generation: 3, sessionId: authority.sessionId }) }
    finally { doc.destroy() }
  })

  it("T03 lets observers inspect/read without granting a checkpoint or file initialization lease", async () => {
    const f = await fixture(); await (await f.client()).bootstrap(); network.role = "observer"
    expect((await (await f.client("observer")).bootstrap())?.sequence).toBe(0)
    await expect(f.request({ protocolRevision: COLLABORATION_PROTOCOL_REVISION, operation: "claim", sequence: 0 })).rejects.toThrow("READ_ONLY")
    const observation = await f.request({ protocolRevision: COLLABORATION_PROTOCOL_REVISION, operation: "file.claim", fileId: "file_fixture" })
    expect(observation).toMatchObject({ waiting: true }); expect(observation).not.toHaveProperty("lease")
  })

  it("T04 uploads and reads a multi-chunk checkpoint through the real client", async () => {
    const f = await fixture(); const client = await f.client(); const initial = await client.bootstrap()
    const doc = new Y.Doc({ gc: false })
    try {
      Y.applyUpdate(doc, initial!.update)
      doc.getText("file-content:fixture").insert(0, "content-".repeat(20_000))
      // This test models a canonical update already accepted at the room boundary.
      await f.storage.put("head-sequence", 1)
      expect(await client.checkpoint(1, Y.encodeStateAsUpdate(doc))).toBe(true)
      const joined = await (await f.client()).bootstrap()
      const replica = new Y.Doc()
      try { Y.applyUpdate(replica, joined!.update); expect(replica.getText("file-content:fixture").toString()).toBe("content-".repeat(20_000)) }
      finally { replica.destroy() }
    } finally { doc.destroy() }
  })

  it("T30 rejects old checkpoint request shapes without modifying canonical state", async () => {
    const f = await fixture()
    await expect(f.request({ operation: "inspect" })).rejects.toThrow("PROTOCOL_MISMATCH")
    expect(f.storage.data.size).toBe(0)
  })

  it("publication notification does not prune replay or deduplication records", async () => {
    const f = await fixture()
    await f.storage.put({ "head-sequence": 1, "update:0000000000000001": { seq: 1, updateBinary: "retained" }, "idempotency:retained": 1 })
    const response = await f.room.fetch(new Request("https://internal/internal/base-advanced", { method: "POST", headers: { authorization: "Bearer fixture-secret", "content-type": "application/json" }, body: JSON.stringify({ commitSha: "a".repeat(40), coveredThroughSequence: 1 }) }))
    expect(response.status).toBe(204)
    expect(await f.storage.get("update:0000000000000001")).toBeDefined()
    expect(await f.storage.get("idempotency:retained")).toBe(1)
  })
})

describe("checkpoint and file initialization durable leases", () => {
  it("T02 elects one file initializer and rejects a stale lease after takeover", async () => {
    const f = await fixture(); await (await f.client()).bootstrap()
    let now = Date.now(); const store = new RoomCheckpointStore(f.storage, () => now)
    const first = await store.handle(authority, { operation: "file.claim", fileId: "file_fixture" }) as { lease: { leaseId: string } }
    const other = { ...authority, principalId: "other_principal" }
    expect(await store.handle(other, { operation: "file.claim", fileId: "file_fixture" })).toMatchObject({ waiting: true })
    now += 61_000
    const next = await store.handle(other, { operation: "file.claim", fileId: "file_fixture" }) as { lease: { leaseId: string } }
    expect(next.lease.leaseId).not.toBe(first.lease.leaseId)
    await expect(store.initializationReceipt(authority, { type: "file-initialization", fileId: "file_fixture", leaseId: first.lease.leaseId }, 1)).rejects.toThrow("initialization lease changed")
    const receipt = await store.initializationReceipt(other, { type: "file-initialization", fileId: "file_fixture", leaseId: next.lease.leaseId }, 1)
    await f.storage.put({ ...receipt, "head-sequence": 1 })
    expect(await store.handle({ ...other, role: "observer" }, { operation: "file.claim", fileId: "file_fixture" })).toEqual({ sequence: 1 })
  })
})
