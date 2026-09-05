import { splitCollaborationUpdate, CollaborationChunkReceiver, collaborationDigest } from "../../shared/collaborationWire"
import { encryptPayload, envelopeToBytes } from "../../apps/desktop/src/lib/collab/cipherEnvelope"
/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CollabRoom } from "../../cloudflare/worker/src/durableObjects/CollabRoom"
import type { Env } from "../../cloudflare/worker/src/types"
import { COLLAB_MAX_UPDATE_BYTES, COLLAB_MAX_RETAINED_BYTES, COLLAB_MAX_RETAINED_UPDATES, COLLAB_MAX_WINDOW_UPDATES, COLLAB_MAX_WINDOW_BYTES, reserveUpdateBudget } from "../../cloudflare/worker/src/lib/collaborationLimits"

const mocks = vi.hoisted(() => ({ token: vi.fn(), authority: vi.fn() }))
vi.mock("../../cloudflare/worker/src/lib/jwt", () => ({ verifySessionToken: mocks.token }))
vi.mock("../../cloudflare/worker/src/lib/collaborationV2Convex", () => ({ authorizeRoomConnection: mocks.authority, updateAuthoritativeRoomHead: vi.fn(async () => undefined) }))
vi.mock("../../cloudflare/worker/src/lib/convex", () => ({ fetchActiveAwarenessFromConvex: vi.fn(async () => []), fetchYjsDeltasFromConvex: vi.fn(async () => []), persistYjsUpdateToConvex: vi.fn(), upsertAwarenessInConvex: vi.fn() }))

interface Attachment { handshaken: boolean; roomId: string; mediaClientId?: string }
class Socket {
  attachment: Attachment
  send = vi.fn()
  close = vi.fn()
  constructor(roomId: string) { this.attachment = { handshaken: false, roomId } }
  serializeAttachment(value: Attachment) { this.attachment = structuredClone(value) }
  deserializeAttachment() { return this.attachment }
  asWebSocket() { return this as unknown as WebSocket }
}
function fixture() {
  const records = new Map<string, unknown>()
  const sockets: Socket[] = []
  const storage = {
    setAlarm: vi.fn(async () => undefined),
    get: vi.fn(async (key: string) => records.get(key)),
    put: vi.fn(async (keyOrValues: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrValues === "string") records.set(keyOrValues, structuredClone(value))
      else for (const [key, next] of Object.entries(keyOrValues)) records.set(key, structuredClone(next))
    }),
    list: vi.fn(async (options: DurableObjectStorageListOptions = {}) => new Map([...records].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.start || key >= options.start) && (!options.end || key < options.end)).slice(0, options.limit ?? records.size))),
    delete: vi.fn(async (keys: string | string[]) => {
      const names = Array.isArray(keys) ? keys : [keys]
      if (names.length > 128) throw new Error('Cloudflare KV deletion supports at most 128 keys')
      return names.reduce((count, key) => count + Number(records.delete(key)), 0)
    }),
    deleteAll: vi.fn(async () => records.clear()),
    transaction: vi.fn(async (run: (s: DurableObjectStorage) => Promise<unknown>) => run(storage as unknown as DurableObjectStorage)),
  }
  const state = { storage, getWebSockets: () => sockets.map((s) => s.asWebSocket()), acceptWebSocket: vi.fn() } as unknown as DurableObjectState
  const room = new CollabRoom(state, { AI_GATEWAY_SECRET: "test-room-secret" } as Env)
  const hello = async (socket: Socket, user = "u1", roomId = "session:s") => {
    sockets.push(socket)
    mocks.token.mockResolvedValue({ userId: user, deviceId: user, roomId, projectId: "p", sessionId: "s", exp: Math.floor(Date.now() / 1000) + 900 })
    await room.webSocketMessage(socket.asWebSocket(), JSON.stringify({ type: "hello", payload: { roomId, projectId: "p", clientId: "123", sessionToken: "fixture", protocolVersion: "3.0", knownSeq: 0 } }))
  }
  const update = async (socket: Socket, id = "update_1", binary?: string) => {
    const encoded = binary ?? Buffer.from(envelopeToBytes(await encryptPayload({ roomKeyBase64: Buffer.alloc(32).toString("base64"),
      kind: "yjs_update", keyVersion: 1, plaintext: new Uint8Array([0, 0]),
      metadata: { roomId: "session:s", projectId: "p", idempotencyKey: id },
    }))).toString("base64")
    return room.webSocketMessage(socket.asWebSocket(), JSON.stringify({ type: "update.push", payload: { roomId: "session:s", idempotencyKey: id, updateBinary: encoded, timestamp: Date.now(), authorType: "user", authorId: "123" } }))
  }
  return { room, records, storage, state, hello, update }
}
beforeEach(() => { vi.clearAllMocks(); mocks.authority.mockResolvedValue({ allowed: true, roomId: "session:s", projectId: "p", role: "editor", keyVersion: 1 }) })

