import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { describe, expect, it, vi } from "vitest"

import {
  CollabWsProvider,
  type CollabSessionDescriptor,
} from "@/lib/yjs/CollabWsProvider"

interface TestPendingUpdate {
  updateBinary: string
  idempotencyKey: string
  timestamp: number
}

interface ProviderInternals {
  handleIncoming(raw: unknown): Promise<void>
  decodeInboundBytes(encoded: string, kind: string): Promise<unknown>
  applyRemoteUpdate(
    bytes: Uint8Array,
    metadata: Record<string, unknown>,
    timestamp: number | null,
  ): void
  requestInitialSync(): void
  queueUnacknowledgedUpdatesForRetry(): void
  localUpdatesById: Map<string, TestPendingUpdate>
  pendingUpdates: TestPendingUpdate[]
}

function createProvider() {
  const doc = new Y.Doc()
  const awareness = new Awareness(doc)
  const session: CollabSessionDescriptor = {
    projectId: "project_1",
    roomId: "project:project_1",
    collabWsUrl: "wss://collaboration.invalid/collab/ws",
    token: "header.payload.signature",
    protocolVersion: "2.0",
    deviceId: "user_1",
    encryption: {
      roomId: "project:project_1",
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
    provider: new CollabWsProvider({
      doc,
      awareness,
      session,
      initialKnownSeq: 0,
      encryption: {
        roomKeyBase64: "unused-by-mocked-decoder",
        keyVersion: 1,
      },
    }),
  }
}

function internals(provider: CollabWsProvider): ProviderInternals {
  return provider as unknown as ProviderInternals
}

function mockDecodedUpdates(testProvider: ProviderInternals): void {
  vi.spyOn(testProvider, "decodeInboundBytes").mockResolvedValue({
    bytes: new Uint8Array(),
    metadata: {},
  })
  vi.spyOn(testProvider, "applyRemoteUpdate").mockImplementation(() => undefined)
}

describe("CollabWsProvider catch-up", () => {
  it("requests another page after a full 128-update delta", async () => {
    const { provider, doc, awareness } = createProvider()
    const testProvider = internals(provider)
    mockDecodedUpdates(testProvider)
    const requestNextPage = vi
      .spyOn(testProvider, "requestInitialSync")
      .mockImplementation(() => undefined)

    await testProvider.handleIncoming(JSON.stringify({
      type: "sync.delta",
      payload: {
        roomId: "project:project_1",
        fromSeq: 0,
        toSeq: 128,
        updatesBinary: Array.from({ length: 128 }, (_, index) => `update-${index}`),
      },
    }))

    expect(provider.getKnownSeq()).toBe(128)
    expect(requestNextPage).toHaveBeenCalledTimes(1)

    awareness.destroy()
    doc.destroy()
  })

  it("does not advance the sequence before encrypted updates are applied", async () => {
    const { provider, doc, awareness } = createProvider()
    const testProvider = internals(provider)

    let releaseDecode: (() => void) | null = null
    const decodeGate = new Promise<void>((resolve) => {
      releaseDecode = resolve
    })

    vi.spyOn(testProvider, "decodeInboundBytes").mockImplementation(async () => {
      await decodeGate
      return { bytes: new Uint8Array(), metadata: {} }
    })
    vi.spyOn(testProvider, "applyRemoteUpdate").mockImplementation(() => undefined)

    const handling = testProvider.handleIncoming(JSON.stringify({
      type: "sync.delta",
      payload: {
        roomId: "project:project_1",
        fromSeq: 0,
        toSeq: 1,
        updatesBinary: ["update-1"],
      },
    }))

    await Promise.resolve()
    expect(provider.getKnownSeq()).toBe(0)

    releaseDecode?.()
    await handling
    expect(provider.getKnownSeq()).toBe(1)

    awareness.destroy()
    doc.destroy()
  })

  it("continues catch-up when the room advertises a later head", async () => {
    const { provider, doc, awareness } = createProvider()
    const testProvider = internals(provider)
    mockDecodedUpdates(testProvider)
    const requestNextPage = vi
      .spyOn(testProvider, "requestInitialSync")
      .mockImplementation(() => undefined)

    await testProvider.handleIncoming(JSON.stringify({
      type: "sync.delta",
      payload: {
        roomId: "project:project_1",
        fromSeq: 0,
        toSeq: 25,
        headSeq: 40,
        hasMore: true,
        updatesBinary: ["update-25"],
      },
    }))

    expect(provider.getKnownSeq()).toBe(25)
    expect(requestNextPage).toHaveBeenCalledTimes(1)

    awareness.destroy()
    doc.destroy()
  })

  it("refuses an out-of-order live delta and requests the missing contiguous range", async () => {
    const { provider, doc, awareness } = createProvider()
    const testProvider = internals(provider)
    mockDecodedUpdates(testProvider)
    const requestMissingRange = vi
      .spyOn(testProvider, "requestInitialSync")
      .mockImplementation(() => undefined)

    await testProvider.handleIncoming(JSON.stringify({
      type: "sync.delta",
      payload: {
        roomId: "project:project_1",
        fromSeq: 8,
        toSeq: 9,
        updatesBinary: ["update-9"],
      },
    }))

    expect(provider.getKnownSeq()).toBe(0)
    expect(testProvider.decodeInboundBytes).not.toHaveBeenCalled()
    expect(requestMissingRange).toHaveBeenCalledTimes(1)

    awareness.destroy()
    doc.destroy()
  })

  it("does not accept another client's broadcast acknowledgement as applied state", async () => {
    const { provider, doc, awareness } = createProvider()

    await internals(provider).handleIncoming(JSON.stringify({
      type: "update.ack",
      payload: {
        roomId: "project:project_1",
        seq: 9,
        idempotencyKey: "foreign-update",
        persisted: true,
      },
    }))

    expect(provider.getKnownSeq()).toBe(0)

    awareness.destroy()
    doc.destroy()
  })

  it("clears a durable local update without pretending its global sequence is applied", async () => {
    const { provider, doc, awareness } = createProvider()
    const testProvider = internals(provider)
    const localUpdate: TestPendingUpdate = {
      updateBinary: "encrypted-update",
      idempotencyKey: "local-update",
      timestamp: 1,
    }
    testProvider.localUpdatesById.set(localUpdate.idempotencyKey, localUpdate)
    testProvider.pendingUpdates.push(localUpdate)

    await testProvider.handleIncoming(JSON.stringify({
      type: "update.ack",
      payload: {
        roomId: "project:project_1",
        seq: 9,
        idempotencyKey: localUpdate.idempotencyKey,
        persisted: true,
      },
    }))

    expect(provider.getKnownSeq()).toBe(0)
    expect(testProvider.localUpdatesById.has(localUpdate.idempotencyKey)).toBe(false)
    expect(testProvider.pendingUpdates).toHaveLength(0)

    awareness.destroy()
    doc.destroy()
  })

  it("requeues sent but unacknowledged local updates for reconnect", () => {
    const { provider, doc, awareness } = createProvider()
    const testProvider = internals(provider)
    const localUpdate: TestPendingUpdate = {
      updateBinary: "encrypted-update",
      idempotencyKey: "local-update",
      timestamp: 1,
    }
    testProvider.localUpdatesById.set(localUpdate.idempotencyKey, localUpdate)

    testProvider.queueUnacknowledgedUpdatesForRetry()
    testProvider.queueUnacknowledgedUpdatesForRetry()

    expect(testProvider.pendingUpdates).toEqual([localUpdate])

    awareness.destroy()
    doc.destroy()
  })
})
