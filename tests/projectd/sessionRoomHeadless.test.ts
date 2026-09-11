import { randomBytes } from "node:crypto"
import { beforeAll, describe, expect, it } from "vitest"

import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import {
  SESSION_ROOM_PROTOCOL_VERSION,
  SessionRoomClient,
  type RoomConnector,
} from "../../apps/projectd/src/collaboration/SessionRoomClient"
import { SessionTransport } from "../../apps/projectd/src/collaboration/SessionTransport"
import type { ChangeActor } from "../../apps/projectd/src/collaboration/TreeDoc"
import {
  RoomHost,
  TEST_PUBLIC_SESSION_ID,
  loadSessionRoomWorker,
  sessionTokenFor,
  waitFor,
  type ServerMessage,
  type SessionRoomWorker,
} from "../helpers/sessionRoomHarness"

/**
 * P10 headless slice: two daemon clients talk to the real CollaborationSessionRoom
 * code through the in-memory harness in tests/helpers/sessionRoomHarness.ts.
 */

const actor: ChangeActor = { actorType: "user", principalId: "principal_a" }
let worker: SessionRoomWorker

function createClient(
  host: RoomHost,
  clientId: string,
  roomKey: Buffer,
  options: { getToken?: () => Promise<string>; connect?: RoomConnector } = {},
) {
  const replica = new SessionReplica(TEST_PUBLIC_SESSION_ID, clientId)
  const transport = new SessionTransport({ sessionId: TEST_PUBLIC_SESSION_ID, replica, roomKey })
  const client = new SessionRoomClient({
    transport,
    connect: options.connect ?? host.connector(),
    getToken: options.getToken ?? sessionTokenFor(worker, `principal_${clientId}`),
  })
  return { replica, transport, client }
}

beforeAll(async () => {
  worker = await loadSessionRoomWorker()
})

