/* oxlint-disable typescript/triple-slash-reference -- Isolated Worker globals. */
/* oxlint-disable unicorn/no-useless-spread -- Owned runtime collections mutate during shutdown. */
/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import { afterEach, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import { execFileSync } from "node:child_process"
import path from "node:path"
import * as Y from "yjs"
import { SessionFileDocument } from "../../shared/SessionFileDocument"
import { SessionRuntimeHost } from "../../apps/desktop/electron/collaboration/SessionRuntimeHost"
import { SessionWorkspaceCoordinator } from "../../apps/desktop/electron/collaboration/SessionWorkspaceCoordinator"
import { CollaborationSessionRuntime } from "../../apps/desktop/electron/collaboration/CollaborationSessionRuntime"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { SessionCheckpointClient } from "../../apps/desktop/electron/collaboration/SessionCheckpointClient"
import { migrateSessionKeyRecovery } from "../../apps/desktop/electron/collaboration/SessionKeyRecovery"
import { bytesToEnvelope, decryptPayload } from "../../shared/collaborationCipher"
import { readOfflineRecovery } from "../../apps/desktop/electron/collaboration/SessionOfflineRecovery"
import { CollabRoom } from "../../cloudflare/worker/src/durableObjects/CollabRoom"
import { handleCheckpointOperation } from "../../cloudflare/worker/src/lib/collaborationCheckpoints"
import type { Env } from "../../cloudflare/worker/src/types"
import type { CollabSessionDescriptor } from "../../shared/CollaborationTransport"
import type { FileInitializationLease } from "../../shared/collaborationFileInitialization"
const gateway = vi.hoisted(() => ({ post: async (_route: string, _body: unknown): Promise<unknown> => { throw new Error("Unexpected host gateway request") } }))
vi.mock("electron", () => ({ safeStorage: { isEncryptionAvailable: () => true, encryptString: (value: string) => Buffer.from(value), decryptString: (value: Buffer) => value.toString() } }))
vi.mock("../../apps/desktop/electron/collabKeys", () => ({ ensureCollabDeviceIdentity: async () => ({ deviceId: "alice", publicKeyJwk: "test-device-key" }), unwrapRoomKeyFromSender: async ({ wrappedKey }: { wrappedKey: string }) => ({ roomKeyBase64: wrappedKey }) }))
vi.mock("../../apps/desktop/electron/collaboration/DeviceCollaborationGateway", () => ({ DeviceCollaborationGateway: class { post(route: string, body: unknown) { return gateway.post(route, body) }; async accessToken() { return "test-access" } }, CollaborationGatewayUnavailable: class extends Error {} }))
vi.mock("../../apps/desktop/electron/collaboration/NativeWorkspaceBridge", () => ({ activateNativeWorkspaceRoot: async () => {} }))
const auth = vi.hoisted(() => ({ keyVersion: 1, observer: new Set<string>(), revoked: new Set<string>() }))
vi.mock("../../cloudflare/worker/src/lib/jwt", () => ({ verifySessionToken: async (_env: unknown, token: string) => ({ userId: token, deviceId: token, projectId: "p", sessionId: "s", roomId: "session:s", exp: Math.floor(Date.now() / 1000) + 900 }) }))
vi.mock("../../cloudflare/worker/src/lib/collaborationV2Convex", () => ({ authorizeRoomConnection: async (_env: unknown, user: string) => ({ allowed: !auth.revoked.has(user), roomId: "session:s", projectId: "p", role: auth.observer.has(user) ? "observer" : "editor", keyVersion: auth.keyVersion }), updateAuthoritativeRoomHead: async () => {} }))
vi.mock("../../cloudflare/worker/src/lib/convex", () => ({ fetchActiveAwarenessFromConvex: async () => [], fetchYjsDeltasFromConvex: async () => [], persistYjsUpdateToConvex: async () => {}, upsertAwarenessInConvex: async () => {} }))
afterEach(() => vi.unstubAllGlobals())
const eventually = (check: () => void | Promise<void>) => vi.waitFor(check, { timeout: 5000 })
const key = (keyVersion: number) => ({ keyVersion, roomKeyBase64: Buffer.alloc(32, keyVersion).toString("base64") })
const initialization = (encoded: string) => JSON.parse(Buffer.from(JSON.parse(Buffer.from(encoded, "base64").toString()).aad, "base64").toString()).initialization
async function fixture() {
  auth.keyVersion = 1; auth.observer.clear(); auth.revoked.clear()
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-initializer-recovery-"))
  const records = new Map<string, unknown>(), sockets: WebSocket[] = [], runtimes: CollaborationSessionRuntime[] = []
  const faults = { drop: "" as "" | "initializer" | "all" | "ack", failJournal: false, pendingAcks: [] as Array<() => void>, blockedUser: "" }
  const storage = {
    get: async (id: string) => structuredClone(records.get(id)),
    put: async (values: string | Record<string, unknown>, value?: unknown) => { for (const [id, next] of typeof values === "string" ? [[values, value]] : Object.entries(values)) records.set(id as string, structuredClone(next)) },
    delete: async (ids: string | string[]) => { for (const id of Array.isArray(ids) ? ids : [ids]) records.delete(id) },
    list: async (options: DurableObjectStorageListOptions = {}) => new Map([...records].sort(([a], [b]) => a.localeCompare(b)).filter(([id]) => (!options.prefix || id.startsWith(options.prefix)) && (!options.start || id >= options.start) && (!options.end || id < options.end)).slice(0, options.limit ?? records.size)),
    setAlarm: async () => {}, transaction: async (run: (s: DurableObjectStorage) => Promise<unknown>) => run(storage as unknown as DurableObjectStorage),
  } as unknown as DurableObjectStorage
  const room = new CollabRoom({ storage, getWebSockets: () => sockets } as unknown as DurableObjectState, {} as Env)
  class LocalSocket {
    static OPEN = 1; static CONNECTING = 0
    readyState = 0; user = ""
    onopen: (() => void) | null = null; onclose: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null; onerror: (() => void) | null = null
    private server: WebSocket
    constructor() {
      let attachment: unknown = { handshaken: false, roomId: "session:s" }
      this.server = { readyState: 1, serializeAttachment: (value: unknown) => { attachment = structuredClone(value) }, deserializeAttachment: () => attachment,
        send: (data: string) => { if (this.user === "alice" && faults.drop === "ack" && JSON.parse(data).type === "update.ack") { faults.pendingAcks.push(() => this.onmessage?.({ data })); return; } queueMicrotask(() => this.onmessage?.({ data })) }, close: () => this.close(),
      } as unknown as WebSocket
      sockets.push(this.server); queueMicrotask(() => { if (this.readyState !== 3) { this.readyState = 1; this.onopen?.() } })
    }
    send(data: string) {
      const frame = JSON.parse(data)
      if (frame.type === "hello") this.user = frame.payload.sessionToken
      if (this.user === faults.blockedUser && frame.type === "update.push") return
      if (this.user === "alice" && frame.type === "update.push" && (faults.drop === "all" || faults.drop === "initializer" && initialization(frame.payload.updateBinary))) return
      void room.webSocketMessage(this.server, data)
    }
    close() { if (this.readyState === 3) return; this.readyState = 3; const index = sockets.indexOf(this.server); if (index >= 0) sockets.splice(index, 1); this.onclose?.() }
  }
  vi.stubGlobal("WebSocket", LocalSocket)
  const store = (user: string, version = auth.keyVersion) => new DurableSessionStore(path.join(root, user), "session:s", version)
  const make = (user: string, offline = false, projection = false, external = false) => {
    const version = auth.keyVersion, role = auth.observer.has(user) ? "observer" : "editor", local = store(user, version)
    if (faults.failJournal) vi.spyOn(local, "saveRecoveryJournal").mockRejectedValueOnce(new Error("simulated journal crash"))
    const request = (body: Record<string, unknown>) => {
      if (auth.revoked.has(user)) return Promise.reject(new Error("revoked"))
      return handleCheckpointOperation(storage, { userId: user, role: auth.observer.has(user) ? "observer" : "editor", roomId: "session:s", projectId: "p", keyVersion: auth.keyVersion }, body)
    }
    const claimFile = async (fileId: string) => await request({ operation: "file.claim", fileId }) as { lease?: FileInitializationLease; sequence?: number; waiting?: boolean }
    const session: CollabSessionDescriptor = { projectId: "p", sessionId: "s", roomId: "session:s", deviceId: user, collabWsUrl: "wss://room.test", token: user, protocolVersion: "3.0", encryption: { roomId: "session:s", encryptionRequired: true, status: "ready", activeKeyVersion: version, wrappedRoomKey: null, wrapAlgorithm: null, senderPublicKeyJwk: null } }
    const checkpoints = new SessionCheckpointClient({ sessionId: "s", projectId: "p", roomId: "session:s", role, ...key(version), store: local, request })
    const runtime = new CollaborationSessionRuntime({ sessionId: "s", role, session, offline, encryption: key(version), store: local, checkpoints, refreshSession: async () => session,
      claimFile, readBaseFile: async relative => relative === "a.ts" ? { content: "base", executable: false } : null,
      beforeReplay: (acknowledgedUpdate, canonicalState) => migrateSessionKeyRecovery({ root: path.join(root, user), projectId: "p", sessionId: "s", roomId: "session:s", previous: Array.from({ length: version - 1 }, (_, i) => key(i + 1)), next: key(version), acknowledgedUpdate, canonicalState, claimFile, role }),
      ...(projection ? { projection: { root: path.join(root, user, "workspace"), recoveryRoot: path.join(root, user, "retained") } } : {}),
      ...(external ? {
        shouldTrackExternal: async relative => Boolean(await fs.lstat(path.join(root, user, "workspace", relative)).then(stat => stat.isFile() && !stat.isSymbolicLink(), () => false)),
        externalChanges: () => SessionWorkspaceCoordinator.prototype.externalChanges.call({
          workspaceForSession: async () => ({ projectRootPath: path.join(root, user, "workspace") }),
          git: async (cwd: string, args: string[]) => execFileSync("git", args, { cwd }).toString(),
        } as unknown as SessionWorkspaceCoordinator, "s"),
        changedPaths: () => SessionWorkspaceCoordinator.prototype.changedPaths.call({
          workspaceForSession: async () => ({ projectRootPath: path.join(root, user, "workspace") }),
          git: async (cwd: string, args: string[]) => execFileSync("git", args, { cwd }).toString(),
        } as unknown as SessionWorkspaceCoordinator, "s"),
      } : {}),
      onPublication: () => {}, onAuthorityFailure: () => {},
    })
    runtimes.push(runtime); return runtime
  }
  const stop = async (runtime: CollaborationSessionRuntime) => { await runtime.stop(); runtimes.splice(runtimes.indexOf(runtime), 1) }
  const rotate = async (canonical: CollaborationSessionRuntime) => {
    const update = canonical.editorState(), sequence = canonical.snapshot().sequence
    const next = auth.keyVersion + 1
    for (const runtime of [...runtimes]) await stop(runtime)
    const request = (body: Record<string, unknown>) => handleCheckpointOperation(storage, { userId: "bob", role: "editor", roomId: "session:s", projectId: "p", keyVersion: next, previousKeyVersion: auth.keyVersion }, body)
    const client = new SessionCheckpointClient({ sessionId: "s", projectId: "p", roomId: "session:s", role: "editor", ...key(next), store: store("bob", next), request })
    const claim = await request({ operation: "claim", sequence }) as { lease: import("../../shared/collaborationCheckpoint").CheckpointUploadLease }
    await client.upload(claim.lease, update)
    auth.keyVersion = next; faults.drop = ""
  }
  const edit = async (runtime: CollaborationSessionRuntime, id: string, text: string) => {
    const doc = new Y.Doc({ gc: false }); Y.applyUpdate(doc, runtime.editorState())
    const vector = Y.encodeStateVector(doc); doc.getText(`file-content:${id}`).insert(doc.getText(`file-content:${id}`).length, text)
    const update = Y.encodeStateAsUpdate(doc, vector); doc.destroy(); await runtime.applyEditorUpdate(update)
  }
  const pending = async (alice: CollaborationSessionRuntime) => {
    const opening = alice.openFile("a.ts"); void opening.catch(() => {})
    await eventually(async () => expect((await store("alice").list("session:s", auth.keyVersion)).some(record => initialization(record.updateBinary))).toBe(true))
    return alice.files.resolvePath("a.ts")!
  }
  const competing = async () => {
    const alice = make("alice"), bob = make("bob"); await alice.start(); await bob.start()
    faults.drop = "all"; const file = await pending(alice); await edit(alice, file.id, " offline")
    const lease = records.get(`file-initialization:${file.id}`) as FileInitializationLease
    records.set(`file-initialization:${file.id}`, { ...lease, expiresAt: 0 })
    await bob.openFile("a.ts"); await edit(bob, file.id, " canonical"); await bob.captureCommit(); await rotate(bob)
    return file
  }
  return { root, records, storage, faults, store, make, stop, rotate, edit, pending, competing, cleanup: async () => { faults.drop = ""; for (const reply of faults.pendingAcks.splice(0)) reply(); for (const runtime of [...runtimes]) await stop(runtime); await fs.rm(root, { recursive: true, force: true }) } }
}

it("recovers an unaccepted initializer across rotation even when dependent edits were already ACKed but not materialized", async () => {
  const f = await fixture()
  try {
    const alice = f.make("alice"), bob = f.make("bob"); await alice.start(); await bob.start()
    f.faults.drop = "initializer"
    const file = await f.pending(alice)
    await f.edit(alice, file.id, " offline")
    await eventually(() => expect(bob.snapshot().sequence).toBe(1))
    expect(bob.files.file(file.id)).toBeNull()
    await f.rotate(bob)
    const resumed = f.make("alice"); await resumed.start(); await resumed.captureCommit()
    expect(resumed.files.file(file.id)?.content).toBe("base offline")
    expect(resumed.recoveredFiles()).toEqual([])
    expect(await f.store("alice", 1).list("session:s", 1)).toEqual([])
  } finally { await f.cleanup() }
})

it("recovers accepted initializer-dependent edits from a real compacted checkpoint", async () => {
  const f = await fixture()
  try {
    const alice = f.make("alice"), bob = f.make("bob"); await alice.start(); await bob.start()
    f.faults.drop = "initializer"
    const file = await f.pending(alice); await f.edit(alice, file.id, " compacted offline")
    await eventually(() => expect(bob.snapshot().sequence).toBe(1))
    await alice.checkpointPublished(1)
    const compacted = await f.store("alice", 1).recover()
    expect(compacted.checkpoint?.sequence).toBe(1)
    expect(compacted.updates).toEqual([])
    const lease = f.records.get(`file-initialization:${file.id}`) as FileInitializationLease
    f.records.set(`file-initialization:${file.id}`, { ...lease, expiresAt: 0 })
    await bob.openFile("a.ts"); await f.edit(bob, file.id, " canonical"); await bob.captureCommit()
    await f.rotate(bob)
    const resumed = f.make("alice"); await resumed.start()
    expect(resumed.files.file(file.id)?.content).toBe("base canonical")
    expect(resumed.recoveredFiles().some(file => file.content === "base compacted offline")).toBe(true)
    expect(resumed.recoveryEntries().every(entry => !entry.incomplete)).toBe(true)
  } finally { await f.cleanup() }
})

it("uses canonical catch-up beyond a lagging checkpoint for an accepted initializer whose ACK was lost", async () => {
  const f = await fixture()
  try {
    const alice = f.make("alice"), bob = f.make("bob"); await alice.start(); await bob.start()
    f.faults.drop = "ack"; const file = await f.pending(alice)
    await eventually(() => expect(bob.files.file(file.id)?.content).toBe("base"))
    expect((f.records.get("encrypted-checkpoint") as { sequence: number }).sequence).toBe(0)
    await f.stop(alice); f.faults.drop = ""
    const resumed = f.make("alice"); await resumed.start()
    expect(resumed.files.file(file.id)?.content).toBe("base")
    expect(await f.store("alice", 1).list("session:s", 1)).toEqual([])
    expect(resumed.recoveredFiles()).toEqual([])
  } finally { await f.cleanup() }
})

it("quarantines competing multi-file history, stays usable and preserves partial resolution through a second rotation", async () => {
  const f = await fixture()
  try {
    const alice = f.make("alice"), bob = f.make("bob"); await alice.start(); await bob.start()
    f.faults.drop = "all"; const file = await f.pending(alice)
    await f.edit(alice, file.id, " offline")
    await alice.createFile("other.ts", "other unpublished text")
    const lease = f.records.get(`file-initialization:${file.id}`) as FileInitializationLease; lease.expiresAt = 0; f.records.set(`file-initialization:${file.id}`, lease)
    await bob.openFile("a.ts"); await f.edit(bob, file.id, " canonical"); await bob.captureCommit()
    await f.rotate(bob)
    const resumed = f.make("alice"); await resumed.start()
    expect(resumed.files.file(file.id)?.content).toBe("base canonical")
    const recovered = resumed.recoveredFiles(); expect(recovered.map(file => file.content).sort()).toEqual(["base offline", "other unpublished text"])
    const first = recovered.find(file => file.path === "a.ts")!
    await resumed.resolveRecovered({ recoveryId: first.recoveryId, fileId: first.id, action: "save", path: "recovered.ts" })
    expect(resumed.files.resolvePath("recovered.ts")?.content).toBe("base offline")
    expect(await f.store("alice", 1).list("session:s", 1)).not.toEqual([])
    await f.rotate(resumed)
    const again = f.make("alice"); await again.start()
    expect(again.recoveredFiles()).toHaveLength(1)
    expect(again.recoveredFiles()[0]?.recoveryId).toBe(first.recoveryId)
    const remaining = again.recoveredFiles()[0]!
    await again.resolveRecovered({ recoveryId: remaining.recoveryId, fileId: remaining.id, action: "discard" })
    expect(await f.store("alice", 1).list("session:s", 1)).toEqual([])
    expect(again.files.file(file.id)?.content).toBe("base canonical")
    expect((await readOfflineRecovery(f.store("alice"), key(3), "s")).entries[0]?.resolved).toHaveLength(2)
  } finally { await f.cleanup() }
})


it("retries final resolution persistence and source retirement without publishing a second recovered history", async () => {
  const f = await fixture()
  try {
    const original = await f.competing()
    const resumed = f.make("alice"); await resumed.start()
    const file = resumed.recoveredFiles()[0]!
    const save = DurableSessionStore.prototype.saveRecoveryJournal
    let writes = 0
    const fault = vi.spyOn(DurableSessionStore.prototype, "saveRecoveryJournal").mockImplementation(async function (this: DurableSessionStore, value) {
      if (++writes === 2) throw new Error("crash before final journal persistence")
      await save.call(this, value)
    })
    await expect(resumed.resolveRecovered({ recoveryId: file.recoveryId, fileId: file.id, action: "save", path: "saved.ts" })).rejects.toThrow("final journal")
    fault.mockRestore()
    expect(resumed.recoveredFiles()).toHaveLength(1)
    expect(await f.store("alice", 1).list("session:s", 1)).not.toEqual([])
    await f.stop(resumed)
    const restarted = f.make("alice"); await restarted.start()
    const cleanupFault = vi.spyOn(DurableSessionStore.prototype, "retireRecoverySources").mockRejectedValueOnce(new Error("crash during source cleanup"))
    await expect(restarted.resolveRecovered({ recoveryId: file.recoveryId, fileId: file.id, action: "save", path: "saved.ts" })).rejects.toThrow("source cleanup")
    cleanupFault.mockRestore()
    expect(restarted.recoveredFiles()).toEqual([])
    await f.stop(restarted)
    const final = f.make("alice"); await final.start()
    expect(await f.store("alice", 1).list("session:s", 1)).toEqual([])
    expect(final.files.files().filter(file => file.path === "saved.ts")).toHaveLength(1)
    expect(final.files.file(original.id)?.content).toBe("base canonical")
  } finally { vi.restoreAllMocks(); await f.cleanup() }
})

it("resumes an initializer enqueue crash with identical ciphertext and retains old records until ACK", async () => {
  const f = await fixture()
  try {
    const alice = f.make("alice"), bob = f.make("bob"); await alice.start(); await bob.start()
    f.faults.drop = "all"; const file = await f.pending(alice); await f.edit(alice, file.id, " offline"); await f.rotate(bob)
    const enqueue = DurableSessionStore.prototype.enqueue
    let failed = false
    const fault = vi.spyOn(DurableSessionStore.prototype, "enqueue").mockImplementation(async function (this: DurableSessionStore, record) {
      await enqueue.call(this, record)
      if (!failed && record.keyVersion === 2 && initialization(record.updateBinary)) { failed = true; throw new Error("crash after target enqueue") }
    })
    const interrupted = f.make("alice"); await expect(interrupted.start()).rejects.toThrow("target enqueue"); fault.mockRestore(); await f.stop(interrupted)
    const prepared = (await f.store("alice", 2).list("session:s", 2)).find(record => initialization(record.updateBinary))!
    expect(prepared).toBeDefined()
    f.faults.drop = "ack"
    const resumed = f.make("alice"); await resumed.start()
    await eventually(() => expect(resumed.files.file(file.id)?.content).toBe("base offline"))
    expect((await f.store("alice", 2).list("session:s", 2)).find(record => record.id === prepared.id)?.updateBinary).toBe(prepared.updateBinary)
    expect(await f.store("alice", 1).list("session:s", 1)).not.toEqual([])
    f.faults.drop = ""; await resumed.retry(); await resumed.captureCommit()
    expect(await f.store("alice", 1).list("session:s", 1)).toEqual([])
  } finally { vi.restoreAllMocks(); await f.cleanup() }
})

it("lets observers inspect competing offline work while rejecting publication and revoked recovery admission", async () => {
  const f = await fixture()
  try {
    await f.competing(); auth.observer.add("alice")
    const observer = f.make("alice"); await observer.start()
    const file = observer.recoveredFiles()[0]!
    expect(file.content).toBe("base offline")
    await expect(observer.resolveRecovered({ recoveryId: file.recoveryId, fileId: file.id, action: "save", path: "no.ts" })).rejects.toThrow("editor")
    expect(await f.store("alice", 1).list("session:s", 1)).not.toEqual([])
    await f.stop(observer); auth.revoked.add("alice")
    const revoked = f.make("alice"); await expect(revoked.start()).rejects.toThrow("revoked")
    expect(await f.store("alice", 1).list("session:s", 1)).not.toEqual([])
  } finally { await f.cleanup() }
})


it("rejects a recovery save over an untracked binary without changing its bytes", async () => {
  const f = await fixture()
  try {
    await f.competing()
    const workspace = path.join(f.root, "alice", "workspace")
    await fs.mkdir(workspace, { recursive: true })
    const binary = Buffer.from([0, 255, 1, 128]); await fs.writeFile(path.join(workspace, "occupied.bin"), binary)
    const resumed = f.make("alice", false, true); await resumed.start()
    const file = resumed.recoveredFiles()[0]!
    await expect(resumed.resolveRecovered({ recoveryId: file.recoveryId, fileId: file.id, action: "save", path: "occupied.bin" })).rejects.toThrow("existing file")
    expect(await fs.readFile(path.join(workspace, "occupied.bin"))).toEqual(binary)
    expect(resumed.recoveredFiles()).toHaveLength(1)
  } finally { await f.cleanup() }
})


it.each([true, false])("reopens through SessionRuntimeHost while projection retention races (crash=%s)", async crashProjection => {
  const f = await fixture()
  const hosts: SessionRuntimeHost[] = []
  try {
    const workspace = path.join(f.root, "alice", "workspace"); await fs.mkdir(workspace, { recursive: true }); await fs.writeFile(path.join(workspace, "a.ts"), "base")
    const binding = { sessionId: "s", projectId: "p", repositoryId: "repo", workspaceId: "session-workspace", sourceWorkspaceId: "source", role: "editor", state: "active", generation: 3, recoveryKeyVersion: 1 }
    const activate = vi.fn(async () => { binding.state = "active" })
    const coordinator = {
      prepare: async (_session: string, source: string) => { expect(source).toBe("source"); return binding },
      workspaceForSession: async () => ({ workspaceId: "session-workspace", projectRootPath: workspace }),
      getBinding: async () => binding, readBaseFile: async (_session: string, relative: string) => relative === "a.ts" ? { content: "base", executable: false } : null,
      shouldTrackExternal: async () => false, changedPaths: async () => [], externalChanges: async () => ({ paths: [], renames: [] }), restoreSourceFocus: async () => {}, activate, adoptPublished: async () => {},
      recordRecoveryKey: async (_session: string, version: number) => { binding.recoveryKeyVersion = version },
      suspendActions: async () => "session-workspace", finalizeLeave: async () => {}, leave: async () => {},
    } as unknown as SessionWorkspaceCoordinator
    gateway.post = async (route, body) => {
      if (route === "/collab/v2/workspace-context") return { role: "editor", session: { projectId: "p" } }
      if (route === "/collab/v2/session") return { projectId: "p", sessionId: "s", roomId: "session:s", deviceId: "alice", collabWsUrl: "wss://room.test", token: "alice", protocolVersion: "3.0", encryption: { roomId: "session:s", encryptionRequired: true, status: "ready", activeKeyVersion: auth.keyVersion, wrappedRoomKey: key(auth.keyVersion).roomKeyBase64, senderPublicKeyJwk: "test-sender", wrapAlgorithm: "test" } }
      if (route === "/collab/v2/checkpoint") return handleCheckpointOperation(f.storage, { userId: "alice", role: "editor", roomId: "session:s", projectId: "p", keyVersion: auth.keyVersion }, body as Record<string, unknown>)
      throw new Error(`Unexpected host gateway route ${route}`)
    }
    const first = new SessionRuntimeHost(coordinator, path.join(f.root, "alice"), () => {}, async () => {}); hosts.push(first)
    await first.open("s", "source")
    const bob = f.make("bob"); await bob.start()
    f.faults.drop = "all"; const file = await f.pending(first.runtime("s")); await f.edit(first.runtime("s"), file.id, " offline")
    await first.runtime("s").projectFiles()
    const lease = f.records.get(`file-initialization:${file.id}`) as FileInitializationLease
    f.records.set(`file-initialization:${file.id}`, { ...lease, expiresAt: 0 })
    await bob.openFile("a.ts"); await f.edit(bob, file.id, " canonical"); await bob.captureCommit()
    await first.shutdown(); hosts.splice(hosts.indexOf(first), 1)
    await f.rotate(bob)
    // A CLI write after the old host stopped must be retained before rebasing
    // projection metadata; it must never replay old Yjs anchors into canonical.
    await fs.writeFile(path.join(workspace, "a.ts"), "disk-only offline text")
    const journalSave = DurableSessionStore.prototype.saveRecoveryJournal
    let raced = false
    const racingWrite = vi.spyOn(DurableSessionStore.prototype, "saveRecoveryJournal").mockImplementation(async function (this: DurableSessionStore, encoded) {
      await journalSave.call(this, encoded)
      if (!raced && this.directory.startsWith(path.join(f.root, "alice"))) {
        const journal = JSON.parse(Buffer.from(await decryptPayload({ envelope: bytesToEnvelope(Buffer.from(encoded, "base64")), roomKeyBase64: key(2).roomKeyBase64 })).toString())
        if (journal.entries.some((entry: { files: Array<{ content: string }> }) => entry.files.some(file => file.content === "disk-only offline text"))) {
          raced = true
          await fs.writeFile(path.join(workspace, "a.ts"), "racing disk text")
          const live = f.make("bob"); await live.start(); await f.edit(live, file.id, " newer"); await live.captureCommit()
        }
      }
    })
    const projectionSave = DurableSessionStore.prototype.saveProjection
    let crashed = false
    const projectionCrash = vi.spyOn(DurableSessionStore.prototype, "saveProjection").mockImplementation(async function (this: DurableSessionStore, encoded) {
      if (crashProjection && raced && !crashed && this.directory.startsWith(path.join(f.root, "alice"))) {
        const envelope = bytesToEnvelope(Buffer.from(encoded, "base64"))
        const projection = JSON.parse(Buffer.from(await decryptPayload({ envelope, roomKeyBase64: key(envelope.keyVersion).roomKeyBase64 })).toString())
        if (projection.files[file.id]?.recovery === true) {
          crashed = true
          throw new Error("crash before recovery baseline replacement")
        }
      }
      await projectionSave.call(this, encoded)
    })
    const interrupted = new SessionRuntimeHost(coordinator, path.join(f.root, "alice"), () => {}, async () => {}); hosts.push(interrupted)
    let second = interrupted
    if (crashProjection) {
      const outcome = await interrupted.open("s", "source").then(value => ({ value, error: null }), error => ({ value: null, error: String(error) }))
      expect({ raced, crashed, outcome }, "Durable disk retention and recovery-baseline save must both execute").toEqual({ raced: true, crashed: true, outcome: { value: null, error: expect.stringContaining("baseline replacement") } })
      racingWrite.mockRestore(); projectionCrash.mockRestore()
      expect(await fs.readFile(path.join(workspace, "a.ts"), "utf8")).toBe("racing disk text")
      second = new SessionRuntimeHost(coordinator, path.join(f.root, "alice"), () => {}, async () => {}); hosts.push(second)
      await second.open("s", "source")
    } else { await second.open("s", "source"); racingWrite.mockRestore(); projectionCrash.mockRestore() }
    expect({ raced, crashed }).toEqual({ raced: true, crashed: crashProjection })
    expect(binding.recoveryKeyVersion).toBe(2)
    expect(activate).toHaveBeenCalledTimes(2)
    expect(second.runtime("s").files.file(file.id)?.content).toBe("base canonical newer")
    expect(second.runtime("s").recoveredFiles().map(file => file.content)).toEqual(expect.arrayContaining(["base offline", "disk-only offline text", "racing disk text"]))
    expect(await fs.readFile(path.join(workspace, "a.ts"), "utf8")).toBe("base canonical newer")
    expect(await f.store("alice", 1).list("session:s", 1)).not.toEqual([])
  } finally { vi.restoreAllMocks(); for (const host of hosts) await host.shutdown(); await f.cleanup() }
})

it("quarantines offline-created renamed disk paths through real Git startup scans and discard", async () => {
  const f = await fixture()
  try {
    const workspace = path.join(f.root, "alice", "workspace")
    await fs.mkdir(workspace, { recursive: true }); await fs.writeFile(path.join(workspace, "a.ts"), "base")
    execFileSync("git", ["init", "-q"], { cwd: workspace }); execFileSync("git", ["add", "."], { cwd: workspace })
    execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "base"], { cwd: workspace })
    const alice = f.make("alice"), bob = f.make("bob"); await alice.start(); await bob.start()
    f.faults.drop = "all"; const base = await f.pending(alice)
    const created = await alice.createFile("new.ts", "offline new")
    await alice.renameFile(created.id, "renamed.ts")
    await fs.writeFile(path.join(workspace, "renamed.ts"), "disk variant")
    const lease = f.records.get(`file-initialization:${base.id}`) as FileInitializationLease
    f.records.set(`file-initialization:${base.id}`, { ...lease, expiresAt: 0 })
    await bob.openFile("a.ts"); await f.edit(bob, base.id, " canonical"); await bob.captureCommit(); await f.rotate(bob)
    let resumed = f.make("alice", false, true, true); await resumed.start(); await resumed.readyForWorkspace()
    expect(resumed.files.resolvePath("renamed.ts")).toBeNull()
    expect(resumed.files.file(created.id)).toBeNull()
    expect(resumed.recoveredFiles().map(file => file.content)).toEqual(expect.arrayContaining(["offline new", "disk variant"]))
    const saved = resumed.recoveredFiles().find(file => file.content === "offline new")!
    f.faults.drop = "ack"
    const saving = resumed.resolveRecovered({ recoveryId: saved.recoveryId, fileId: saved.id, action: "save", path: "chosen.ts" })
    void saving.catch(() => {})
    await eventually(() => expect(f.faults.pendingAcks.length).toBeGreaterThan(0))
    await fs.writeFile(path.join(workspace, "renamed.ts"), "retained while Save awaits ACK")
    await eventually(() => expect(resumed.recoveredFiles().some(file => file.content === "retained while Save awaits ACK")).toBe(true))
    f.faults.drop = ""
    for (const reply of f.faults.pendingAcks.splice(0)) reply()
    await saving
    expect(resumed.files.resolvePath("chosen.ts")?.content).toBe("offline new")
    await f.stop(resumed)
    resumed = f.make("alice", false, true, true); await resumed.start(); await resumed.readyForWorkspace()
    expect(resumed.recoveredFiles().some(file => file.content === "retained while Save awaits ACK")).toBe(true)
    expect(resumed.recoveredFiles().some(file => file.recoveryId === saved.recoveryId && file.id === saved.id)).toBe(false)
    expect(resumed.files.resolvePath("chosen.ts")?.content).toBe("offline new")
    for (const file of resumed.recoveredFiles().filter(file => file.path === "renamed.ts")) await resumed.resolveRecovered({ recoveryId: file.recoveryId, fileId: file.id, action: "discard" })
    await fs.writeFile(path.join(workspace, "renamed.ts"), "after discard")
    await resumed.readyForWorkspace(); await resumed.captureCommit()
    expect(resumed.files.resolvePath("renamed.ts")).toBeNull()
    expect(await fs.readFile(path.join(workspace, "renamed.ts"), "utf8")).toBe("after discard")
    await f.stop(resumed)
    const restarted = f.make("alice", false, true, true); await restarted.start(); await restarted.readyForWorkspace()
    expect(restarted.files.resolvePath("renamed.ts")).toBeNull()
    await fs.unlink(path.join(workspace, "renamed.ts"))
    // Deleted untracked paths are absent from Git status; the watcher still
    // retains the deletion, then distinguishes a recreated empty text file.
    await eventually(() => expect(restarted.recoveredFiles().some(file => file.path === "renamed.ts" && file.deleted)).toBe(true))
    await fs.writeFile(path.join(workspace, "renamed.ts"), "")
    await restarted.readyForWorkspace()
    expect(restarted.recoveredFiles().some(file => file.path === "renamed.ts" && !file.deleted && file.content === "")).toBe(true)
    expect(restarted.recoveredFiles().some(file => file.path === "renamed.ts" && file.deleted && file.content === "")).toBe(true)
    await fs.rename(path.join(workspace, "renamed.ts"), path.join(workspace, "RENAMED.ts"))
    await restarted.readyForWorkspace()
    expect(restarted.files.resolvePath("RENAMED.ts")).toBeNull()
  } finally { await f.cleanup() }
})

