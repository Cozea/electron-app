import { encryptPayload, envelopeToBytes } from "@/lib/collab/cipherEnvelope"
import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { describe, expect, it, vi } from "vitest"

import {
  CollabWsProvider,
  type CollabSessionDescriptor,
} from "@/features/collaboration/runtime/CollaborationTransport"
import { EncryptedCollabOutbox } from "@/features/collaboration/persistence/EncryptedCollabOutbox"

interface TestPendingUpdate {
  idempotencyKey: string
  updateBinary: string
  timestamp: number
}

interface ProviderInternals {
  handleIncoming(raw: unknown): Promise<void>
  decodeInbound(
    encoded: string,
    kind: "yjs_update" | "yjs_awareness",
  ): Promise<{ bytes: Uint8Array; metadata: Record<string, unknown> }>
  applyRemoteUpdate(
    bytes: Uint8Array,
    metadata: Record<string, unknown>,
    timestamp: number | null,
  ): void
  requestSync(): void
  restoreOutboxAndConnect(): Promise<void>
  connect(): Promise<void>
  pendingUpdates: Map<string, TestPendingUpdate>
  outbox: EncryptedCollabOutbox
}

function createProvider(outbox = new EncryptedCollabOutbox(null)) {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const session: CollabSessionDescriptor = {
    projectId: "project_1",
    sessionId: "session_1",
    roomId: "session:session_1",
    collabWsUrl: "wss://collaboration.invalid/collab/ws",
    token: "header.payload.signature",
    protocolVersion: "2.1",
    deviceId: "user_1",
    encryption: {
      roomId: "session:session_1",
      encryptionRequired: true,
      status: "ready",
      activeKeyVersion: 1,
      wrappedRoomKey: "wrapped",
      wrapAlgorithm: "ECDH-P256+A256GCM",
      senderPublicKeyJwk: "{}",
    },
  }

  return {
    doc,
    awareness,
    outbox,
    provider: new CollabWsProvider({
      doc,
      awareness,
      session,
      initialKnownSeq: 0,
      encryption: {
        roomKeyBase64: Buffer.alloc(32).toString("base64"),
        keyVersion: 1,
      },
      outbox,
    }),
  }
}

function internals(provider: CollabWsProvider): ProviderInternals {
  return provider as unknown as ProviderInternals
}

function mockDecodedUpdates(testProvider: ProviderInternals): void {
  vi.spyOn(testProvider, "decodeInbound").mockResolvedValue({
    bytes: new Uint8Array(),
    metadata: {},
  })
  vi.spyOn(testProvider, "applyRemoteUpdate").mockImplementation(() => undefined)
}

function cleanup(doc: Y.Doc, awareness: Awareness, outbox: EncryptedCollabOutbox): void {
  awareness.destroy()
  doc.destroy()
  outbox.close()
}

