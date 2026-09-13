import { randomBytes } from "node:crypto"
import { afterEach, beforeAll, describe, expect, it } from "vitest"

import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { SessionRoomClient, type RoomCheckpointInput } from "../../apps/projectd/src/collaboration/SessionRoomClient"
import { SessionTransport } from "../../apps/projectd/src/collaboration/SessionTransport"
import {
  RoomHost,
  TEST_PUBLIC_SESSION_ID,
  loadSessionRoomWorker,
  sessionTokenFor,
  waitFor,
  type SessionRole,
  type SessionRoomWorker,
} from "../helpers/sessionRoomHarness"

/**
 * The AutoGit lease in the real session room code (Section 14.5 - 14.7, 15.3,
 * 15.10): one eligible writer leads at a time, and the room takes barriers and
 * checkpoint records from nobody else.
 */

let worker: SessionRoomWorker
const rooms: RoomHost[] = []
const clients: SessionRoomClient[] = []

function newRoom(leaseMs?: number): RoomHost {
  const room = new RoomHost(worker, { leaseMs })
  rooms.push(room)
  return room
}

function createClient(
  room: RoomHost,
  clientId: string,
  roomKey: Buffer,
  role: SessionRole = "developer",
  hooks: { requestTimeoutMs?: number } = {},
) {
  const replica = new SessionReplica(TEST_PUBLIC_SESSION_ID, clientId)
  const transport = new SessionTransport({ sessionId: TEST_PUBLIC_SESSION_ID, replica, roomKey })
  const saveRequestsFrom: Array<string | null> = []
  const client = new SessionRoomClient({
    transport,
    connect: room.connector(),
    getToken: sessionTokenFor(worker, `principal_${clientId}`, { sessionRole: role }),
    onCheckpointRequested: (principalId) => saveRequestsFrom.push(principalId),
    ...(hooks.requestTimeoutMs === undefined ? {} : { requestTimeoutMs: hooks.requestTimeoutMs }),
  })
  clients.push(client)
  return { client, replica, saveRequestsFrom }
}

function leaderOf(client: SessionRoomClient): string | null {
  return client.autoGitState?.lease?.leaderClientId ?? null
}

function generationOf(client: SessionRoomClient): number {
  return client.autoGitState?.lease?.generation ?? 0
}

function checkpointAt(barrier: { barrierId: string; sessionSeq: number }, commit: string): RoomCheckpointInput {
  return {
    commitOid: commit.repeat(40),
    parentOid: "1".repeat(40),
    treeOid: "2".repeat(40),
    sessionSeq: barrier.sessionSeq,
    barrierId: barrier.barrierId,
    logicalTreeHash: "3".repeat(64),
  }
}

beforeAll(async () => {
  worker = await loadSessionRoomWorker()
})

afterEach(() => {
  for (const client of clients.splice(0)) client.disconnect()
  for (const room of rooms.splice(0)) room.dispose()
})