it("renews a same-key initializer lease without reusing ciphertext identity or deadlocking source ACK", async () => {
  const f = await fixture()
  try {
    const alice = f.make("alice"); await alice.start(); f.faults.drop = "all"
    const file = await f.pending(alice); await f.edit(alice, file.id, " offline")
    const original = await f.store("alice", 1).list("session:s", 1)
    await f.stop(alice)
    const lease = f.records.get(`file-initialization:${file.id}`) as FileInitializationLease
    f.records.set(`file-initialization:${file.id}`, { ...lease, expiresAt: 0 }); f.faults.drop = ""
    const resumed = f.make("alice"); await resumed.start(); await resumed.captureCommit()
    expect(resumed.files.file(file.id)?.content).toBe("base offline")
    expect(await f.store("alice", 1).list("session:s", 1)).toEqual([])
    expect(original.length).toBeGreaterThan(0)
  } finally { await f.cleanup() }
})

it("keeps the original local basis available when an unaccepted migration rotates twice then meets competing history", async () => {
  const f = await fixture()
  try {
    const alice = f.make("alice"), bob = f.make("bob"); await alice.start(); await bob.start()
    f.faults.drop = "all"; const file = await f.pending(alice); await f.edit(alice, file.id, " offline")
    await f.rotate(bob)
    const bob2 = f.make("bob"); await bob2.start(); f.faults.drop = "all"
    const alice2 = f.make("alice"); await alice2.start()
    expect(await f.store("alice", 2).list("session:s", 2)).not.toEqual([])
    await f.rotate(bob2)
    const bob3 = f.make("bob"); await bob3.start(); await bob3.openFile("a.ts"); await f.edit(bob3, file.id, " third-key canonical"); await bob3.captureCommit()
    const alice3 = f.make("alice"); await alice3.start()
    expect(alice3.files.file(file.id)?.content).toBe("base third-key canonical")
    expect(alice3.recoveredFiles().map(file => file.content)).toEqual(["base offline"])
    expect(alice3.recoveryEntries()[0]?.incomplete).toBe(false)
  } finally { await f.cleanup() }
})

