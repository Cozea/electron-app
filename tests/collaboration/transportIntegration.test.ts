/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import { afterEach, describe, expect, it, vi } from "vitest"
import { WebSocketServer, WebSocket as Socket } from "ws"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { CollabWsProvider, type CollabSessionDescriptor } from "../../shared/CollaborationTransport"
import { SessionCheckpointClient } from "../../apps/desktop/electron/collaboration/SessionCheckpointClient"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { CollabRoom } from "../../cloudflare/worker/src/durableObjects/CollabRoom"
import { RoomCheckpointStore, ROOM_COMPACTION_FLOOR_KEY, CHECKPOINT_READ_RETENTION_MS } from "../../cloudflare/worker/src/durableObjects/RoomCheckpointStore"
import { RoomUpdateChunks } from "../../cloudflare/worker/src/durableObjects/RoomUpdateChunks"
import { signSessionToken } from "../../cloudflare/worker/src/lib/jwt"
import type { RoomStorage } from "../../cloudflare/worker/src/durableObjects/RoomCheckpointStore"
import type { RoomAuthority } from "../../shared/collaborationProtocol"
import { COLLABORATION_PROTOCOL_REVISION } from "../../shared/collaborationProtocol"
import { collaborationDigest, splitCollaborationUpdate } from "../../shared/collaborationWire"
import { encryptPayload, envelopeToBytes } from "../../shared/collaborationCipher"
import type { Env } from "../../cloudflare/worker/src/types"

const backend = vi.hoisted(() => ({ roles: new Map<string, "editor" | "observer" | "revoked">() }))
vi.mock("convex/browser", () => ({ ConvexHttpClient: class {
  async query(_reference: unknown, args: Record<string, unknown>) {
    const id = String(args.identityKey); const role = backend.roles.get(id)
    return { allowed: Boolean(role && role !== "revoked"), principalId: id, projectId: "project_transport", sessionId: "session_transport", roomId: "session:session_transport", keyVersion: 1, role: role === "observer" ? "observer" : "editor" }
  }
  async mutation() { return null }
} }))

class MemoryStorage implements RoomStorage {
  readonly data = new Map<string, unknown>()
  maxValueBytes = 0
  failNextReplayDelete = false
  async get<T>(key: string): Promise<T | undefined> { return structuredClone(this.data.get(key)) as T | undefined }
  async put<T>(key: string, value: T): Promise<void>
  async put(entries: Record<string, unknown>): Promise<void>
  async put<T>(key: string | Record<string, unknown>, value?: T): Promise<void> {
    const entries = typeof key === "string" ? [[key, value] as const] : Object.entries(key)
    if (entries.length > 128) throw new Error("Production KV batch limit exceeded")
    for (const [, item] of entries) { const bytes = Buffer.byteLength(JSON.stringify(item)); this.maxValueBytes = Math.max(this.maxValueBytes, bytes); if (bytes > 128 * 1024) throw new Error("Production KV value limit exceeded") }
    for (const [name, item] of entries) this.data.set(name, structuredClone(item))
  }
  async delete(key: string): Promise<boolean>
  async delete(keys: string[]): Promise<number>
  async delete(key: string | string[]): Promise<boolean | number> {
    const keys = typeof key === "string" ? [key] : key
    if (keys.length > 128) throw new Error("Production KV deletion limit exceeded")
    if (this.failNextReplayDelete && keys.some(name => name.startsWith("update:"))) { this.failNextReplayDelete = false; throw new Error("Injected crash during replay deletion") }
    return typeof key === "string" ? this.data.delete(key) : key.reduce((sum, name) => sum + Number(this.data.delete(name)), 0)
  }
  async list<T>(options: { prefix?: string; start?: string; end?: string; limit?: number } = {}): Promise<Map<string, T>> {
    return new Map([...this.data].sort(([a], [b]) => a < b ? -1 : a > b ? 1 : 0).filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.start || key >= options.start) && (!options.end || key < options.end)).slice(0, options.limit ?? Infinity).map(([key, value]) => [key, structuredClone(value) as T]))
  }
  async transaction<T>(operation: (storage: RoomStorage) => Promise<T>): Promise<T> {
    const before = structuredClone(this.data)
    try { return await operation(this) } catch (error) { this.data.clear(); for (const [key, value] of before) this.data.set(key, value); throw error }
  }
}
interface Frame { type: string; payload: Record<string, unknown> }
const cleanup: Array<() => Promise<void>> = []
afterEach(async () => { for (const dispose of cleanup.splice(0).reverse()) await dispose(); backend.roles.clear() })
async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  const end = Date.now() + 8000
  while (!await condition()) { if (Date.now() > end) throw new Error("Timed out awaiting real room/provider state"); await new Promise(resolve => setTimeout(resolve, 5)) }
}
const key = Buffer.alloc(32, 3).toString("base64")
const authority = (id: string, role: "editor" | "observer" = "editor"): RoomAuthority => ({ principalId: id, projectId: "project_transport", sessionId: "session_transport", roomId: "session:session_transport", keyVersion: 1, role })