describe("AutoGit lease in the session room", () => {
  it("orders an adoption before buffered edits across eviction and releases an expired barrier", async () => {
    const room = newRoom()
    const key = randomBytes(32)
    const a = createClient(room, "c_a", key)
    const b = createClient(room, "c_b", key)
    await a.client.connect()
    await b.client.connect()
    a.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(a.client) === "c_a", "integration owner leadership")
    const generation = generationOf(a.client)
    const checkpoint = await a.client.requestBarrier(generation)
    await a.client.publishCheckpoint(generation, checkpointAt(checkpoint, "4"))
    const adoptionId = "aaaaaaaa-aaaa-4aaa-aaaa-aaaaaaaaaaaa"
    await a.client.beginRebaseAdoption(generation, { id: adoptionId, from: "4".repeat(40), resultOid: "5".repeat(40) })
    const barrier = await a.client.beginIntegration(generation, adoptionId)
    expect(barrier.sessionSeq).toBe(0)
    await expect(b.client.beginIntegration(generation, adoptionId)).rejects.toMatchObject({ code: "INTEGRATION_UNAVAILABLE" })
    b.replica.createFile({ path: "held-one.md", kind: "text", content: "one", actor: { actorType: "user" } })
    const first = b.client.submitLocalChanges()!
    b.replica.createFile({ path: "held-two.md", kind: "text", content: "two", actor: { actorType: "user" } })
    const second = b.client.submitLocalChanges()!
    await waitFor(() => (room.storage.data.get("integration:active") as { count: number }).count === 2, "durable held edits")
    expect(room.storage.data.get("currentSeq") ?? 0).toBe(0)
    expect(a.replica.tree.listLiveEntries()).toHaveLength(0)
    room.evict()
    await expect(b.client.finishIntegration(generation, barrier.id)).rejects.toMatchObject({ code: "INTEGRATION_STALE" })
    a.replica.createFile({ path: "adopted.md", kind: "text", content: "system result", actor: { actorType: "user" } })
    const batch = a.replica.exportBatch()!
    expect(await a.client.finishIntegration(generation, barrier.id, batch)).toBe(3)
    await waitFor(() => a.replica.tree.listLiveEntries().length === 3 && b.replica.tree.listLiveEntries().length === 3, "adoption and held edits delivered")
    expect(room.storage.data.get(`batch-id:${batch.batchId}`)).toBe(1)
    expect(room.storage.data.get(`batch-id:${first}`)).toBe(2)
    expect(room.storage.data.get(`batch-id:${second}`)).toBe(3)
    expect(room.storage.data.has("integration:active")).toBe(false)
    room.evict()
    expect(await a.client.finishIntegration(generation, barrier.id, batch)).toBe(3)
    expect(room.storage.data.get("currentSeq")).toBe(3)
    const expiring = await a.client.beginIntegration(generation, adoptionId)
    b.replica.createFile({ path: "after-expiry.md", kind: "text", content: "retained", actor: { actorType: "user" } })
    const waiting = b.client.submitLocalChanges()!
    await waitFor(() => (room.storage.data.get("integration:active") as { count: number }).count === 1, "held edit before expiry")
    const retained = room.storage.data.get("integration:active") as Record<string, unknown>
    room.storage.data.set("integration:active", { ...retained, expiresAt: Date.now() - 1 })
    room.evict()
    await room.storage.setAlarm(Date.now() + 5)
    await waitFor(() => room.storage.data.get(`batch-id:${waiting}`) === 4, "expiry releases retained edit")
    await expect(a.client.finishIntegration(generation, expiring.id, batch)).rejects.toMatchObject({ code: "INTEGRATION_STALE" })
    expect(room.errors).toEqual([])
  })

  it("lets one eligible writer lead, never a viewer, and hands over when the leader steps aside", async () => {
    const room = newRoom()
    const roomKey = randomBytes(32)
    const b = createClient(room, "c_b", roomKey)
    const a = createClient(room, "c_a", roomKey)
    const viewer = createClient(room, "c_0", roomKey, "viewer")
    await b.client.connect()
    await a.client.connect()
    await viewer.client.connect()
    expect(leaderOf(a.client)).toBeNull()

    b.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(a.client) === "c_b" && leaderOf(viewer.client) === "c_b", "b to lead and everyone to hear")
    const first = generationOf(b.client)

    // A lower clientId does not take over a lease that has not run out.
    a.client.setAutoGitEligibility(true)
    viewer.client.setAutoGitEligibility(true)
    await waitFor(() => viewer.client.lastError !== null, "the room to refuse the viewer")
    expect(viewer.client.lastError?.code).toBe("FORBIDDEN")
    await room.settled()
    expect(leaderOf(a.client)).toBe("c_b")
    await expect(viewer.client.requestCheckpoint()).rejects.toMatchObject({ code: "FORBIDDEN" })

    b.client.releaseLease(first)
    await waitFor(() => leaderOf(b.client) === "c_a", "a to take over when b steps aside")
    expect(generationOf(a.client)).toBe(first + 1)
    expect(room.errors).toEqual([])
  })

  it("fences a stale leader: renewals, barriers and checkpoint records need the current lease", async () => {
    const room = newRoom()
    const a = createClient(room, "c_a", randomBytes(32))
    await a.client.connect()
    a.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(a.client) === "c_a", "a to lead")
    const generation = generationOf(a.client)

    expect(await a.client.renewLease(generation)).toMatchObject({ generation, leaderClientId: "c_a" })
    await expect(a.client.renewLease(generation + 1)).rejects.toMatchObject({ code: "LEASE_STALE" })
    await expect(a.client.requestBarrier(generation + 1)).rejects.toMatchObject({ code: "LEASE_STALE" })

    const atStart = await a.client.requestBarrier(generation)
    expect(atStart).toMatchObject({ sessionSeq: 0, leaseGeneration: generation })
    await expect(a.client.publishCheckpoint(generation + 1, checkpointAt(atStart, "a"))).rejects.toMatchObject({
      code: "LEASE_STALE",
    })
    await expect(
      a.client.publishCheckpoint(generation, { ...checkpointAt(atStart, "a"), barrierId: `barrier_${"0".repeat(32)}` }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })
    await expect(
      a.client.publishCheckpoint(generation, { ...checkpointAt(atStart, "a"), sessionSeq: 5 }),
    ).rejects.toMatchObject({ code: "BAD_REQUEST" })

    a.replica.createFile({ path: "notes.md", kind: "text", content: "draft", actor: { actorType: "user" } })
    a.client.submitLocalChanges()
    await waitFor(() => a.client.pendingBatchCount === 0, "the batch to be acknowledged")
    const afterEdit = await a.client.requestBarrier(generation)
    expect(afterEdit.sessionSeq).toBe(1)

    const published = await a.client.publishCheckpoint(generation, checkpointAt(afterEdit, "b"))
    expect(published).toMatchObject({
      commitOid: "b".repeat(40),
      sessionSeq: 1,
      leaseGeneration: generation,
      publishedByPrincipalId: "principal_c_a",
    })
    // A leader that lost the answer publishes again and gets the same record.
    expect(await a.client.publishCheckpoint(generation, checkpointAt(afterEdit, "b"))).toEqual(published)
    // An older barrier cannot replace a newer checkpoint.
    await expect(a.client.publishCheckpoint(generation, checkpointAt(atStart, "c"))).rejects.toMatchObject({
      code: "STALE_CHECKPOINT",
    })
    await waitFor(() => a.client.autoGitState?.checkpoint?.commitOid === "b".repeat(40), "the room to announce it")
  })

  it("keeps a dropped leader's lease until it runs out, then elects the next writer", async () => {
    const room = newRoom(150)
    const roomKey = randomBytes(32)
    const a = createClient(room, "c_a", roomKey)
    const b = createClient(room, "c_b", roomKey)
    await a.client.connect()
    await b.client.connect()
    a.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(b.client) === "c_a", "a to lead")
    b.client.setAutoGitEligibility(true)
    await room.settled()
    const generation = generationOf(b.client)

    a.client.disconnect()
    await room.settled()
    expect(leaderOf(b.client)).toBe("c_a")

    await waitFor(() => leaderOf(b.client) === "c_b", "b to lead once a's lease ran out")
    expect(generationOf(b.client)).toBe(generation + 1)
    expect(room.errors).toEqual([])
  })

  it("routes Save now to the leader and tells members why saving stopped", async () => {
    const room = newRoom()
    const roomKey = randomBytes(32)
    const a = createClient(room, "c_a", roomKey)
    const b = createClient(room, "c_b", roomKey)
    await a.client.connect()
    await b.client.connect()
    expect(await b.client.requestCheckpoint()).toBe(false)

    a.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(b.client) === "c_a", "a to lead")
    expect(await b.client.requestCheckpoint()).toBe(true)
    await waitFor(() => a.saveRequestsFrom.length === 1, "the leader to hear the request")
    expect(a.saveRequestsFrom).toEqual(["principal_c_b"])

    const notice = "feat/live changed on origin outside the session."
    a.client.setLeaderNotice(generationOf(a.client), notice)
    await waitFor(() => b.client.autoGitState?.lease?.notice === notice, "members to see the notice")
    // Only the leader speaks for AutoGit.
    b.client.setLeaderNotice(generationOf(b.client), "forged")
    await room.settled()
    expect(a.client.autoGitState?.lease?.notice).toBe(notice)

    a.client.setLeaderNotice(generationOf(a.client), null)
    await waitFor(() => b.client.autoGitState?.lease?.notice === null, "the notice to clear")
  })

  it("records that the last checkpoint still holds the session, and carries what kind of stop a notice is", async () => {
    const room = newRoom()
    const roomKey = randomBytes(32)
    const a = createClient(room, "c_a", roomKey)
    const b = createClient(room, "c_b", roomKey)
    await a.client.connect()
    await b.client.connect()
    a.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(b.client) === "c_a", "a to lead")
    const generation = generationOf(a.client)

    const first = await a.client.requestBarrier(generation)
    await expect(a.client.markSavedThrough(generation, first.barrierId)).rejects.toMatchObject({ code: "NO_CHECKPOINT" })
    await a.client.publishCheckpoint(generation, checkpointAt(first, "a"))

    // An edit Git has nothing to take from, such as an ignored env file.
    a.replica.createFile({ path: ".env", kind: "text", content: "KEY=1", actor: { actorType: "user" } })
    a.client.submitLocalChanges()
    await waitFor(() => a.client.pendingBatchCount === 0, "the edit to be acknowledged")
    const later = await a.client.requestBarrier(generation)
    expect(later.sessionSeq).toBe(1)
    // Only the leader speaks for AutoGit.
    await expect(b.client.markSavedThrough(generation, later.barrierId)).rejects.toMatchObject({ code: "LEASE_STALE" })
    expect(await a.client.markSavedThrough(generation, later.barrierId)).toMatchObject({
      commitOid: "a".repeat(40),
      sessionSeq: 0,
      savedThroughSeq: 1,
    })
    await waitFor(() => b.client.autoGitState?.checkpoint?.savedThroughSeq === 1, "members to hear the session is saved")

    a.client.setLeaderNotice(generation, ".env isn't ignored by Git.", "ENV_NOT_IGNORED")
    await waitFor(() => b.client.autoGitState?.lease?.noticeCode === "ENV_NOT_IGNORED", "members to get the notice's kind")
    a.client.setLeaderNotice(generation, "Something else.", "not a code")
    await waitFor(() => b.client.autoGitState?.lease?.notice === "Something else.", "the next notice")
    expect(b.client.autoGitState?.lease?.noticeCode).toBeNull()
    expect(room.errors).toEqual([])
  })

  it("A01: elects exactly one leader among three eligible writers", async () => {
    const room = newRoom()
    const roomKey = randomBytes(32)
    const a = createClient(room, "c_a", roomKey)
    const b = createClient(room, "c_b", roomKey)
    const c = createClient(room, "c_c", roomKey)
    await a.client.connect()
    await b.client.connect()
    await c.client.connect()
    a.client.setAutoGitEligibility(true)
    b.client.setAutoGitEligibility(true)
    c.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(a.client) !== null, "a leader to emerge")
    const leader = leaderOf(a.client)!
    expect(leaderOf(b.client)).toBe(leader)
    expect(leaderOf(c.client)).toBe(leader)
    expect(["c_a", "c_b", "c_c"]).toContain(leader)
    await room.settled()
    // One generation, heard identically everywhere: no split leadership.
    expect(generationOf(a.client)).toBe(generationOf(b.client))
    expect(generationOf(b.client)).toBe(generationOf(c.client))
    expect(room.errors).toEqual([])
  })

  it("A04: a partitioned leader cannot renew or push while an eligible peer takes over", async () => {
    const room = newRoom(150)
    const roomKey = randomBytes(32)
    const a = createClient(room, "c_a", roomKey, "developer", { requestTimeoutMs: 500 })
    const b = createClient(room, "c_b", roomKey)
    await a.client.connect()
    await b.client.connect()
    a.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(b.client) === "c_a", "a to lead")
    const generation = generationOf(b.client)
    b.client.setAutoGitEligibility(true)

    // Partition: kill the leader's current socket room-side without telling
    // the client, which still believes it is connected. Its traffic goes
    // nowhere. Sockets are matched by authenticated attachment, never by
    // accept order, because clients may reconnect.
    const leaderSockets = room.sockets.filter(
      (socket) => (socket.deserializeAttachment() as { clientId?: string } | null)?.clientId === "c_a",
    )
    expect(leaderSockets.length).toBeGreaterThan(0)
    leaderSockets[leaderSockets.length - 1]!.closed = true
    // The partitioned leader's renewal goes unanswered instead of succeeding.
    await expect(a.client.renewLease(generation)).rejects.toMatchObject({ code: "TIMEOUT" })
    // The room expires the unheard lease and elects the eligible peer. The
    // generation only moves forward; bare test clients never renew, so the
    // room re-grants on its alarm and exact arithmetic would be timing noise.
    await waitFor(() => leaderOf(b.client) === "c_b", "b to lead once the partition starves the lease")
    expect(generationOf(b.client)).toBeGreaterThan(generation)
    // The old generation stays dead even for direct checkpoint writes.
    const current = generationOf(b.client)
    const barrier = await b.client.requestBarrier(current)
    await expect(
      a.client.publishCheckpoint(generation, checkpointAt(barrier, "a")),
    ).rejects.toMatchObject({ code: "TIMEOUT" })
    expect(room.errors).toEqual([])
  })

  it("A06: with no eligible leader the lease lapses and CRDT collaboration continues", async () => {
    const room = newRoom(150)
    const roomKey = randomBytes(32)
    const a = createClient(room, "c_a", roomKey)
    const b = createClient(room, "c_b", roomKey)
    await a.client.connect()
    await b.client.connect()
    a.client.setAutoGitEligibility(true)
    await waitFor(() => leaderOf(b.client) === "c_a", "a to lead")
    // Nobody else is eligible: saving is unavailable, not broken.
    expect(await b.client.requestCheckpoint()).toBe(true)

    a.client.disconnect()
    await waitFor(() => leaderOf(b.client) === null, "the lease to lapse with no successor")
    expect(await b.client.requestCheckpoint()).toBe(false)
    // CRDT collaboration is unaffected by the missing leader.
    b.replica.createFile({ path: "leaderless.md", kind: "text", content: "still syncing", actor: { actorType: "user" } })
    const batch = b.client.submitLocalChanges()!
    expect(batch).toBeTruthy()
    await waitFor(() => (room.storage.data.get(`batch-id:${batch}`) as number) >= 1, "the leaderless edit to land")
    expect(room.errors).toEqual([])
  })
})
