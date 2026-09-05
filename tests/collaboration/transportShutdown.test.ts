import { afterEach, describe, expect, it, vi } from "vitest"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { CollabWsProvider, type CollabSessionDescriptor } from "../../shared/CollaborationTransport"
import { encryptPayload, envelopeToBytes } from "../../shared/collaborationCipher"
import type { CollaborationOutbox, CollaborationOutboxRecord } from "../../shared/collaborationOutbox"

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>(accept => { resolve = accept })
  return { promise, resolve }
}
class ControlledSocket {
  static OPEN = 1
  static CONNECTING = 0
  static instances: ControlledSocket[] = []
  readyState = 1
  onopen: (() => void) | null = null
  onclose: (() => void) | null = null
  onmessage: ((event: { data: string }) => void) | null = null
  onerror: (() => void) | null = null
  send = vi.fn()
  close = vi.fn(() => { this.readyState = 3; this.onclose?.() })
  constructor() { ControlledSocket.instances.push(this) }
}
const key = Buffer.alloc(32, 5).toString("base64")
function fixture(onApplied?: (sequence: number, encoded: string) => Promise<void>) {
  ControlledSocket.instances = []
  vi.stubGlobal("WebSocket", ControlledSocket)
  const doc = new Y.Doc({ gc: false }), awareness = new Awareness(doc)
  const outbox = {
    enqueue: vi.fn(async (_record: CollaborationOutboxRecord) => {}),
    list: vi.fn(async (): Promise<CollaborationOutboxRecord[]> => []),
    acknowledge: vi.fn(async (_id: string) => {}), close: vi.fn(),
  } satisfies CollaborationOutbox
  const session = {
    projectId: "p", sessionId: "s", roomId: "session:s", deviceId: "observer", token: "test",
    collabWsUrl: "wss://room.test", protocolVersion: "3.0",
    encryption: { roomId: "session:s", encryptionRequired: true, status: "ready", activeKeyVersion: 1,
      wrappedRoomKey: null, wrapAlgorithm: null, senderPublicKeyJwk: null },
  } satisfies CollabSessionDescriptor
  const provider = new CollabWsProvider({ doc, awareness, outbox, session, encryption: { keyVersion: 1, roomKeyBase64: key }, onApplied })
  return { doc, outbox, provider, cleanup: () => { provider.destroy(); awareness.destroy(); doc.destroy() } }
}
afterEach(() => vi.unstubAllGlobals())

describe("encrypted transport shutdown drain", () => {
  it("waits for an entered receive-log write, fences late frames and releases storage only once", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-receive-drain-"))
    const gate = deferred<void>()
    const onApplied = vi.fn(async (sequence: number, encoded: string) => {
      await gate.promise
      await fs.writeFile(path.join(root, `${sequence}.json`), encoded)
    })
    const f = fixture(onApplied), sender = new Y.Doc({ gc: false })
    try {
      f.provider.start(); await f.provider.waitForLocalRecovery()
      sender.getText("text").insert(0, "retained observer update")
      const envelope = await encryptPayload({ roomKeyBase64: key, keyVersion: 1, kind: "yjs_update", plaintext: Y.encodeStateAsUpdate(sender), metadata: { projectId: "p", roomId: "session:s", sessionId: "s", idempotencyKey: "receive_1" } })
      const encoded = Buffer.from(envelopeToBytes(envelope)).toString("base64")
      const socket = ControlledSocket.instances[0]!
      const deliver = socket.onmessage!
      const data = JSON.stringify({ type: "sync.delta", payload: { roomId: "session:s", fromSeq: 0, toSeq: 1, updatesBinary: [encoded] } })
      deliver({ data })
      await vi.waitFor(() => expect(onApplied).toHaveBeenCalledTimes(1))
      const stopped = f.provider.shutdown(), finished = vi.fn()
      void stopped.then(finished)
      expect(f.provider.shutdown()).toBe(stopped)
      expect(socket.onmessage).toBeNull()
      expect(socket.close).toHaveBeenCalledOnce()
      deliver({ data }) // A saved callback from the retired socket is also fenced.
      await Promise.resolve()
      expect(finished).not.toHaveBeenCalled()
      expect(f.outbox.close).not.toHaveBeenCalled()
      gate.resolve(); await stopped
      expect(onApplied).toHaveBeenCalledTimes(1)
      expect(f.outbox.close).toHaveBeenCalledTimes(1)
      expect(await fs.readFile(path.join(root, "1.json"), "utf8")).toBe(encoded)
      expect(f.doc.getText("text").toString()).toBe("retained observer update")
      await fs.rm(root, { recursive: true }) // No admitted writer survives stop.
      await f.provider.shutdown()
      expect(f.outbox.close).toHaveBeenCalledTimes(1)
    } finally {
      gate.resolve(); await f.provider.shutdown().catch(() => {})
      f.cleanup(); sender.destroy(); await fs.rm(root, { recursive: true, force: true })
    }
  })

  it("waits for offline outbox recovery before closing its persistence owner", async () => {
    const f = fixture(), listed = deferred<CollaborationOutboxRecord[]>()
    f.outbox.list.mockReturnValue(listed.promise)
    try {
      const starting = f.provider.startOffline()
      const stopped = f.provider.shutdown()
      await Promise.resolve()
      expect(f.outbox.close).not.toHaveBeenCalled()
      listed.resolve([])
      await Promise.all([starting, stopped])
      expect(f.outbox.close).toHaveBeenCalledTimes(1)
      expect(ControlledSocket.instances).toHaveLength(0)
    } finally { listed.resolve([]); await f.provider.shutdown().catch(() => {}); f.cleanup() }
  })

  it("persists accepted outgoing ciphertext before releasing the outbox", async () => {
    const f = fixture(), saved = deferred<void>()
    try {
      await f.provider.startOffline()
      f.outbox.enqueue.mockImplementation(async () => saved.promise)
      f.doc.getText("text").insert(0, "unpublished")
      await vi.waitFor(() => expect(f.outbox.enqueue).toHaveBeenCalledTimes(1))
      const stopped = f.provider.shutdown(), finished = vi.fn()
      void stopped.then(finished)
      await Promise.resolve()
      expect(finished).not.toHaveBeenCalled()
      expect(f.outbox.close).not.toHaveBeenCalled()
      saved.resolve(); await stopped
      expect(f.outbox.enqueue.mock.calls[0]![0].updateBinary.length).toBeGreaterThan(0)
      expect(f.outbox.close).toHaveBeenCalledTimes(1)
    } finally { saved.resolve(); await f.provider.shutdown().catch(() => {}); f.cleanup() }
  })
})