describe("P10 session room headless slice", () => {
  it("speaks the same protocol version on both ends", () => {
    expect(worker.SESSION_ROOM_PROTOCOL_VERSION).toBe(SESSION_ROOM_PROTOCOL_VERSION)
  })

  it("converges two clients across disconnect, offline edits, and room eviction", async () => {
    const host = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const a = createClient(host, "c_a", roomKey)
    const b = createClient(host, "c_b", roomKey)

    await a.client.connect()
    const file = a.replica.createFile({ path: "shared.txt", kind: "text", content: "hello", actor })
    a.client.submitLocalChanges()
    await waitFor(() => a.client.pendingBatchCount === 0, "the first batch to be acknowledged")

    await b.client.connect()
    expect(b.replica.textDocs.getTextContent(file.fileId)).toBe("hello")

    a.client.disconnect()
    b.client.disconnect()
    a.replica.textDocs.getOrCreate(file.fileId).text.insert(5, " world")
    b.replica.textDocs.getOrCreate(file.fileId).text.insert(0, ">> ")
    expect(a.client.submitLocalChanges()).not.toBeNull()
    expect(b.client.submitLocalChanges()).not.toBeNull()
    expect(host.storage.batchCount()).toBe(1)

    host.evict()

    await a.client.connect()
    await b.client.connect()
    await waitFor(
      () => a.client.pendingBatchCount === 0 && b.client.pendingBatchCount === 0,
      "offline batches to be acknowledged",
    )
    await waitFor(() => a.transport.lastAppliedSessionSeq === 3, "client A to apply every batch")

    expect(a.replica.textDocs.getTextContent(file.fileId)).toBe(">> hello world")
    expect(b.replica.textDocs.getTextContent(file.fileId)).toBe(">> hello world")
    expect(host.storage.batchCount()).toBe(3)
    expect(a.transport.lastAppliedSessionSeq).toBe(3)
    expect(b.transport.lastAppliedSessionSeq).toBe(3)

    // Barriers are for the device that holds the AutoGit lease.
    a.client.setAutoGitEligibility(true)
    await waitFor(() => a.client.autoGitState?.lease?.leaderClientId === "c_a", "client A to take the lease")
    const barrier = await a.client.requestBarrier(a.client.autoGitState?.lease?.generation ?? 0)
    expect(barrier.sessionSeq).toBe(3)
    host.dispose()
  })

  it("exports nothing when nothing changed, even after deletions", async () => {
    const host = new RoomHost(worker)
    const a = createClient(host, "c_a", randomBytes(32))
    const file = a.replica.createFile({ path: "notes.md", kind: "text", content: "draft", actor })
    a.replica.textDocs.getOrCreate(file.fileId).text.delete(0, 2)
    a.replica.renameFile(file.fileId, "docs/notes.md", actor)

    expect(a.client.submitLocalChanges()).not.toBeNull()
    expect(a.client.submitLocalChanges()).toBeNull()
  })

  it("does not store a second copy when an acknowledgement is lost", async () => {
    const host = new RoomHost(worker)
    const roomKey = randomBytes(32)
    let connectCount = 0
    const flakyThenHealthy: RoomConnector = (handlers) => {
      connectCount += 1
      const dropAcks = connectCount === 1
      return host.connector({ dropServerMessage: (message) => dropAcks && message.type === "batch_ack" })(handlers)
    }
    const a = createClient(host, "c_a", roomKey, { connect: flakyThenHealthy })

    await a.client.connect()
    a.replica.createFile({ path: "notes.md", kind: "text", content: "draft", actor })
    a.client.submitLocalChanges()
    await waitFor(() => host.storage.batchCount() === 1, "the room to store the batch")
    expect(a.client.pendingBatchCount).toBe(1)

    a.client.disconnect()
    await a.client.connect()
    await waitFor(() => a.client.pendingBatchCount === 0, "the resent batch to be acknowledged")

    expect(host.storage.batchCount()).toBe(1)
    expect(await host.storage.get("currentSeq")).toBe(1)
    expect(a.transport.lastAppliedSessionSeq).toBe(1)
    const lastAck = host.sockets.at(-1)?.received.filter((message) => message.type === "batch_ack").at(-1)
    expect(lastAck).toMatchObject({ sessionSeq: 1, duplicate: true })
  })

  it("rejects forged tokens, tokens for another session, and messages before hello", async () => {
    const host = new RoomHost(worker)
    const roomKey = randomBytes(32)

    const forged = createClient(host, "c_forged", roomKey, {
      getToken: sessionTokenFor(worker, "principal_forged", { secret: "not-the-room-secret-0123456789" }),
    })
    await expect(forged.client.connect()).rejects.toThrow(/INVALID_SESSION_TOKEN/)

    const elsewhere = createClient(host, "c_elsewhere", roomKey, {
      getToken: sessionTokenFor(worker, "principal_elsewhere", { roomId: "session:czs_fedcba9876543210" }),
    })
    await expect(elsewhere.client.connect()).rejects.toThrow(/ROOM_MISMATCH/)

    const messages: ServerMessage[] = []
    let closed = false
    const raw = await host.connector()({
      onMessage: (data) => messages.push(JSON.parse(data) as ServerMessage),
      onClose: () => {
        closed = true
      },
    })
    raw.send(JSON.stringify({ type: "sync_request", knownSeq: 0 }))
    await waitFor(() => closed, "the unauthenticated socket to close")
    expect(messages).toEqual([expect.objectContaining({ type: "error", code: "UNAUTHENTICATED" })])
    expect(host.storage.batchCount()).toBe(0)
  })

  it("lets viewers read the room but not write to it", async () => {
    const host = new RoomHost(worker)
    const roomKey = randomBytes(32)
    const writer = createClient(host, "c_writer", roomKey)
    const viewer = createClient(host, "c_viewer", roomKey, {
      getToken: sessionTokenFor(worker, "principal_viewer", { sessionRole: "viewer" }),
    })

    await writer.client.connect()
    const file = writer.replica.createFile({ path: "README.md", kind: "text", content: "read me", actor })
    writer.client.submitLocalChanges()
    await waitFor(() => writer.client.pendingBatchCount === 0, "the writer's batch to be acknowledged")

    await viewer.client.connect()
    expect(viewer.replica.textDocs.getTextContent(file.fileId)).toBe("read me")

    viewer.replica.textDocs.getOrCreate(file.fileId).text.insert(0, "edited: ")
    viewer.client.submitLocalChanges()
    await waitFor(() => viewer.client.lastError !== null, "the room to refuse the viewer's batch")

    expect(viewer.client.lastError?.code).toBe("FORBIDDEN")
    expect(viewer.client.pendingBatchCount).toBe(1)
    expect(host.storage.batchCount()).toBe(1)
    expect(writer.replica.textDocs.getTextContent(file.fileId)).toBe("read me")
  })
})
