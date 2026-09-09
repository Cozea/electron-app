import { readFileSync, writeFileSync, mkdirSync, existsSync } from "node:fs";
import path from "node:path";

// Temporary, exact-input execution adapter for the approved P1 slice. It never
// pushes a branch or deploys a service. The candidate workflow typechecks and
// executes these changes before publishing only their Git tree object.
const changed = new Set();
const edit = (name, transform) => {
  const before = readFileSync(name, "utf8");
  const after = transform(before);
  if (before === after) throw new Error(`Transformation made no change: ${name}`);
  writeFileSync(name, after); changed.add(name);
};
const replace = (source, before, after) => {
  const first = source.indexOf(before);
  if (first < 0 || source.indexOf(before, first + before.length) >= 0) throw new Error(`Expected one exact source anchor: ${before.slice(0, 100)}`);
  return source.slice(0, first) + after + source.slice(first + before.length);
};
const create = (name, contents) => {
  if (existsSync(name)) throw new Error(`Refusing to overwrite new file: ${name}`);
  mkdirSync(path.dirname(name), { recursive: true }); writeFileSync(name, contents); changed.add(name);
};

edit("apps/desktop/electron/collaboration/SessionCheckpointClient.ts", source => {
  source = 'import { COLLABORATION_PROTOCOL_REVISION, validateCheckpointInspection } from "../../../../shared/collaborationProtocol"\n' + source;
  source = source.replaceAll("this.options.request(", "this.request(");
  source = replace(source, '  constructor(options: CheckpointClientOptions) { this.options = options }', '  constructor(options: CheckpointClientOptions) { this.options = options }\n\n  private request(body: Record<string, unknown>): Promise<unknown> {\n    return this.options.request({ ...body, protocolRevision: COLLABORATION_PROTOCOL_REVISION })\n  }');
  return replace(source, 'const inspected = await this.request({ operation: "inspect" }) as { checkpoint: EncryptedCheckpointDescriptor | null }', 'const inspected = validateCheckpointInspection(await this.request({ operation: "inspect" }))');
});

edit("apps/desktop/electron/collaboration/SessionRuntimeHost.ts", source => {
  source = 'import { COLLABORATION_PROTOCOL_REVISION } from "../../../../shared/collaborationProtocol"\n' + source;
  return replace(source, 'const request = (body: Record<string, unknown>) => this.gateway.post("/collab/v2/checkpoint", { sessionId, ...body })', 'const request = (body: Record<string, unknown>) => this.gateway.post("/collab/v2/checkpoint", { sessionId, ...body, protocolRevision: COLLABORATION_PROTOCOL_REVISION })');
});

edit("convex/collaborationRoomAuthorization.ts", source => {
  source = replace(source, 'import { canAccessProject } from "./lib/projectAccess"', 'import { canAccessProject, canEditProject } from "./lib/projectAccess"');
  return replace(source, '    role: participant.role,', '    role: participant.role === "editor" && await canEditProject(ctx, session.projectId, principalId) ? "editor" as const : "observer" as const,');
});

