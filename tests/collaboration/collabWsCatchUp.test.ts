import * as Y from "yjs"
import { Awareness } from "y-protocols/awareness"
import { describe, expect, it, vi } from "vitest"

import {
  CollabWsProvider,
  type CollabSessionDescriptor,
} from "@/lib/yjs/CollabWsProvider"

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

describe("CollabWsProvider catch-up", () => {
  it("requests another page after a full 128-update delta", async () => {
    const { provider, doc, awareness } = createProvider()
    const internals = provider as unknown as {
      handleIncoming(raw: unknown): Promise<void>
      decodeInboundBytes(encoded: string, kind: string): Promise<unknown>
      applyRemoteUpdate(bytes: Uint8Array, metadata: Record<string, unknown>, timestamp: number | null): void
      requestInitialSync(): void
    }

    vi.spyOn(internals, "decodeInboundBytes").mockResolvedValue({
      bytes: new Uint8Array(),
      metadata: {},
    })
    vi.spyOn(internals, "applyRemoteUpdate").mockImplementation(() => undefined)
    const requestNextPage = vi
      .spyOn(internals, "requestInitialSync")
      .mockImplementation(() => undefined)

    await internals.handleIncoming(JSON.stringify({
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
    const internals = provider as unknown as {
      handleIncoming(raw: unknown): Promise<void>
      decodeInboundBytes(encoded: string, kind: string): Promise<unknown>
      applyRemoteUpdate(bytes: Uint8Array, metadata: Record<string, unknown>, timestamp: number | null): void
    }

    let releaseDecode: (() => void) | null = null
    const decodeGate = new Promise<void>((resolve) => {
      releaseDecode = resolve
    })

    vi.spyOn(internals, "decodeInboundBytes").mockImplementation(async () => {
      await decodeGate
      return { bytes: new Uint8Array(), metadata: {} }
    })
    vi.spyOn(internals, "applyRemoteUpdate").mockImplementation(() => undefined)

    const handling = internals.handleIncoming(JSON.stringify({
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
    const internals = provider as unknown as {
      handleIncoming(raw: unknown): Promise<void>
      decodeInboundBytes(encoded: string, kind: string): Promise<unknown>
      applyRemoteUpdate(bytes: Uint8Array, metadata: Record<string, unknown>, timestamp: number | null): void
      requestInitialSync(): void
    }

    vi.spyOn(internals, "decodeInboundBytes").mockResolvedValue({
      bytes: new Uint8Array(),
      metadata: {},
    })
    vi.spyOn(internals, "applyRemoteUpdate").mockImplementation(() => undefined)
    const requestNextPage = vi
      .spyOn(internals, "requestInitialSync")
      .mockImplementation(() => undefined)

    await internals.handleIncoming(JSON.stringify({
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
})
