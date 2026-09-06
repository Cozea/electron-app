/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import { beforeEach, describe, expect, it, vi } from "vitest"
import { CollabRoom } from "../../cloudflare/worker/src/durableObjects/CollabRoom"
import type { Env } from "../../cloudflare/worker/src/types"
import { COLLAB_MAX_UPDATE_BYTES, COLLAB_MAX_RETAINED_BYTES, COLLAB_MAX_RETAINED_UPDATES, COLLAB_MAX_WINDOW_UPDATES, COLLAB_MAX_WINDOW_BYTES, reserveUpdateBudget } from "../../cloudflare/worker/src/lib/collaborationLimits"

const mocks = vi.hoisted(() => ({ token: vi.fn() }))
vi.mock("../../cloudflare/worker/src/lib/jwt", () => ({ verifySessionToken: mocks.token }))
vi.mock("../../cloudflare/worker/src/lib/collaborationV2Convex", () => ({ updateAuthoritativeRoomHead: vi.fn(async () => undefined) }))
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
    get: vi.fn(async (key: string) => records.get(key)),
    put: vi.fn(async (keyOrValues: string | Record<string, unknown>, value?: unknown) => {
      if (typeof keyOrValues === "string") records.set(keyOrValues, structuredClone(value))
      else for (const [key, next] of Object.entries(keyOrValues)) records.set(key, structuredClone(next))
    }),
    list: vi.fn(async (options: DurableObjectStorageListOptions = {}) => new Map([...records].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.start || key >= options.start) && (!options.end || key < options.end)).slice(0, options.limit ?? records.size))),
    delete: vi.fn(async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) records.delete(key); return true }),
    deleteAll: vi.fn(async () => records.clear()),
    transaction: vi.fn(async (run: (s: DurableObjectStorage) => Promise<unknown>) => run(storage as unknown as DurableObjectStorage)),
  }
  const state = { storage, getWebSockets: () => sockets.map((s) => s.asWebSocket()), acceptWebSocket: vi.fn() } as unknown as DurableObjectState
  const room = new CollabRoom(state, {} as Env)
  const hello = async (socket: Socket, user = "u1", roomId = "session:s") => {
    sockets.push(socket)
    mocks.token.mockResolvedValue({ userId: user, deviceId: user, roomId, projectId: "p", sessionId: "s" })
    await room.webSocketMessage(socket.asWebSocket(), JSON.stringify({ type: "hello", payload: { roomId, projectId: "p", clientId: "123", sessionToken: "fixture", protocolVersion: "2.1", knownSeq: 0 } }))
  }
  const update = (socket: Socket, id = "update_1", binary = "eA==") => room.webSocketMessage(socket.asWebSocket(), JSON.stringify({ type: "update.push", payload: { roomId: "session:s", idempotencyKey: id, updateBinary: binary, timestamp: Date.now(), authorType: "user", authorId: "123" } }))
  return { room, records, storage, hello, update }
}
beforeEach(() => vi.clearAllMocks())

describe("Durable Object room boundary and recovery", () => {
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