describe("Durable Object room boundary and recovery", () => {
  it("runs checkpoint retention only after fresh room authority confirms key activation", async () => {
    const f = fixture()
    const encrypted = Buffer.from(envelopeToBytes(await encryptPayload({ roomKeyBase64: Buffer.alloc(32).toString('base64'),
      kind: 'yjs_snapshot', keyVersion: 3, plaintext: new Uint8Array([0, 0]),
      metadata: { roomId: 'session:s', projectId: 'p', snapshotBaseSeq: 2 },
    }))).toString('base64')
    const current = { generation: 3, id: 'current', roomId: 'session:s', projectId: 'p', keyVersion: 3, sequence: 2,
      chunkCount: 1, totalChars: encrypted.length, digest: await collaborationDigest(encrypted), createdAt: 1 }
    f.records.set('head-sequence', 2)
    f.records.set('encrypted-checkpoint', current)
    f.records.set('checkpoint-piece:current:0', encrypted)
    f.records.set('checkpoint-history:1', { ...current, id: 'previous', keyVersion: 1 })
    f.records.set('checkpoint-piece:previous:0', 'retained old encrypted state')
    const inspect = (authorized = true) => f.room.fetch(new Request('https://internal/internal/checkpoint', {
      method: 'POST', headers: authorized ? { authorization: 'Bearer test-room-secret' } : {},
      body: JSON.stringify({ authority: { userId: 'u1', sessionId: 's', roomId: 'session:s', projectId: 'p', keyVersion: 3, role: 'editor' }, request: { operation: 'inspect' } }),
    }))
    expect((await inspect(false)).status).toBe(403)
    expect((await inspect()).status).toBe(409) // Caller-selected version disagrees with fresh authority.
    expect(f.records.has('checkpoint-history:1')).toBe(true)
    mocks.authority.mockResolvedValue({ allowed: true, roomId: 'session:s', projectId: 'p', keyVersion: 3, role: 'editor', rotationRequired: true })
    expect((await inspect()).status).toBe(200)
    expect(f.records.has('checkpoint-history:1')).toBe(true)
    mocks.authority.mockResolvedValue({ allowed: true, roomId: 'session:s', projectId: 'p', keyVersion: 3, role: 'editor', rotationRequired: false })
    expect(await (await inspect()).json()).toMatchObject({ checkpoint: current })
    expect(f.records.has('checkpoint-history:1')).toBe(false)
    expect(f.records.has('checkpoint-piece:current:0')).toBe(true)
  })

  it("compacts a published page of chunked updates within the platform deletion limit", async () => {
    const f = fixture()
    for (let seq = 1; seq <= 130; seq++) {
      f.records.set(`update:${String(seq).padStart(16, '0')}`, { seq, chunkCount: 2, retainedBytes: 2048, idempotencyKey: `operation-${seq}`, clientId: 'client', timestamp: seq })
      for (let index = 0; index < 2; index++) f.records.set(`update-piece:${seq}:${index}`, 'encrypted-piece')
      f.records.set(`idempotency:operation-${seq}`, { seq, digest: 'deduplication-receipt' })
    }
    f.records.set('head-sequence', 131)
    f.records.set('encrypted-checkpoint', { sequence: 130 })
    f.records.set('retained-usage', { bytes: 130 * 2048 + 7, count: 131 })
    const newer = { seq: 131, retainedBytes: 7, updateBinary: 'newer', idempotencyKey: 'pending', clientId: 'other', timestamp: 131 }
    f.records.set('update:0000000000000131', newer)
    const response = await f.room.fetch(new Request('https://internal/internal/base-advanced', { method: 'POST',
      headers: { authorization: 'Bearer test-room-secret' },
      body: JSON.stringify({ roomId: 'session:s', commitSha: 'a'.repeat(40), coveredThroughSequence: 130, publicationRevision: 1, publicationId: 'published' }),
    }))
    expect(response.status).toBe(204)
    expect([...f.records.keys()].filter(name => name.startsWith('update-piece:'))).toEqual([])
    expect(f.records.get('update:0000000000000131')).toEqual(newer)
    expect(f.records.get('retained-usage')).toEqual({ bytes: 7, count: 1 })
    expect(f.storage.delete.mock.calls.length).toBeGreaterThan(1)
    expect([...f.records.keys()].filter(name => name.startsWith('idempotency:'))).toHaveLength(130)
  })

  it("authenticates publication handoffs and orders binary-only publications at the same barrier", async () => {
    const f = fixture(); const socket = new Socket("session:s")
    await f.hello(socket); await f.update(socket)
    const delivery = (revision: number, sha: string, authorized = true) => f.room.fetch(new Request("https://internal/internal/base-advanced", {
      method: "POST", headers: authorized ? { authorization: "Bearer test-room-secret" } : {},
      body: JSON.stringify({ roomId: "session:s", commitSha: sha, coveredThroughSequence: 1, publicationRevision: revision, publicationId: `publication-${revision}` }),
    }))
    expect((await delivery(1, "a".repeat(40), false)).status).toBe(403)
    expect(f.records.get("published-base")).toBeUndefined()
    await delivery(1, "a".repeat(40))
    await delivery(2, "b".repeat(40))
    await delivery(1, "a".repeat(40))
    expect(f.records.get("published-base")).toMatchObject({ commitSha: "b".repeat(40), publicationRevision: 2 })
    await delivery(2, "b".repeat(40))
    const fresh = new Socket("session:s"); await f.hello(fresh, "u2")
    expect(fresh.send.mock.calls.map(([raw]) => JSON.parse(raw)).find(message => message.type === "base.advanced")).toMatchObject({ payload: { commitSha: "b".repeat(40), coveredThroughSequence: 1 } })
    expect(f.records.has("update:0000000000000001")).toBe(true)
  })

  it("rejects a token for room A routed to room B before attaching or storing", async () => {
    const f = fixture(); const socket = new Socket("session:other")
    await f.hello(socket)
    expect(socket.close).toHaveBeenCalledWith(1008, "Invalid session token")
    expect(socket.attachment.handshaken).toBe(false)
    expect(f.storage.put).not.toHaveBeenCalled()
  })

  it("does not let duplicate caller-selected document IDs impersonate media peers", async () => {
    const f = fixture(); const a = new Socket("session:s"); const b = new Socket("session:s")
    await f.hello(a, "u1"); await f.hello(b, "u2")
    expect(a.attachment.mediaClientId).not.toBe(b.attachment.mediaClientId)
    expect(a.attachment.mediaClientId).toMatch(/^u1:/)
    b.send.mockClear()
    const signal = (sourceClientId: string) => f.room.webSocketMessage(a.asWebSocket(), JSON.stringify({ type: "media.signal", payload: { roomId: "session:s", sourceClientId, targetClientId: b.attachment.mediaClientId, signal: { type: "offer" } } }))
    await signal(b.attachment.mediaClientId!)
    expect(b.send).not.toHaveBeenCalled()
    await signal(a.attachment.mediaClientId!)
    expect(JSON.parse(b.send.mock.calls[0][0])).toMatchObject({ payload: { sourceClientId: a.attachment.mediaClientId } })
  })

  it("processes the next update after a storage failure instead of poisoning the queue", async () => {
    const f = fixture(); const a = new Socket("session:s"); const b = new Socket("session:s")
    await f.hello(a); await f.hello(b, "u2")
    f.storage.put.mockRejectedValueOnce(new Error("transient storage failure"))
    await f.update(a)
    expect(a.close).toHaveBeenCalledWith(1011, "internal room error")
    await f.update(b, "update_2")
    expect(f.records.get("head-sequence")).toBe(1)
    expect(b.send.mock.calls.map(([raw]) => JSON.parse(raw)).some((m) => m.type === "update.ack")).toBe(true)
  })

  it("rejects idempotency-key reuse with different bytes", async () => {
    const f = fixture(); const a = new Socket("session:s")
    await f.hello(a); await f.update(a)
    const before = structuredClone(f.records)
    await f.update(a, "update_1", "eQ==")
    expect(f.records).toEqual(before)
    expect(a.close).toHaveBeenCalledWith(1011, "internal room error")
  })

  it.each(["frame", "retained-bytes", "retained-count", "rate-count", "rate-bytes"])("rejects the %s limit before writing a sequence or idempotency record", async (kind) => {
    const f = fixture(); const a = new Socket("session:s"); await f.hello(a)
    if (kind === "retained-bytes") f.records.set("retained-usage", { bytes: COLLAB_MAX_RETAINED_BYTES, count: 1 })
    if (kind === "retained-count") f.records.set("retained-usage", { bytes: 1, count: COLLAB_MAX_RETAINED_UPDATES })
    if (kind.startsWith("rate")) f.records.set("rate:u1", { startedAt: Date.now(), bytes: kind === "rate-bytes" ? COLLAB_MAX_WINDOW_BYTES : 0, count: kind === "rate-count" ? COLLAB_MAX_WINDOW_UPDATES : 0 })
    const before = structuredClone(f.records)
    await f.update(a, "update_1", kind === "frame" ? "A".repeat(COLLAB_MAX_UPDATE_BYTES + 1) : "eA==")
    expect(f.storage.put).not.toHaveBeenCalled()
    expect(f.records).toEqual(before)
    expect(a.close).toHaveBeenCalled()
  })

  it("counts old persisted records toward retention on upgrade", async () => {
    const f = fixture(); const a = new Socket("session:s"); await f.hello(a)
    f.records.set("update:0000000000000001", { seq: 1, updateBinary: "eA==", idempotencyKey: "old", timestamp: 0, retainedBytes: COLLAB_MAX_RETAINED_BYTES })
    f.records.set("head-sequence", 1)
    await f.update(a)
    expect(f.storage.put).not.toHaveBeenCalled()
    expect(f.records.get("head-sequence")).toBe(1)
  })

  it("allows another rate window without resetting the retained budget", () => {
    const result = reserveUpdateBudget({ bytes: 1, count: 1 }, { startedAt: 0, bytes: COLLAB_MAX_WINDOW_BYTES, count: COLLAB_MAX_WINDOW_UPDATES }, 100, 10_000)
    expect(result).toEqual({ usage: { bytes: 101, count: 2 }, rate: { startedAt: 10_000, bytes: 100, count: 1 } })
  })
})