edit("cloudflare/worker/src/routes/collaborationRepositories.ts", source => {
  source = 'import { COLLABORATION_PROTOCOL_REVISION, CollaborationProtocolError, isCheckpointRead, parseCheckpointRequest, parseRoomAuthority, protocolRecord } from "../../../../shared/collaborationProtocol"\n' + source;
  source = replace(source, "import { jsonResponse } from '../lib/protocol'", "import { jsonResponse, protocolError } from '../lib/protocol'");
  const start = source.indexOf('export async function handleCollaborationCheckpoint(');
  if (start < 0) throw new Error("Checkpoint route anchor missing");
  source = source.slice(0, start) + String.raw`export async function handleCollaborationCheckpoint(request: Request, env: Env): Promise<Response> {
  try {
    const auth = await authenticate(request, env)
    const body = protocolRecord(await parseJsonRequest(request), "Checkpoint request")
    const sessionId = requiredString(body.sessionId, "sessionId", 128)
    const command = parseCheckpointRequest(body)
    const client = new ConvexHttpClient(env.CONVEX_URL)
    let raw = protocolRecord(await client.query(makeFunctionReference<"query">("collaborationRoomAuthorization:authorizeSessionForServer"),
      { serverSecret: env.AI_GATEWAY_SECRET, identityKey: auth.sub, sessionId }), "Session authority")
    if (raw.allowed !== true) throw new CollaborationProtocolError("DEVICE_REVOKED", "Session membership is unavailable", 403)
    if (body.rotation === true && raw.pendingKeyVersion) {
      if (raw.role !== "editor") throw new CollaborationProtocolError("READ_ONLY", "Observers cannot rotate room keys", 403)
      raw = protocolRecord(await client.query(makeFunctionReference<"query">("collaborationEncryption:rotationCheckpointAuthorityForServer"),
        { serverSecret: env.AI_GATEWAY_SECRET, principalId: raw.principalId, sessionId }), "Rotation authority")
    }
    const authority = parseRoomAuthority({ ...raw, sessionId })
    if (!isCheckpointRead(command) && authority.role !== "editor") throw new CollaborationProtocolError("READ_ONLY", "Observers can read but cannot publish checkpoints", 403)
    const response = await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(authority.roomId)).fetch(new Request("https://internal/internal/checkpoint", {
      method: "POST", headers: { authorization: ` + '`Bearer ${env.AI_GATEWAY_SECRET}`' + String.raw`, "content-type": "application/json" },
      body: JSON.stringify({ authority, request: { ...command, protocolRevision: COLLABORATION_PROTOCOL_REVISION } }),
    }))
    if (!response.ok) return response
    const result = protocolRecord(await response.json(), "Checkpoint response")
    if (result.checkpoint && body.rotation === true && authority.previousKeyVersion) {
      const checkpoint = protocolRecord(result.checkpoint, "Rotation checkpoint")
      if (checkpoint.keyVersion === authority.keyVersion) await client.mutation(makeFunctionReference<"mutation">("collaborationEncryption:activateRotationFromServer"),
        { serverSecret: env.AI_GATEWAY_SECRET, sessionId, keyVersion: authority.keyVersion, sequence: checkpoint.sequence })
    }
    return jsonResponse(result, { headers: { "cache-control": "no-store" } })
  } catch (error) {
    if (error instanceof CollaborationProtocolError) return protocolError(error.code, error.message, { status: error.status }, error.recoverable)
    throw error
  }
}
`;
  // Both new publication and publication-receipt recovery use the authenticated
  // internal notification. Neither path authorizes room history deletion.
  source = source.replaceAll('headers: { "content-type": "application/json" },', 'headers: { authorization: `Bearer ${env.AI_GATEWAY_SECRET}`, "content-type": "application/json" },');
  source = replace(source, '    await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(`session:${sessionId}`)).fetch(new Request("https://internal/internal/base-advanced", {', '    const roomReceipt = await env.COLLAB_ROOM.get(env.COLLAB_ROOM.idFromName(`session:${sessionId}`)).fetch(new Request("https://internal/internal/base-advanced", {');
  return replace(source, '    return jsonResponse(existing, { headers: { "cache-control": "no-store" } })', '    if (!roomReceipt.ok) throw new Error("Publication is verified but the room did not acknowledge it; retry Push")\n    return jsonResponse(existing, { headers: { "cache-control": "no-store" } })');
});