describe("CollabWsProvider catch-up", () => {
  it("requests another page after a full 128-update delta", async () => {
    const { provider, doc, awareness, outbox } = createProvider()
    const testProvider = internals(provider)
    mockDecodedUpdates(testProvider)
    const requestNextPage = vi
      .spyOn(testProvider, "requestSync")
      .mockImplementation(() => undefined)

    await testProvider.handleIncoming(JSON.stringify({
      type: "sync.delta",
      payload: {
        roomId: "session:session_1",
        fromSeq: 0,
        toSeq: 128,
        updatesBinary: Array.from({ length: 128 }, (_, index) => `update-${index}`),
      },
    }))

    expect(provider.getKnownSeq()).toBe(128)
    expect(requestNextPage).toHaveBeenCalledTimes(1)
    cleanup(doc, awareness, outbox)
  })

  it("does not advance the sequence before encrypted updates are applied", async () => {
    const { provider, doc, awareness, outbox } = createProvider()
    const testProvider = internals(provider)

    let releaseDecode: () => void = () => undefined
    const decodeGate = new Promise<void>((resolve) => {
      releaseDecode = resolve
    })

    vi.spyOn(testProvider, "decodeInbound").mockImplementation(async () => {
      await decodeGate
      return { bytes: new Uint8Array(), metadata: {} }
    })
    vi.spyOn(testProvider, "applyRemoteUpdate").mockImplementation(() => undefined)

    const handling = testProvider.handleIncoming(JSON.stringify({
      type: "sync.delta",
      payload: {
        roomId: "session:session_1",
        fromSeq: 0,
        toSeq: 1,
        updatesBinary: ["update-1"],
      },
    }))

    await Promise.resolve()
    expect(provider.getKnownSeq()).toBe(0)

    releaseDecode()
    await handling
    expect(provider.getKnownSeq()).toBe(1)
    cleanup(doc, awareness, outbox)
  })

  it("continues catch-up when the room advertises a later head", async () => {
    const { provider, doc, awareness, outbox } = createProvider()
    const testProvider = internals(provider)
    mockDecodedUpdates(testProvider)
    const requestNextPage = vi
      .spyOn(testProvider, "requestSync")
      .mockImplementation(() => undefined)

    await testProvider.handleIncoming(JSON.stringify({
      type: "sync.delta",
      payload: {
        roomId: "session:session_1",
        fromSeq: 0,
        toSeq: 25,
        headSeq: 40,
        hasMore: true,
        updatesBinary: Array.from({ length: 25 }, (_, index) => `update-${index + 1}`),
      },
    }))

    expect(provider.getKnownSeq()).toBe(25)
    expect(requestNextPage).toHaveBeenCalledTimes(1)
    cleanup(doc, awareness, outbox)
  })

  it("refuses an out-of-order live delta and requests the missing contiguous range", async () => {
    const { provider, doc, awareness, outbox } = createProvider()
    const testProvider = internals(provider)
    mockDecodedUpdates(testProvider)
    const requestMissingRange = vi
      .spyOn(testProvider, "requestSync")
      .mockImplementation(() => undefined)

    await testProvider.handleIncoming(JSON.stringify({
      type: "sync.delta",
      payload: {
        roomId: "session:session_1",
        fromSeq: 8,
        toSeq: 9,
        updatesBinary: ["update-9"],
      },
    }))

    expect(provider.getKnownSeq()).toBe(0)
    expect(testProvider.decodeInbound).not.toHaveBeenCalled()
    expect(requestMissingRange).toHaveBeenCalledTimes(1)
    cleanup(doc, awareness, outbox)
  })

  it("ignores acknowledgements for updates sent by another client", async () => {
    const { provider, doc, awareness, outbox } = createProvider()

    await internals(provider).handleIncoming(JSON.stringify({
      type: "update.ack",
      payload: {
        roomId: "session:session_1",
        seq: 9,
        idempotencyKey: "foreign-update",
        persisted: true,
      },
    }))

    expect(provider.getKnownSeq()).toBe(0)
    cleanup(doc, awareness, outbox)
  })

  it("acknowledges durable local data but advances only through contiguous deltas", async () => {
    const { provider, doc, awareness, outbox } = createProvider()
    const testProvider = internals(provider)
    const requestCatchUp = vi
      .spyOn(testProvider, "requestSync")
      .mockImplementation(() => undefined)
    const acknowledge = vi.spyOn(testProvider.outbox, "acknowledge")
    const localUpdate: TestPendingUpdate = {
      updateBinary: "encrypted-update",
      idempotencyKey: "local-update",
      timestamp: 1,
    }
    testProvider.pendingUpdates.set(localUpdate.idempotencyKey, localUpdate)

    await testProvider.handleIncoming(JSON.stringify({
      type: "update.ack",
      payload: {
        roomId: "session:session_1",
        seq: 9,
        idempotencyKey: localUpdate.idempotencyKey,
        persisted: true,
      },
    }))

    expect(testProvider.pendingUpdates.has(localUpdate.idempotencyKey)).toBe(false)
    expect(acknowledge).toHaveBeenCalledWith(localUpdate.idempotencyKey)
    expect(provider.getKnownSeq()).toBe(0)
    expect(requestCatchUp).toHaveBeenCalledTimes(1)
    cleanup(doc, awareness, outbox)
  })

  it("restores encrypted unacknowledged edits to the document before reconnecting", async () => {
    const outbox = new EncryptedCollabOutbox(null)
    const offline = new Y.Doc()
    offline.getText("file").insert(0, "survives restart")
    const encoded = Buffer.from(envelopeToBytes(await encryptPayload({
      roomKeyBase64: Buffer.alloc(32).toString("base64"), keyVersion: 1, kind: "yjs_update",
      plaintext: Y.encodeStateAsUpdate(offline), metadata: { roomId: "session:session_1", projectId: "project_1" },
    }))).toString("base64")
    await outbox.enqueue({ id: "local-update", projectId: "project_1", roomId: "session:session_1", keyVersion: 1, updateBinary: encoded, timestamp: 1 })
    const { provider, doc, awareness } = createProvider(outbox)
    const testProvider = internals(provider)
    const connect = vi.spyOn(testProvider, "connect").mockResolvedValue(undefined)
    await testProvider.restoreOutboxAndConnect()
    expect(doc.getText("file").toString()).toBe("survives restart")
    expect(provider.getKnownSeq()).toBe(0)
    expect(testProvider.pendingUpdates.get("local-update")?.updateBinary).toBe(encoded)
    expect(connect).toHaveBeenCalledTimes(1)
    offline.destroy()
    cleanup(doc, awareness, outbox)
  })
})
