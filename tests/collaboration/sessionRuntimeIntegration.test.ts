/* oxlint-disable typescript/triple-slash-reference -- Isolated Worker room uses ambient globals. */
/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { CollaborationSessionRuntime } from "../../apps/desktop/electron/collaboration/CollaborationSessionRuntime"
import { DurableSessionStore } from "../../apps/desktop/electron/collaboration/DurableSessionStore"
import { SessionCheckpointClient } from "../../apps/desktop/electron/collaboration/SessionCheckpointClient"
import { CollabRoom } from "../../cloudflare/worker/src/durableObjects/CollabRoom"
import { handleCheckpointOperation } from "../../cloudflare/worker/src/lib/collaborationCheckpoints"
import type { Env } from "../../cloudflare/worker/src/types"
import type { CollabSessionDescriptor } from "../../shared/CollaborationTransport"
import type { FileInitializationLease } from "../../shared/collaborationFileInitialization"

vi.mock("../../cloudflare/worker/src/lib/jwt", () => ({ verifySessionToken: async (_env: unknown, token: string) => ({ userId: token, deviceId: token, projectId: "p", sessionId: "s", roomId: "session:s", exp: Math.floor(Date.now() / 1000) + 900 }) }))
vi.mock("../../cloudflare/worker/src/lib/collaborationV2Convex", () => ({ authorizeRoomConnection: async (_env: unknown, user: string) => ({ allowed: true, roomId: "session:s", projectId: "p", role: user === "observer" ? "observer" : "editor", keyVersion: 1 }), updateAuthoritativeRoomHead: async () => {} }))
vi.mock("../../cloudflare/worker/src/lib/convex", () => ({ fetchActiveAwarenessFromConvex: async () => [], fetchYjsDeltasFromConvex: async () => [], persistYjsUpdateToConvex: async () => {}, upsertAwarenessInConvex: async () => {} }))
afterEach(() => vi.unstubAllGlobals())
const eventually = (check: () => void | Promise<void>) => vi.waitFor(check, { timeout: 5000 })

function roomFixture() {
  const records = new Map<string, unknown>(), sockets: WebSocket[] = []
  const storage = {
    get: async (key: string) => structuredClone(records.get(key)),
    put: async (values: string | Record<string, unknown>, value?: unknown) => { for (const [key, next] of typeof values === "string" ? [[values, value]] : Object.entries(values)) records.set(key as string, structuredClone(next)) },
    delete: async (keys: string | string[]) => { for (const key of Array.isArray(keys) ? keys : [keys]) records.delete(key) },
    list: async (options: DurableObjectStorageListOptions = {}) => new Map([...records].sort(([a], [b]) => a.localeCompare(b)).filter(([key]) => (!options.prefix || key.startsWith(options.prefix)) && (!options.start || key >= options.start) && (!options.end || key < options.end)).slice(0, options.limit ?? records.size)),
    setAlarm: async () => {},
    transaction: async (run: (s: DurableObjectStorage) => Promise<unknown>) => run(storage as unknown as DurableObjectStorage),
  } as unknown as DurableObjectStorage
  const room = new CollabRoom({ storage, getWebSockets: () => sockets } as unknown as DurableObjectState, {} as Env)
  class LocalSocket {
    static OPEN = 1; static CONNECTING = 0
    readyState = 0
    onopen: (() => void) | null = null
    onclose: (() => void) | null = null
    onmessage: ((event: { data: string }) => void) | null = null
    onerror: (() => void) | null = null
    private server: WebSocket
    constructor() {
      let attachment: unknown = { handshaken: false, roomId: "session:s" }
      this.server = { readyState: 1, serializeAttachment: (value: unknown) => { attachment = structuredClone(value) }, deserializeAttachment: () => attachment,
        send: (data: string) => queueMicrotask(() => this.onmessage?.({ data })), close: () => this.close(),
      } as unknown as WebSocket
      sockets.push(this.server)
      queueMicrotask(() => { this.readyState = 1; this.onopen?.() })
    }
    send(data: string) { void room.webSocketMessage(this.server, data) }
    close() { this.readyState = 3; sockets.splice(sockets.indexOf(this.server), 1); this.onclose?.() }
  }
  vi.stubGlobal("WebSocket", LocalSocket)
  return { storage, records }
}