edit("cloudflare/worker/src/durableObjects/CollabRoom.ts", source => {
  source = String.raw`import { RoomCheckpointStore, ROOM_COMPACTION_FLOOR_KEY } from "./RoomCheckpointStore"
import { currentRoomAuthority } from "../lib/liveRoomAuthority"
import { CollaborationProtocolError, parseCheckpointRequest, parseRoomAuthority, protocolRecord, protocolSequence, type RoomAuthority } from "../../../../shared/collaborationProtocol"
import { decodeCanonicalBase64, validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"
import { fileInitializationOrigin } from "../../../../shared/collaborationFileInitialization"
` + source;
  source = replace(source, '  principalId: string\n', '  principalId: string\n  identityKey?: string\n  expiresAt?: number\n');
  source = replace(source, '  private updateQueue: Promise<void> = Promise.resolve()', '  private updateQueue: Promise<void> = Promise.resolve()\n  private readonly checkpoints: RoomCheckpointStore');
  source = replace(source, '    this.env = env\n', '    this.env = env\n    this.checkpoints = new RoomCheckpointStore(state.storage)\n');
  const start = source.indexOf("    if (url.pathname === '/internal/checkpoint'");
  const end = source.indexOf("    if (request.headers.get('upgrade')", start);
  if (start < 0 || end < 0) throw new Error("Room internal routes changed");
  source = source.slice(0, start) + String.raw`    if (url.pathname.startsWith('/internal/')) {
      if (!this.env.AI_GATEWAY_SECRET || request.headers.get('authorization') !== ` + '`Bearer ${this.env.AI_GATEWAY_SECRET}`' + String.raw`) return new Response('Unauthorized', { status: 401 })
      try {
        if (url.pathname === '/internal/checkpoint' && request.method === 'POST') {
          const body = protocolRecord(await request.json(), "Internal checkpoint request")
          const authority = parseRoomAuthority(body.authority)
          const command = parseCheckpointRequest(body.request)
          const operation = this.updateQueue.then(() => this.checkpoints.handle(authority, command))
          this.updateQueue = operation.then(() => undefined, () => undefined)
          return Response.json(await operation)
        }
        if (url.pathname === '/internal/base-advanced' && request.method === 'POST') {
          const body = protocolRecord(await request.json(), "Publication receipt")
          const sequence = protocolSequence(body.coveredThroughSequence, "coveredThroughSequence")
          if (typeof body.commitSha !== "string" || !/^[a-f0-9]{40}$/.test(body.commitSha)) throw new CollaborationProtocolError("INVALID_REQUEST", "Invalid publication commit")
          const commitSha = body.commitSha
          const operation = this.updateQueue.then(async () => {
            if (sequence > await this.getSessionHeadSequence()) throw new CollaborationProtocolError("INVALID_SEQUENCE", "Publication exceeds the canonical room head", 409)
            await this.state.storage.put("g3:publication", { commitSha, coveredThroughSequence: sequence })
            // Git publication is not CRDT compaction. Keep the replay history
            // until an independently finalized checkpoint permits retirement.
            this.broadcast({ type: 'base.advanced', payload: { roomId: this.currentRoomId() ?? '', commitSha, coveredThroughSequence: sequence } })
          })
          this.updateQueue = operation.catch(() => undefined)
          await operation
          return new Response(null, { status: 204 })
        }
        if (url.pathname === '/internal/close' && request.method === 'POST') {
          await this.updateQueue
          await this.state.storage.put("g3:closed", true)
          for (const socket of this.state.getWebSockets()) socket.close(1000, 'Session closed')
          return new Response(null, { status: 204 })
        }
        return new Response('Unknown internal operation', { status: 404 })
      } catch (error) {
        if (error instanceof CollaborationProtocolError) return protocolError(error.code, error.message, { status: error.status }, error.recoverable)
        throw error
      }
    }

` + source.slice(end);
  source = replace(source, "          code: 'INTERNAL_ERROR',", "          code: error instanceof CollaborationProtocolError ? error.code : 'INTERNAL_ERROR',");
  source = replace(source, "          recoverable: false,\n        },\n      }))\n      socket.close(1011, 'internal room error')", "          recoverable: error instanceof CollaborationProtocolError && error.recoverable,\n        },\n      }))\n      socket.close(1011, 'internal room error')");
  source = replace(source, '      const attachment: SocketAttachment = {', String.raw`      if (roomSessionId) {
        if (!Number.isFinite(claims.exp) || claims.exp * 1000 <= Date.now()) throw new Error("Session token expired")
        const authority = await currentRoomAuthority(this.env, claims.sub, roomSessionId)
        if (authority.principalId !== claims.principalId || authority.projectId !== claims.projectId || authority.roomId !== claims.roomId) throw new Error("Current room authority changed")
        await this.checkpoints.bind(authority)
      }
      const attachment: SocketAttachment = {`);
  source = replace(source, '        principalId: claims.principalId,', '        principalId: claims.principalId,\n        identityKey: claims.sub,\n        expiresAt: claims.exp * 1000,');
  source = replace(source, '    switch (message.type) {', String.raw`    if (connection.sessionId && message.type !== 'update.push') await this.requireRoomAuthority(connection)
    switch (message.type) {`);
  source = replace(source, '      const headSeq = await this.getSessionHeadSequence()\n      const entries =', String.raw`      const headSeq = await this.getSessionHeadSequence()
      const known = protocolSequence(message.payload.knownSeq, "knownSeq")
      const floor = await this.state.storage.get<number>(ROOM_COMPACTION_FLOOR_KEY) ?? 0
      if (known < floor || known > headSeq) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "Replay cursor requires a canonical checkpoint", 409, true)
      const entries =`);
  source = replace(source, '        limit: SYNC_PAGE_SIZE,', '        limit: 1, // Bounded legacy-sized replay until chunked replay is installed.');
  source = replace(source, '      const toSeq = updates.at(-1)?.seq ?? message.payload.knownSeq', '      if (known < headSeq && updates[0]?.seq !== known + 1) throw new CollaborationProtocolError("CHECKPOINT_REQUIRED", "The next canonical update is unavailable; reload the checkpoint", 409, true)\n      const toSeq = updates.at(-1)?.seq ?? message.payload.knownSeq');
  source = replace(source, '    const retainedBytes = validateUpdateInput(message.payload)', String.raw`    const authority = await this.requireRoomAuthority(connection, true)
    const retainedBytes = validateUpdateInput(message.payload)
    const envelope = validateEncryptedCollaborationEnvelope(message.payload.updateBinary, { roomId: authority.roomId, projectId: authority.projectId, kind: "yjs_update", idempotencyKey: message.payload.idempotencyKey })
    if (envelope.keyVersion !== authority.keyVersion) throw new CollaborationProtocolError("ENCRYPTION_KEY_STALE", "Update uses an old room key; reconcile retained local work", 409, true)`);
  source = replace(source, '    const stored: StoredSessionUpdate = {', String.raw`    const encodedEnvelope = JSON.parse(new TextDecoder().decode(decodeCanonicalBase64(message.payload.updateBinary, 4 * 1024 * 1024))) as { aad: string }
    const metadata = protocolRecord(JSON.parse(new TextDecoder().decode(decodeCanonicalBase64(encodedEnvelope.aad, 8192))), "Update metadata")
    const initialization = fileInitializationOrigin(metadata.initialization)
    const receipt = initialization ? await this.checkpoints.initializationReceipt(authority, initialization, seq) : {}
    const stored: StoredSessionUpdate = {`);
  source = replace(source, '      [HEAD_SEQUENCE_KEY]: seq,', '      ...receipt,\n      [HEAD_SEQUENCE_KEY]: seq,');
  source = replace(source, '  private async handlePresencePush(', String.raw`  private async requireRoomAuthority(connection: SocketAttachment, write = false): Promise<RoomAuthority> {
    if (!connection.sessionId || !connection.identityKey || !connection.expiresAt || connection.expiresAt <= Date.now()) throw new CollaborationProtocolError("SESSION_EXPIRED", "Session authority expired; refresh the connection", 401, true)
    if (await this.state.storage.get("g3:closed")) throw new CollaborationProtocolError("DEVICE_REVOKED", "This session is closed", 403)
    const authority = await currentRoomAuthority(this.env, connection.identityKey, connection.sessionId)
    if (authority.principalId !== connection.principalId || authority.projectId !== connection.projectId || authority.roomId !== connection.roomId) throw new CollaborationProtocolError("SESSION_MISMATCH", "Socket authority does not match this room", 403)
    if (write && authority.role !== "editor") throw new CollaborationProtocolError("READ_ONLY", "Observers cannot submit shared updates", 403)
    if (write && authority.rotationRequired) throw new CollaborationProtocolError("KEY_ROTATION_REQUIRED", "Room key rotation must finish before accepting updates", 409, true)
    return authority
  }

  private async handlePresencePush(`);
  return source;
});

create("tests/collaboration/checkpointIntegration.test.ts", String.raw`/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
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

class MemoryStorage implements RoomStorage {
  data = new Map<string, unknown>()
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.data.get(key)) as T | undefined }
  async put<T>(key: string, value: T): Promise<void>
  async put(entries: Record<string, unknown>): Promise<void>
  async put<T>(key: string | Record<string, unknown>, value?: T): Promise<void> {
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
`);

mkdirSync(".agent/collaboration-evidence", { recursive: true });
writeFileSync(".agent/collaboration-candidate.json", JSON.stringify({ message: "fix: connect canonical checkpoint and initialization protocol end to end", paths: [...changed] }, null, 2));
console.log(`Prepared ${changed.size} exact file transformations for executable validation.`);