describe("live participant authority", () => {
  it("denies observer edits", async () => {
    const f = fixture(); const socket = new Socket("session:s")
    mocks.authority.mockResolvedValue({ allowed: true, roomId: "session:s", projectId: "p", role: "observer" })
    await f.hello(socket)
    await f.update(socket)
    expect(f.records.get("head-sequence")).toBeUndefined()
    expect(socket.close).toHaveBeenCalledWith(1011, "internal room error")
  })
  it("denies a connected editor after revocation", async () => {
    const f = fixture(); const socket = new Socket("session:s")
    await f.hello(socket)
    mocks.authority.mockResolvedValue({ allowed: false })
    await f.update(socket)
    expect(f.records.get("head-sequence")).toBeUndefined()
    expect(socket.close).toHaveBeenCalled()
  })
})


describe("encrypted room frame behavior", () => {
  it("rejects arbitrary base64 and ciphertext for a different room before durability", async () => {
    const f = fixture(); const socket = new Socket("session:s")
    await f.hello(socket)
    await f.update(socket, "bad", "eA==")
    expect(f.records.get("head-sequence")).toBeUndefined()
    const wrongRoom = Buffer.from(envelopeToBytes(await encryptPayload({
      roomKeyBase64: Buffer.alloc(32).toString("base64"), kind: "yjs_update", keyVersion: 1,
      plaintext: new Uint8Array([0, 0]), metadata: { roomId: "session:other", projectId: "p", idempotencyKey: "wrong" },
    }))).toString("base64")
    await f.update(socket, "wrong", wrongRoom)
    expect(f.records.get("head-sequence")).toBeUndefined()
  })

  it("atomically assembles an oversized update across hibernation, retries, and bounded catch-up frames", async () => {
    const f = fixture(); const socket = new Socket("session:s")
    await f.hello(socket)
    const encoded = Buffer.from(envelopeToBytes(await encryptPayload({
      roomKeyBase64: Buffer.alloc(32).toString("base64"), kind: "yjs_update", keyVersion: 1,
      plaintext: new Uint8Array(180_000), metadata: { roomId: "session:s", projectId: "p", idempotencyKey: "large" },
    }))).toString("base64")
    const chunks = await splitCollaborationUpdate("large", encoded)
    const send = (room: CollabRoom, chunk: typeof chunks[number]) => room.webSocketMessage(socket.asWebSocket(), JSON.stringify({
      type: "update.chunk", payload: { roomId: "session:s", chunk, timestamp: 1 },
    }))
    await send(f.room, chunks[0]!)
    expect(f.records.get("head-sequence")).toBeUndefined()
    const resumed = new CollabRoom(f.state, {} as Env)
    for (const chunk of [...chunks].reverse()) await send(resumed, chunk)
    expect(f.records.get("head-sequence")).toBe(1)
    for (const chunk of chunks) await send(resumed, chunk)
    expect(f.records.get("head-sequence")).toBe(1)
    for (const value of f.records.values()) expect(JSON.stringify(value).length).toBeLessThan(128 * 1024)
    socket.send.mockClear()
    await resumed.webSocketMessage(socket.asWebSocket(), JSON.stringify({ type: "sync.request", payload: { roomId: "session:s", knownSeq: 0 } }))
    const receiver = new CollaborationChunkReceiver()
    let reassembled: string | null = null
    for (const [frame] of socket.send.mock.calls) {
      expect(Buffer.byteLength(frame)).toBeLessThan(128 * 1024)
      const message = JSON.parse(frame)
      if (message.type === "sync.chunk") reassembled = await receiver.accept(message.payload.chunk)
    }
    expect(reassembled).toBe(encoded)
  })

  it("disconnects an idle revoked participant on the room alarm", async () => {
    const f = fixture(); const socket = new Socket("session:s")
    await f.hello(socket)
    mocks.authority.mockResolvedValue({ allowed: false })
    await f.room.alarm()
    expect(socket.close).toHaveBeenCalledWith(1008, "Session authority changed")
    expect(socket.attachment.handshaken).toBe(false)
  })

  it("does not prune CRDT recovery on publication without an encrypted checkpoint", async () => {
    const f = fixture(); const socket = new Socket("session:s")
    await f.hello(socket); await f.update(socket)
    await f.room.fetch(new Request("https://internal/internal/base-advanced", { method: "POST", headers: { authorization: "Bearer test-room-secret" }, body: JSON.stringify({ roomId: "session:s", publicationRevision: 1, commitSha: "a".repeat(40), coveredThroughSequence: 1 }) }))
    expect(f.records.has("update:0000000000000001")).toBe(true)
    await f.room.fetch(new Request("https://internal/internal/close", { method: "POST", headers: { authorization: "Bearer test-room-secret" } }))
    expect(f.records.has("update:0000000000000001")).toBe(true)
  })
})