describe("Electron session runtime through an isolated encrypted room", () => {
  it("shares one file history across two devices, commits acknowledged text and restores after restart", async () => {
    const f = roomFixture(), root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-room-runtime-")), runtimes: CollaborationSessionRuntime[] = []
    for (const user of ["alice", "bob", "observer"]) {
      await fs.mkdir(path.join(root, user, "workspace"), { recursive: true })
      await fs.writeFile(path.join(root, user, "workspace", "a.ts"), "base")
    }
    const key = Buffer.alloc(32, 3).toString("base64")
    const make = (userId: string, offline = false) => {
      const role = userId === "observer" ? "observer" : "editor"
      const store = new DurableSessionStore(path.join(root, userId), "session:s")
      const request = (body: Record<string, unknown>) => handleCheckpointOperation(f.storage, { userId, role, roomId: "session:s", projectId: "p", keyVersion: 1 }, body)
      const session: CollabSessionDescriptor = { projectId: "p", sessionId: "s", roomId: "session:s", deviceId: userId, collabWsUrl: "wss://room.test", token: userId, protocolVersion: "3.0", encryption: { roomId: "session:s", encryptionRequired: true, status: "ready", activeKeyVersion: 1, wrappedRoomKey: null, wrapAlgorithm: null, senderPublicKeyJwk: null } }
      const checkpoints = new SessionCheckpointClient({ sessionId: "s", projectId: "p", roomId: "session:s", role, keyVersion: 1, roomKeyBase64: key, store, request })
      const runtime = new CollaborationSessionRuntime({ sessionId: "s", role, session, offline, encryption: { roomKeyBase64: key, keyVersion: 1 }, store, checkpoints, refreshSession: async () => session,
        claimFile: async fileId => await request({ operation: "file.claim", fileId }) as { lease?: FileInitializationLease; sequence?: number; waiting?: boolean },
        readBaseFile: async relative => relative === "a.ts" ? { content: "base", executable: false } : null, onPublication: () => {}, onAuthorityFailure: () => {},
        projection: { root: path.join(root, userId, "workspace"), recoveryRoot: path.join(root, userId, "retained") },
        shouldTrackExternal: async relative => { const stat = await fs.lstat(path.join(root, userId, "workspace", relative)).catch(() => null); return Boolean(stat?.isFile()) },
      })
      runtimes.push(runtime); return runtime
    }
    try {
      const alice = make("alice"), bob = make("bob")
      await alice.start(); await bob.start()
      await eventually(() => { expect(alice.snapshot().connection).toBe("connected"); expect(bob.snapshot().connection).toBe("connected") })
      const file = await alice.openFile("a.ts")
      expect((await bob.openFile("a.ts")).id).toBe(file.id)
      const edit = (runtime: CollaborationSessionRuntime, text: string) => {
        const doc = new Y.Doc({ gc: false }); Y.applyUpdate(doc, runtime.editorState())
        const vector = Y.encodeStateVector(doc); doc.getText(`file-content:${file.id}`).insert(0, text)
        const update = Y.encodeStateAsUpdate(doc, vector); doc.destroy(); return runtime.applyEditorUpdate(update)
      }
      await Promise.all([edit(alice, "A"), edit(bob, "B")])
      const committed = await alice.captureCommit()
      await eventually(() => expect(bob.files.file(file.id)?.content).toBe(alice.files.file(file.id)?.content))
      expect(committed.textChanges[0]?.content).toBe(alice.files.file(file.id)?.content)
      expect(committed.textChanges[0]?.content).toContain("base")
      expect(committed.sequence).toBe(3)
      await eventually(async () => expect(await fs.readFile(path.join(root, "bob", "workspace", "a.ts"), "utf8"), JSON.stringify(bob.snapshot())).toBe(alice.files.file(file.id)?.content))
      await fs.writeFile(path.join(root, "alice", "workspace", "agent.ts"), "export const fromAgent = true\n")
      await eventually(async () => expect(await fs.readFile(path.join(root, "bob", "workspace", "agent.ts"), "utf8")).toBe("export const fromAgent = true\n"))
      await fs.writeFile(path.join(root, "alice", "workspace", "image.bin"), Buffer.from([0, 255]))
      await eventually(() => expect(alice.snapshot().gitOnlyPaths, JSON.stringify(alice.snapshot())).toContain("image.bin"))
      await bob.stop(); runtimes.splice(runtimes.indexOf(bob), 1)
      const offline = make("bob", true); await offline.start()
      expect(offline.snapshot().connection).toBe("reconnecting")
      await edit(offline, "offline-")
      await edit(alice, "online-")
      await alice.captureCommit()
      await offline.stop(); runtimes.splice(runtimes.indexOf(offline), 1)
      const resumed = make("bob"); await resumed.start()
      await eventually(() => expect(resumed.snapshot().connection).toBe("connected"))
      await eventually(() => expect(resumed.files.file(file.id)?.content).toBe(alice.files.file(file.id)?.content))
      expect(resumed.files.file(file.id)?.content).toContain("offline-")
      expect(resumed.files.file(file.id)?.content).toContain("online-")
      const observer = make("observer"); await observer.start()
      await eventually(() => expect(observer.snapshot().connection).toBe("connected"))
      await expect(observer.applyEditorUpdate(new Uint8Array([0, 0]))).rejects.toThrow("editor")
      await expect(observer.captureCommit()).rejects.toThrow("editor")
    } finally { for (const runtime of runtimes) await runtime.stop(); await fs.rm(root, { recursive: true, force: true }) }
  })
})