async function fixture() {
  const storage = new MemoryStorage()
  const sockets = new Set<WebSocket>()
  const blockedReplay = new Set<string>()
  const emitted: Array<{ principal: string; frame: Frame }> = []
  const faults: unknown[] = []
  const state = { storage, getWebSockets: () => [...sockets], acceptWebSocket: () => {} } as unknown as DurableObjectState
  const env = { AI_GATEWAY_SECRET: "test-only-gateway", COLLAB_JWT_SECRET: "test-only-room-secret", CONVEX_URL: "https://fixture.convex.cloud" } as Env
  let room = new CollabRoom(state, env)
  const server = new WebSocketServer({ host: "127.0.0.1", port: 0 })
  await new Promise<void>(resolve => server.once("listening", resolve))
  server.on("connection", socket => {
    let attachment: Record<string, unknown> = { handshaken: false, roomId: "session:session_transport" }
    const shim = {
      serializeAttachment(value: Record<string, unknown>) { attachment = structuredClone(value) },
      deserializeAttachment() { return structuredClone(attachment) },
      send(data: string) {
        const frame = JSON.parse(data) as Frame
        const principal = String(attachment.principalId ?? "")
        emitted.push({ principal, frame })
        if (blockedReplay.has(principal) && frame.type.startsWith("sync.")) return
        if (socket.readyState === Socket.OPEN) socket.send(data)
      },
      close(code: number, reason: string) { socket.close(code, reason) },
    } as unknown as WebSocket
    sockets.add(shim)
    socket.on("message", bytes => { void room.webSocketMessage(shim, bytes.toString()).catch(error => faults.push(error)) })
    socket.on("close", () => { sockets.delete(shim); room.webSocketClose(shim) })
  })
  cleanup.push(async () => { for (const socket of server.clients) socket.terminate(); await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve())); expect(faults).toEqual([]) })
  const address = server.address()
  if (!address || typeof address === "string") throw new Error("Fixture requires TCP address")
  const url = `ws://127.0.0.1:${address.port}/collab/ws?roomId=session:session_transport`
  const descriptor = async (id: string, role: "editor" | "observer" = "editor"): Promise<CollabSessionDescriptor> => {
    backend.roles.set(id, role)
    return { projectId: "project_transport", sessionId: "session_transport", roomId: "session:session_transport", collabWsUrl: url, protocolVersion: "2.1", principalId: id, identityKey: id,
      token: await signSessionToken(env, { sub: id, principalId: id, projectId: "project_transport", sessionId: "session_transport", roomId: "session:session_transport", clientType: "electron", protocolVersion: "2.1" }),
      encryption: { roomId: "session:session_transport", encryptionRequired: true, status: "ready", activeKeyVersion: 1, wrappedRoomKey: null, wrapAlgorithm: null, senderPublicKeyJwk: null } }
  }
  const client = async (id: string, hooks: { beforePersist?: () => Promise<void>; deferCompaction?: boolean; afterCompaction?: () => Promise<void> } = {}) => {
    const session = await descriptor(id)
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-transport-"))
    cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
    const store = new DurableSessionStore(root, session.roomId, 1)
    const checkpoints = new SessionCheckpointClient({ sessionId: session.sessionId!, projectId: session.projectId, roomId: session.roomId, keyVersion: 1, roomKeyBase64: key, role: "editor", store, deferCompaction: hooks.deferCompaction,
      request: async body => {
        const response = await room.fetch(new Request("https://internal/internal/checkpoint", { method: "POST", headers: { authorization: "Bearer test-only-gateway", "content-type": "application/json" }, body: JSON.stringify({ authority: authority(id), request: body }) }))
        const result: unknown = await response.json(); if (!response.ok) throw new Error(JSON.stringify(result)); if (body.operation === "compact") await hooks.afterCompaction?.(); return result
      } })
    const initial = await checkpoints.bootstrap()
    if (!initial) throw new Error("Fixture checkpoint was not initialized")
    const doc = new Y.Doc({ gc: false }); Y.applyUpdate(doc, initial.update)
    const awareness = new Awareness(doc)
    const provider = new CollabWsProvider({ doc, awareness, session, initialKnownSeq: initial.sequence, initialAcknowledgedUpdate: initial.update, encryption: { roomKeyBase64: key, keyVersion: 1 }, outbox: store,
      onApplied: async (sequence, encoded) => { await hooks.beforePersist?.(); await store.saveAcknowledged(sequence, encoded) } })
    let stopped = false
    const stop = async () => { if (stopped) return; stopped = true; await provider.shutdown(); awareness.destroy(); doc.destroy() }
    cleanup.push(stop)
    provider.start(); await provider.waitForLocalRecovery(); await provider.waitForCatchUp()
    return { root, session, store, initial, doc, awareness, provider, checkpoints, stop }
  }
  const rawClient = async (id: string, role: "editor" | "observer" = "editor") => {
    const session = await descriptor(id, role)
    const socket = new Socket(url); const frames: Frame[] = []
    socket.on("message", data => frames.push(JSON.parse(data.toString()) as Frame))
    await new Promise<void>((resolve, reject) => { socket.once("open", resolve); socket.once("error", reject) })
    socket.send(JSON.stringify({ type: "hello", payload: { protocolVersion: "2.1", collaborationRevision: COLLABORATION_PROTOCOL_REVISION, projectId: session.projectId, roomId: session.roomId, sessionToken: session.token, clientId: id, knownSeq: 0, clientType: "electron" } }))
    await until(() => frames.some(frame => frame.type === "ready"))
    cleanup.push(async () => { socket.terminate() })
    return { socket, frames, session }
  }
  return { storage, client, rawClient, emitted, blockedReplay, restartRoom() { room = new CollabRoom(state, env) } }
}