async function gitWorkspace(root: string, user = "alice") {
  const workspace = path.join(root, user, "workspace")
  await fs.mkdir(workspace, { recursive: true }); await fs.writeFile(path.join(workspace, "a.ts"), "base")
  execFileSync("git", ["init", "-q"], { cwd: workspace }); execFileSync("git", ["add", "."], { cwd: workspace })
  execFileSync("git", ["-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "-qm", "base"], { cwd: workspace })
  return workspace
}

it.each(["edit", "rename"])("preserves external rename identity when a remote %s arrives after observation before durable application", async remoteOperation => {
  const f = await fixture()
  let release = () => {}
  try {
    const workspace = await gitWorkspace(f.root)
    const alice = f.make("alice", false, true, true), bob = f.make("bob")
    await alice.start(); await bob.start(); const file = await alice.openFile("a.ts"); await alice.projectFiles()
    const owner = alice as unknown as { persistExternalOperation(id: string, update: Uint8Array, beforePath: string, file: import("../../shared/SessionFileDocument").SharedSessionFile, beforeContent: string): Promise<boolean> }
    const apply = owner.persistExternalOperation.bind(owner)
    let observed = false
    const gate = new Promise<void>(resolve => { release = resolve })
    vi.spyOn(owner, "persistExternalOperation").mockImplementation(async (id, update, beforePath, file, beforeContent) => { observed = true; await gate; return apply(id, update, beforePath, file, beforeContent) })
    await fs.rename(path.join(workspace, "a.ts"), path.join(workspace, "renamed.ts"))
    await fs.writeFile(path.join(workspace, "renamed.ts"), "base local")
    const scanning = alice.readyForWorkspace(); void scanning.catch(() => {})
    await eventually(() => expect(observed).toBe(true))
    if (remoteOperation === "rename") await bob.renameFile(file.id, "remote.ts")
    await f.edit(bob, file.id, " remote"); await bob.captureCommit()
    release(); await scanning; await alice.captureCommit()
    if (remoteOperation === "rename") {
      expect(alice.files.file(file.id)?.path).toBe("remote.ts")
      expect(alice.files.file(file.id)?.content).toBe("base remote")
      expect(alice.recoveredFiles().some(file => file.path === "renamed.ts" && file.content === "base local")).toBe(true)
      return
    }
    expect(alice.files.file(file.id)?.path).toBe("renamed.ts")
    expect(alice.files.file(file.id)?.content).toContain("local")
    expect(alice.files.file(file.id)?.content).toContain("remote")
    expect(alice.files.files().filter(file => !file.deleted)).toHaveLength(1)
    await eventually(() => expect(bob.files.file(file.id)?.path).toBe("renamed.ts"))
    expect(alice.recoveredFiles()).toEqual([])
    await f.stop(alice)
    const reopened = f.make("alice", false, true, true); await reopened.start(); await reopened.readyForWorkspace()
    expect(reopened.files.file(file.id)?.path).toBe("renamed.ts")
    expect(reopened.files.files().filter(file => !file.deleted)).toHaveLength(1)
    await fs.rename(path.join(workspace, "renamed.ts"), path.join(workspace, "AGAIN.ts")); await reopened.readyForWorkspace()
    expect(reopened.files.file(file.id)?.path).toBe("AGAIN.ts")
  } finally { release(); vi.restoreAllMocks(); await f.cleanup() }
})

it.each(["rename", "delete", "ambiguous", "collision"])("retains and resolves external %s conflicts without overwriting canonical text", async scenario => {
  const f = await fixture()
  try {
    const workspace = await gitWorkspace(f.root)
    let alice = f.make("alice", false, true, true); const bob = f.make("bob")
    await alice.start(); await bob.start(); const file = await alice.openFile("a.ts"); await alice.projectFiles(); await f.stop(alice)
    if (scenario === "delete") await fs.unlink(path.join(workspace, "a.ts"))
    else if (scenario === "ambiguous") { await fs.unlink(path.join(workspace, "a.ts")); await fs.writeFile(path.join(workspace, "local.ts"), "unpaired local") }
    else { await fs.rename(path.join(workspace, "a.ts"), path.join(workspace, "local.ts")); await fs.writeFile(path.join(workspace, "local.ts"), "local bytes") }
    if (scenario === "rename") await bob.renameFile(file.id, "remote.ts")
    if (scenario === "collision") await bob.createFile("local.ts", "other canonical")
    await f.edit(bob, file.id, " remote"); await bob.captureCommit()
    alice = f.make("alice", false, true, true); await alice.start(); await alice.readyForWorkspace()
    expect(alice.files.file(file.id)?.content).toBe("base remote")
    expect(alice.files.file(file.id)?.deleted).toBe(false)
    expect(alice.recoveryEntries().some(entry => entry.reason)).toBe(true)
    const recovered = alice.recoveredFiles().find(file => scenario === "delete" ? file.deleted : file.path === "local.ts")!
    expect(recovered).toBeDefined()
    await alice.resolveRecovered({ recoveryId: recovered.recoveryId, fileId: recovered.id, action: "save", path: "reviewed.ts" })
    expect(alice.files.resolvePath("reviewed.ts")?.content).toBe(recovered.content)
    expect(alice.files.file(file.id)?.content).toBe("base remote")
    if (scenario === "collision") expect(alice.files.resolvePath("local.ts")?.content).toBe("other canonical")
  } finally { await f.cleanup() }
})

it("uses explicit Git R100 evidence after inode replacement and resumes an ACKed rename intent after crash", async () => {
  const f = await fixture()
  try {
    const workspace = await gitWorkspace(f.root)
    let alice = f.make("alice", false, true, true); await alice.start(); const file = await alice.openFile("a.ts"); await alice.projectFiles(); await f.stop(alice)
    await fs.copyFile(path.join(workspace, "a.ts"), path.join(workspace, "moved.ts")); await fs.unlink(path.join(workspace, "a.ts"))
    execFileSync("git", ["add", "-A"], { cwd: workspace })
    expect(execFileSync("git", ["status", "--porcelain=v2", "--renames"], { cwd: workspace }).toString()).toContain("R100")
    alice = f.make("alice", false, true, true); await alice.start()
    const original = DurableSessionStore.prototype.saveProjection
    let crashed = false
    vi.spyOn(DurableSessionStore.prototype, "saveProjection").mockImplementation(async function (this: DurableSessionStore, encoded) {
      const projection = JSON.parse(Buffer.from(await decryptPayload({ envelope: bytesToEnvelope(Buffer.from(encoded, "base64")), roomKeyBase64: key(1).roomKeyBase64 })).toString())
      if (!crashed && projection.external === null && projection.files[file.id]?.file.path === "moved.ts") {
        crashed = true; await (alice as unknown as { provider: { captureCommitState(): Promise<unknown> } }).provider.captureCommitState(); throw new Error("crash after rename ACK before receipt")
      }
      await original.call(this, encoded)
    })
    await expect(alice.readyForWorkspace()).rejects.toThrow("crash after rename ACK")
    expect(crashed).toBe(true)
    vi.restoreAllMocks(); await f.stop(alice)
    const restarted = f.make("alice", false, true, true); await restarted.start(); await restarted.readyForWorkspace(); await restarted.captureCommit()
    expect(restarted.files.file(file.id)?.path).toBe("moved.ts")
    expect(restarted.files.file(file.id)?.content).toBe("base")
    expect(restarted.files.files().filter(file => !file.deleted)).toHaveLength(1)
  } finally { vi.restoreAllMocks(); await f.cleanup() }
})

it("fences external synchronization when conflict retention cannot become durable", async () => {
  const f = await fixture()
  try {
    const workspace = await gitWorkspace(f.root)
    let alice = f.make("alice", false, true, true); const bob = f.make("bob")
    await alice.start(); await bob.start(); const file = await alice.openFile("a.ts"); await alice.projectFiles(); await f.stop(alice)
    await fs.rename(path.join(workspace, "a.ts"), path.join(workspace, "local.ts")); await fs.writeFile(path.join(workspace, "local.ts"), "local bytes")
    await bob.renameFile(file.id, "remote.ts"); await f.edit(bob, file.id, " remote"); await bob.captureCommit()
    alice = f.make("alice", false, true, true); await alice.start()
    const original = DurableSessionStore.prototype.saveRecoveryJournal
    vi.spyOn(DurableSessionStore.prototype, "saveRecoveryJournal").mockImplementation(async function (this: DurableSessionStore, encoded) {
      const journal = JSON.parse(Buffer.from(await decryptPayload({ envelope: bytesToEnvelope(Buffer.from(encoded, "base64")), roomKeyBase64: key(1).roomKeyBase64 })).toString())
      if (journal.entries.some((entry: { kind?: string }) => entry.kind === "external")) throw new Error("retention unavailable")
      await original.call(this, encoded)
    })
    await expect(alice.readyForWorkspace()).rejects.toThrow("retention unavailable")
    expect(await fs.readFile(path.join(workspace, "local.ts"), "utf8")).toBe("local bytes")
    expect(alice.files.file(file.id)?.path).toBe("remote.ts")
    expect(alice.files.file(file.id)?.content).toBe("base remote")
    await expect(alice.captureCommit()).rejects.toThrow("paused")
    vi.restoreAllMocks(); await alice.retryProjection()
    expect(alice.recoveredFiles().some(file => file.content === "local bytes")).toBe(true)
  } finally { vi.restoreAllMocks(); await f.cleanup() }
})

it("retains late shared edits to an externally deleted identity", async () => {
  const f = await fixture()
  try {
    const workspace = await gitWorkspace(f.root)
    const alice = f.make("alice", false, true, true), bob = f.make("bob")
    await alice.start(); await bob.start(); const file = await alice.openFile("a.ts"); await alice.projectFiles()
    await fs.unlink(path.join(workspace, "a.ts")); await alice.readyForWorkspace(); await alice.captureCommit()
    expect(alice.files.file(file.id)?.deleted).toBe(true)
    await f.edit(bob, file.id, " late"); await bob.captureCommit()
    await eventually(() => expect(alice.recoveredFiles().some(file => file.content === "base late")).toBe(true))
  } finally { await f.cleanup() }
})

it("hides held external rows from provider replay while enqueue and conflict retention are gated", async () => {
  const f = await fixture(); let releaseEnqueue = () => {}, releaseRetention = () => {}
  try {
    const workspace = await gitWorkspace(f.root)
    const alice = f.make("alice", false, true, true), bob = f.make("bob")
    await alice.start(); await bob.start(); const file = await alice.openFile("a.ts"); await alice.projectFiles()
    const enqueueGate = new Promise<void>(resolve => { releaseEnqueue = resolve }), retentionGate = new Promise<void>(resolve => { releaseRetention = resolve })
    let enqueued = false, retaining = false
    const enqueue = DurableSessionStore.prototype.enqueue, journalSave = DurableSessionStore.prototype.saveRecoveryJournal
    vi.spyOn(DurableSessionStore.prototype, "enqueue").mockImplementation(async function (this: DurableSessionStore, record) {
      await enqueue.call(this, record)
      if (record.externalAdmission === "held") { enqueued = true; await enqueueGate }
    })
    vi.spyOn(DurableSessionStore.prototype, "saveRecoveryJournal").mockImplementation(async function (this: DurableSessionStore, encoded) {
      const journal = JSON.parse(Buffer.from(await decryptPayload({ envelope: bytesToEnvelope(Buffer.from(encoded, "base64")), roomKeyBase64: key(1).roomKeyBase64 })).toString())
      if (journal.entries.some((entry: { kind?: string }) => entry.kind === "external")) { retaining = true; await retentionGate }
      await journalSave.call(this, encoded)
    })
    await fs.rename(path.join(workspace, "a.ts"), path.join(workspace, "local.ts"))
    const scanning = alice.readyForWorkspace(); void scanning.catch(() => {})
    await eventually(() => expect(enqueued).toBe(true))
    const provider = (alice as unknown as { provider: { resumeLocalRecovery(): Promise<void> } }).provider
    await provider.resumeLocalRecovery()
    expect(alice.files.file(file.id)?.path).toBe("a.ts")
    expect(bob.files.file(file.id)?.path).toBe("a.ts")
    await bob.renameFile(file.id, "remote.ts"); await bob.captureCommit()
    releaseEnqueue(); await eventually(() => expect(retaining).toBe(true))
    await provider.resumeLocalRecovery()
    expect(alice.files.file(file.id)?.path).toBe("remote.ts")
    expect(bob.files.file(file.id)?.path).toBe("remote.ts")
    releaseRetention(); await scanning
    expect(alice.recoveredFiles().some(file => file.path === "local.ts")).toBe(true)
    expect((await f.store("alice").list("session:s", 1)).some(record => record.externalAdmission === "held")).toBe(true)
  } finally { releaseEnqueue(); releaseRetention(); vi.restoreAllMocks(); await f.cleanup() }
})

it("admits the migrated held external row after key rotation without duplicating its durable identity", async () => {
  const f = await fixture()
  try {
    const workspace = await gitWorkspace(f.root)
    const alice = f.make("alice", false, true, true), bob = f.make("bob")
    await alice.start(); await bob.start(); const file = await alice.openFile("a.ts"); await alice.projectFiles()
    vi.spyOn(DurableSessionStore.prototype, "admitExternal").mockRejectedValue(new Error("crash before admission receipt"))
    await fs.rename(path.join(workspace, "a.ts"), path.join(workspace, "rotated.ts"))
    await expect(alice.readyForWorkspace()).rejects.toThrow("admission receipt")
    const source = (await f.store("alice", 1).list("session:s", 1)).find(record => record.externalAdmission === "held")!
    expect(source).toBeDefined()
    vi.restoreAllMocks(); await f.stop(alice); await f.rotate(bob)
    const enqueue = vi.spyOn(DurableSessionStore.prototype, "enqueue")
    const restarted = f.make("alice", false, true, true); await restarted.start(); await restarted.readyForWorkspace(); await restarted.captureCommit()
    expect(restarted.files.file(file.id)?.path).toBe("rotated.ts")
    expect(enqueue.mock.calls.some(([record]) => record.keyVersion === 2 && record.id === source.id)).toBe(false)
    expect(enqueue.mock.calls.some(([record]) => record.keyVersion === 2 && record.id.startsWith("rot_") && record.externalOperationId === source.externalOperationId && record.migratedFrom?.id === source.id)).toBe(true)
    expect(await f.store("alice", 1).list("session:s", 1)).toEqual([])
  } finally { vi.restoreAllMocks(); await f.cleanup() }
})

it.each(["external", "in-app"])("retains both concurrent rename intents when %s wins and resolves after offline restart", async winner => {
  const f = await fixture()
  try {
    const workspace = await gitWorkspace(f.root); await gitWorkspace(f.root, "bob")
    const alice = f.make("alice", false, true, true); let bob = f.make("bob", false, true, true)
    await alice.start(); await bob.start(); const file = await alice.openFile("a.ts"); await alice.projectFiles(); await bob.projectFiles()
    const clients = Y.decodeStateVector(Y.encodeStateVector(alice.files.doc))
    let low = 1; while (clients.has(low) || clients.has(low + 1)) low += 2
    const rename = SessionFileDocument.prototype.renameFile
    vi.spyOn(SessionFileDocument.prototype, "renameFile").mockImplementation(function (this: SessionFileDocument, id, target) {
      this.doc.clientID = target === `${winner}.ts` ? low + 1 : low
      rename.call(this, id, target)
    })
    f.faults.blockedUser = "bob"
    await bob.renameFile(file.id, "in-app.ts")
    await fs.rename(path.join(workspace, "a.ts"), path.join(workspace, "external.ts")); await alice.readyForWorkspace(); await alice.captureCommit()
    f.faults.blockedUser = ""
    await (bob as unknown as { provider: { resumeLocalRecovery(): Promise<void> } }).provider.resumeLocalRecovery()
    await (bob as unknown as { provider: { captureCommitState(): Promise<unknown> } }).provider.captureCommitState()
    await expect(bob.projectFiles()).rejects.toThrow("Choose a shared path")
    expect(bob.files.file(file.id)?.path).toBe(`${winner}.ts`)
    expect(bob.snapshot().renameConflicts).toEqual([{ fileId: file.id, paths: ["external.ts", "in-app.ts"] }])
    expect(bob.recoveredFiles().some(file => file.path === "in-app.ts")).toBe(true)
    expect(bob.recoveredFiles().some(file => file.path === "external.ts")).toBe(true)
    expect((f.records.get("encrypted-checkpoint") as { sequence: number }).sequence).toBeLessThan(bob.snapshot().sequence)
    await f.stop(bob)
    bob = f.make("bob", false, true, true); await bob.start(); await expect(bob.readyForWorkspace()).rejects.toThrow("Choose a shared path")
    expect(bob.snapshot().renameConflicts?.[0]?.paths).toEqual(["external.ts", "in-app.ts"])
    await bob.renameFile(file.id, "in-app.ts"); await bob.projectFiles(); await bob.captureCommit()
    expect(bob.snapshot().renameConflicts).toEqual([])
    await eventually(() => expect(alice.snapshot().renameConflicts).toEqual([]))
    await alice.projectFiles()
    expect(alice.files.file(file.id)?.path).toBe("in-app.ts")
    expect(await fs.readFile(path.join(workspace, "in-app.ts"), "utf8")).toBe("base")
  } finally { vi.restoreAllMocks(); f.faults.blockedUser = ""; await f.cleanup() }
})

it("surfaces corrupt rename intents through runtime notifications without throwing from Yjs events", async () => {
  const f = await fixture()
  try {
    const runtime = f.make("alice")
    await runtime.start()
    const notifications: Array<string | null> = []
    const unsubscribe = runtime.subscribe(snapshot => notifications.push(snapshot.error))
    expect(() => runtime.files.doc.getMap("file-rename-intents").set("unknown", { fileId: "missing", from: "a.ts", to: "b.ts" })).not.toThrow()
    expect(runtime.snapshot().error).toContain("Invalid shared rename intent")
    expect(notifications.at(-1)).toContain("Invalid shared rename intent")
    expect(() => runtime.files.snapshotChanges()).toThrow("Invalid shared rename intent")
    unsubscribe()
  } finally { await f.cleanup() }
})
