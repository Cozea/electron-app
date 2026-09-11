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

function createClient(room: RoomHost, clientId: string, roomKey: Buffer, role: SessionRole = "developer") {
  const replica = new SessionReplica(TEST_PUBLIC_SESSION_ID, clientId)
  const transport = new SessionTransport({ sessionId: TEST_PUBLIC_SESSION_ID, replica, roomKey })
  const saveRequestsFrom: Array<string | null> = []
  const client = new SessionRoomClient({
    transport,
    connect: room.connector(),
    getToken: sessionTokenFor(worker, `principal_${clientId}`, { sessionRole: role }),
    onCheckpointRequested: (principalId) => saveRequestsFrom.push(principalId),
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
})