async function ciphertext(id: string, text: string): Promise<string> {
  const doc = new Y.Doc(); doc.getText("fixture").insert(0, text)
  try { return Buffer.from(envelopeToBytes(await encryptPayload({ roomKeyBase64: key, keyVersion: 1, kind: "yjs_update", plaintext: Y.encodeStateAsUpdate(doc), metadata: { projectId: "project_transport", roomId: "session:session_transport", idempotencyKey: id } }))).toString("base64") }
  finally { doc.destroy() }
}

describe("actual transport over WebSockets and the real room", () => {
  it("T04 synchronizes a chunked update, acknowledges the exact operation and replays it to a late client", async () => {
    const f = await fixture(); const left = await f.client("left"); const right = await f.client("right")
    const text = "大型 collaborative source\n".repeat(7000)
    left.doc.getText("fixture").insert(0, text)
    await left.provider.flushLocalPersistence()
    await until(() => right.doc.getText("fixture").toString() === text && left.provider.getKnownSeq() === 1)
    await until(async () => (await left.store.list(left.session.roomId, 1)).length === 0)
    const late = await f.client("late")
    expect(late.doc.getText("fixture").toString()).toBe(text)
    expect(late.provider.getKnownSeq()).toBe(1)
    expect(f.storage.maxValueBytes).toBeLessThan(128 * 1024)
    expect(f.emitted.some(({ frame }) => frame.type === "sync.chunk")).toBe(true)
  })

  it("keeps acknowledged edits recoverable offline when canonical replay has not reached local disk", async () => {
    const f = await fixture(); const client = await f.client("offline_writer")
    f.blockedReplay.add("offline_writer")
    client.doc.getText("fixture").insert(0, "do not lose this accepted edit")
    await client.provider.flushLocalPersistence()
    await until(() => f.emitted.some(({ principal, frame }) => principal === "offline_writer" && frame.type === "update.ack"))
    await new Promise(resolve => setTimeout(resolve, 50))
    expect(client.provider.getKnownSeq()).toBe(0)
    expect(await client.store.list(client.session.roomId, 1)).toHaveLength(1)
    await client.stop()
    const doc = new Y.Doc({ gc: false }); Y.applyUpdate(doc, client.initial.update); const awareness = new Awareness(doc)
    const provider = new CollabWsProvider({ doc, awareness, session: client.session, initialKnownSeq: 0, initialAcknowledgedUpdate: client.initial.update,
      outbox: new DurableSessionStore(client.root, client.session.roomId, 1), encryption: { roomKeyBase64: key, keyVersion: 1 } })
    try { await provider.startOffline(); expect(doc.getText("fixture").toString()).toBe("do not lose this accepted edit") }
    finally { await provider.shutdown(); awareness.destroy(); doc.destroy() }
  })

  it("does not retire the outbox while the local canonical persistence callback is still waiting", async () => {
    const f = await fixture(); let entered = false; let release = () => {}
    const barrier = new Promise<void>(resolve => { release = resolve })
    const client = await f.client("durable_writer", { beforePersist: async () => { entered = true; await barrier } })
    try {
      client.doc.getText("fixture").insert(0, "durable fence")
      await until(() => entered)
      expect(await client.store.list(client.session.roomId, 1)).toHaveLength(1)
      expect(client.provider.getKnownSeq()).toBe(0)
    } finally { release() }
    await until(async () => (await client.store.list(client.session.roomId, 1)).length === 0)
    expect(client.provider.getKnownSeq()).toBe(1)
    expect((await client.store.recover()).updates).toHaveLength(1)
  })

  it("T05 survives room re-instantiation mid-upload and retries with the same sequence", async () => {
    const f = await fixture(); await f.client("initializer"); const raw = await f.rawClient("raw_writer")
    const encoded = await ciphertext("durable_chunks", "refactor\n".repeat(20_000))
    const chunks = await splitCollaborationUpdate("durable_chunks", encoded)
    raw.socket.send(JSON.stringify({ type: "update.chunk", payload: { roomId: raw.session.roomId, chunk: chunks[0], timestamp: 100 } }))
    await until(async () => Boolean(await f.storage.get("g3:incoming-update-manifests")))
    f.restartRoom()
    for (const chunk of chunks.slice(1).reverse()) raw.socket.send(JSON.stringify({ type: "update.chunk", payload: { roomId: raw.session.roomId, chunk, timestamp: 100 } }))
    await until(() => raw.frames.some(frame => frame.type === "update.ack"))
    for (const chunk of chunks) raw.socket.send(JSON.stringify({ type: "update.chunk", payload: { roomId: raw.session.roomId, chunk, timestamp: 100 } }))
    await until(() => raw.frames.filter(frame => frame.type === "update.ack").length === 2)
    expect(raw.frames.filter(frame => frame.type === "update.ack").map(frame => frame.payload.seq)).toEqual([1, 1])
    expect(await f.storage.get("head-sequence")).toBe(1)
  })

  it("T06 rejects observer writes and revoked established sockets without advancing history", async () => {
    const f = await fixture(); await f.client("initializer"); const observer = await f.rawClient("observer", "observer")
    const encoded = await ciphertext("observer_write", "not allowed")
    observer.socket.send(JSON.stringify({ type: "update.push", payload: { roomId: observer.session.roomId, idempotencyKey: "observer_write", updateBinary: encoded, timestamp: 100, authorId: "observer", authorType: "user" } }))
    await until(() => observer.frames.some(frame => frame.type === "error"))
    expect(observer.frames.find(frame => frame.type === "error")?.payload.code).toBe("READ_ONLY")
    const revoked = await f.rawClient("removed")
    backend.roles.set("removed", "revoked")
    revoked.socket.send(JSON.stringify({ type: "update.push", payload: { roomId: revoked.session.roomId, idempotencyKey: "observer_write", updateBinary: encoded, timestamp: 100, authorId: "removed", authorType: "user" } }))
    await until(() => revoked.frames.some(frame => frame.type === "error"))
    expect(revoked.frames.find(frame => frame.type === "error")?.payload.code).toBe("DEVICE_REVOKED")
    expect(await f.storage.get("head-sequence") ?? 0).toBe(0)
  })
})

describe("bounded durable chunk staging", () => {
  it("bounds concurrent reservations and expires incomplete uploads across new store handles", async () => {
    const storage = new MemoryStorage(); let now = 1000
    const encoded = "QUJD".repeat(20_000)
    for (let index = 0; index < 8; index++) {
      const chunks = await splitCollaborationUpdate(`upload_${index}`, encoded)
      await new RoomUpdateChunks(storage, () => now).accept(authority("owner"), chunks[0]!, 100)
    }
    const next = (await splitCollaborationUpdate("overflow", encoded))[0]!
    await expect(new RoomUpdateChunks(storage, () => now).accept(authority("owner"), next, 100)).rejects.toThrow("incomplete updates")
    now += 120001
    expect(await new RoomUpdateChunks(storage, () => now).accept(authority("owner"), next, 100)).toBeNull()
    expect(Object.keys(await storage.get("g3:incoming-update-manifests") ?? {})).toHaveLength(1)
  })

  it("rejects conflicting duplicate chunks and a mismatched complete digest", async () => {
    const storage = new MemoryStorage(); const store = new RoomUpdateChunks(storage)
    const chunks = await splitCollaborationUpdate("duplicate", "QUJD".repeat(20_000))
    await store.accept(authority("owner"), chunks[0]!, 100)
    await expect(store.accept(authority("owner"), { ...chunks[0]!, data: "R" + chunks[0]!.data.slice(1) }, 100)).rejects.toThrow("changed during retry")
    const bad = await splitCollaborationUpdate("bad_digest", "QUJD")
    await expect(store.accept(authority("owner"), { ...bad[0]!, digest: await collaborationDigest("AAAA") }, 100)).rejects.toThrow("checksum")
  })
})


describe("checkpoint-backed compaction over the actual transport", () => {
  it("T10 retires chunk payloads but accepts delayed exact retries at the original sequence", async () => {
    const f = await fixture(); const editor = await f.client("checkpoint_writer"); const raw = await f.rawClient("retry_writer")
    const encoded = await ciphertext("retry_after_compaction", "durable retained contents\n".repeat(9000))
    const chunks = await splitCollaborationUpdate("retry_after_compaction", encoded)
    const send = () => { for (const chunk of chunks) raw.socket.send(JSON.stringify({ type: "update.chunk", payload: { roomId: raw.session.roomId, chunk, timestamp: 100 } })) }
    send()
    await until(() => raw.frames.some(frame => frame.type === "update.ack") && editor.provider.getKnownSeq() === 1)
    expect([...f.storage.data.keys()].some(key => key.startsWith("g3:update-piece:"))).toBe(true)
    const state = editor.provider.acknowledgedCheckpoint()
    expect(await editor.checkpoints.checkpoint(state.sequence, state.update)).toBe(true)
    expect(await f.storage.get(ROOM_COMPACTION_FLOOR_KEY)).toBe(1)
    expect(await f.storage.list({ prefix: "update:" })).toHaveLength(0)
    expect([...f.storage.data.keys()].some(key => key.startsWith("g3:update-piece:"))).toBe(false)
    expect(await f.storage.get("retained-usage")).toEqual({ bytes: 0, count: 0 })
    f.restartRoom()
    send()
    await until(() => raw.frames.filter(frame => frame.type === "update.ack").length === 2)
    expect(raw.frames.filter(frame => frame.type === "update.ack").map(frame => frame.payload.seq)).toEqual([1, 1])
    expect(await f.storage.get("head-sequence")).toBe(1)
    const late = await f.client("late_after_compaction")
    expect(late.provider.getKnownSeq()).toBe(1)
    expect(late.doc.getText("fixture").toString()).toBe(editor.doc.getText("fixture").toString())
  })

  it("T11 gives a behind-floor client CHECKPOINT_REQUIRED rather than an empty replay loop", async () => {
    const f = await fixture(); const editor = await f.client("floor_writer")
    editor.doc.getText("fixture").insert(0, "checkpoint contents")
    await until(() => editor.provider.getKnownSeq() === 1)
    await editor.checkpoints.checkpoint(1, editor.provider.acknowledgedCheckpoint().update)
    const late = await f.rawClient("old_checkpoint_reader")
    late.socket.send(JSON.stringify({ type: "sync.request", payload: { roomId: late.session.roomId, knownSeq: 0 } }))
    await until(() => late.frames.some(frame => frame.type === "error"))
    expect(late.frames.find(frame => frame.type === "error")?.payload.code).toBe("CHECKPOINT_REQUIRED")
    expect(late.frames.filter(frame => frame.type === "sync.delta")).toHaveLength(0)
  })

  it("T19 survives a crash after the floor advances but before replay deletion commits", async () => {
    const f = await fixture(); const editor = await f.client("crash_writer")
    editor.doc.getText("fixture").insert(0, "durability boundary")
    await until(() => editor.provider.getKnownSeq() === 1)
    const state = editor.provider.acknowledgedCheckpoint()
    const before = await f.storage.get("retained-usage")
    f.storage.failNextReplayDelete = true
    await expect(editor.checkpoints.checkpoint(1, state.update)).rejects.toThrow("Injected crash")
    expect(await f.storage.get(ROOM_COMPACTION_FLOOR_KEY)).toBe(1)
    expect(await f.storage.list({ prefix: "update:" })).toHaveLength(1)
    expect(await f.storage.get("retained-usage")).toEqual(before)
    expect((await editor.store.recover()).checkpoint?.sequence).toBe(1)
    f.restartRoom()
    // Existing same-sequence checkpoint is reused; no second history or cipher
    // is manufactured after the local replacement already became durable.
    expect(await editor.checkpoints.checkpoint(1, state.update)).toBe(true)
    expect(await f.storage.list({ prefix: "update:" })).toHaveLength(0)
    expect(await f.storage.get("retained-usage")).toEqual({ bytes: 0, count: 0 })
    const late = await f.client("crash_late_reader")
    expect(late.doc.getText("fixture").toString()).toBe("durability boundary")
  })

  it("does not compact a partial upload or a corrupted finalized replacement", async () => {
    const f = await fixture(); const editor = await f.client("integrity_writer")
    editor.doc.getText("fixture").insert(0, "must remain recoverable")
    await until(() => editor.provider.getKnownSeq() === 1)
    const store = new RoomCheckpointStore(f.storage)
    const claimed = await store.handle(authority("integrity_writer"), { operation: "claim", sequence: 1 }) as { lease: { id: string } }
    await expect(store.handle(authority("integrity_writer"), { operation: "compact", id: claimed.lease.id })).rejects.toThrow("finalized checkpoint")
    expect(await f.storage.get(ROOM_COMPACTION_FLOOR_KEY)).toBeUndefined()
    const active = await store.current(1)
    if (!active) throw new Error("Missing checkpoint fixture")
    const pieceKey = `g3:checkpoint-piece:${active.id}:0000`
    await f.storage.put(pieceKey, "AAAA")
    await expect(store.handle(authority("integrity_writer"), { operation: "compact", id: active.id })).rejects.toThrow("checksum")
    expect(await f.storage.get(ROOM_COMPACTION_FLOOR_KEY)).toBeUndefined()
    expect(await f.storage.list({ prefix: "update:" })).toHaveLength(1)
  })

  it("keeps post-checkpoint edits in replay and rejects stale compaction requests", async () => {
    const f = await fixture(); const editor = await f.client("suffix_writer")
    editor.doc.getText("fixture").insert(0, "one")
    await until(() => editor.provider.getKnownSeq() === 1)
    const first = editor.provider.acknowledgedCheckpoint()
    await editor.checkpoints.checkpoint(1, first.update)
    const store = new RoomCheckpointStore(f.storage); const original = await store.current(1)
    editor.doc.getText("fixture").insert(3, " two")
    await until(() => editor.provider.getKnownSeq() === 2)
    expect(await f.storage.list({ prefix: "update:" })).toHaveLength(1)
    const late = await f.client("suffix_reader")
    expect(late.doc.getText("fixture").toString()).toBe("one two")
    await editor.checkpoints.checkpoint(2, editor.provider.acknowledgedCheckpoint().update)
    await expect(store.handle(authority("suffix_writer"), { operation: "compact", id: original!.id })).rejects.toThrow("current finalized checkpoint")
    expect(await f.storage.get(ROOM_COMPACTION_FLOOR_KEY)).toBe(2)
  })

  it("T25 retires only superseded same-key checkpoints after the reader grace window", async () => {
    const f = await fixture(); const editor = await f.client("cleanup_writer")
    const now = Date.now(); const store = new RoomCheckpointStore(f.storage, () => now)
    const first = await store.current(1)
    editor.doc.getText("fixture").insert(0, "still current")
    await until(() => editor.provider.getKnownSeq() === 1)
    await editor.checkpoints.checkpoint(1, editor.provider.acknowledgedCheckpoint().update)
    expect(await f.storage.get(`g3:checkpoint-descriptor:${first!.id}`)).toBeDefined()
    const afterGrace = new RoomCheckpointStore(f.storage, () => now + CHECKPOINT_READ_RETENTION_MS + 10_000)
    const current = await afterGrace.current(1)
    const allocatedBefore = await f.storage.get<number>("g3:checkpoint-allocated-chars")
    await afterGrace.handle(authority("cleanup_writer"), { operation: "compact", id: current!.id })
    expect(await f.storage.get(`g3:checkpoint-descriptor:${first!.id}`)).toBeUndefined()
    expect(await f.storage.get(`g3:checkpoint-descriptor:${current!.id}`)).toBeDefined()
    expect(await f.storage.get("g3:checkpoint-allocated-chars")).toBe(allocatedBefore! - first!.totalChars)
    expect(await f.storage.get("g3:compaction-checkpoint")).toMatchObject({ id: current!.id })
  })
})


describe("bounded and retryable compaction control", () => {
  it("T19 retries a lost compaction response without creating another checkpoint or acknowledgement", async () => {
    const f = await fixture(); let loseReply = true
    const editor = await f.client("lost_reply_writer", { afterCompaction: async () => { if (loseReply) { loseReply = false; throw new Error("Lost compact response") } } })
    editor.doc.getText("fixture").insert(0, "accepted before lost response")
    await until(() => editor.provider.getKnownSeq() === 1)
    const captured = editor.provider.acknowledgedCheckpoint()
    await expect(editor.checkpoints.checkpoint(1, captured.update)).rejects.toThrow("Lost compact response")
    expect(await f.storage.list({ prefix: "update:" })).toHaveLength(0)
    const checkpoints = await f.storage.list({ prefix: "g3:checkpoint-descriptor:" })
    expect(await editor.checkpoints.checkpoint(1, captured.update)).toBe(true)
    expect(await f.storage.list({ prefix: "g3:checkpoint-descriptor:" })).toEqual(checkpoints)
    expect(await f.storage.get("head-sequence")).toBe(1)
  })

  it("T12 bounds cleanup to 32 updates per request and resumes after room re-instantiation", async () => {
    const f = await fixture(); const editor = await f.client("paged_writer", { deferCompaction: true })
    for (let i = 0; i < 40; i++) editor.doc.getText("fixture").insert(i, "x")
    await until(() => editor.provider.getKnownSeq() === 40)
    await editor.checkpoints.checkpoint(40, editor.provider.acknowledgedCheckpoint().update)
    expect(await f.storage.get(ROOM_COMPACTION_FLOOR_KEY)).toBeUndefined()
    const store = new RoomCheckpointStore(f.storage); const current = await store.current(1)
    const page = await store.handle(authority("paged_writer"), { operation: "compact", id: current!.id })
    expect(page).toMatchObject({ compactionFloor: 40, removedUpdates: 32, hasMore: true })
    const resumed = await new RoomCheckpointStore(f.storage).handle(authority("paged_writer"), { operation: "compact", id: current!.id })
    expect(resumed).toMatchObject({ compactionFloor: 40, removedUpdates: 8, hasMore: false })
    expect(await f.storage.get("retained-usage")).toEqual({ bytes: 0, count: 0 })
    expect(await f.storage.list({ prefix: "g3:update-receipt:" })).toHaveLength(40)
  })
})
