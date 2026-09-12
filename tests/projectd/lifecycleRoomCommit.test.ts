import { randomBytes } from "node:crypto"
import { expect, it, vi } from "vitest"
import * as sessions from "../../convex/collaborationSessions"
import { FakeConvexDb, fakeConvexCtx, runConvexHandler } from "../helpers/fakeConvexCtx"
import { RoomHost, loadSessionRoomWorker, sessionTokenFor, TEST_PUBLIC_SESSION_ID, waitFor } from "../helpers/sessionRoomHarness"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { SessionTransport } from "../../apps/projectd/src/collaboration/SessionTransport"
import { SessionRoomClient } from "../../apps/projectd/src/collaboration/SessionRoomClient"
import { createDeviceIdentityKey } from "../../shared/deviceIdentity"

const bridge = vi.hoisted(() => ({ validate: vi.fn(), commit: vi.fn() }))
vi.mock("../../cloudflare/worker/src/lib/convex", () => ({
  validateSessionRoomPrincipalInConvex: bridge.validate,
  finalizeSessionLifecycleInConvex: bridge.commit,
}))

it("retains uncertain room commits across eviction, resolves lost replies, and releases only after verified Resume", async () => {
  const secret = "lifecycle-test-gateway-secret"
  const oldSecret = process.env.AI_GATEWAY_SECRET
  process.env.AI_GATEWAY_SECRET = secret
  const db = new FakeConvexDb()
  const identityKey = createDeviceIdentityKey(randomBytes(16))
  const principalId = db.seed("devicePrincipals", { identityKey, status: "active", signingKeyVersion: 1, tokenValidAfter: 0,
    displayName: "Manager", platform: "darwin", encryptionPublicKeyJwk: "{}", encryptionPublicKeyAlgorithm: "ECDH-P256",
    encryptionFingerprint: "enc-test", signingPublicKeyJwk: "{}", signingPublicKeyAlgorithm: "ECDSA-P256-SHA256",
    signingFingerprint: "sig-test" })
  const ctx = fakeConvexCtx(db, { subject: identityKey, key_version: 1, token_issued_at: Math.floor(Date.now() / 1000) })
  const projectId = db.seed("projects", { createdBy: principalId, status: "active" })
  const sessionId = db.seed("collaborationSessions", { publicSessionId: TEST_PUBLIC_SESSION_ID, projectId,
    lifecycle: "ACTIVE", lastDurableSeq: 0, lastSnapshotSeq: 0, activeKeyVersion: 1 })
  db.seed("collaborationSessionMembers", { sessionId, projectId, principalId, status: "active", role: "project_manager" })
  bridge.validate.mockImplementation(async (_env, args) => {
    const result = await runConvexHandler<{ allowed: boolean; reason?: string; role: string; keyVersion: number; lifecycleRevision: number }>(
      sessions.getRoomAccessForServer, ctx, { ...args, serverSecret: secret })
    if (!result.allowed) throw new Error(result.reason)
    return result
  })
  let failure: "before" | "after" | null = "before"
  bridge.commit.mockImplementation(async (_env, args) => {
    if (failure === "before") throw new Error("network unavailable")
    const result = await runConvexHandler(sessions.finalizeLifecycleFromServer, ctx, { ...args, serverSecret: secret })
    if (failure === "after") throw new Error("reply lost after durable commit")
    return result
  })
  const worker = await loadSessionRoomWorker()
  const room = new RoomHost(worker, { controlPlane: { convexUrl: "https://test.convex.cloud", serverSecret: secret } })
  const replica = new SessionReplica(TEST_PUBLIC_SESSION_ID, "manager")
  const transport = new SessionTransport({ sessionId: TEST_PUBLIC_SESSION_ID, replica, roomKey: randomBytes(32) })
  const client = new SessionRoomClient({ transport, connect: room.connector(),
    getToken: sessionTokenFor(worker, principalId, { sessionRole: "project_manager" }) })
  try {
    await client.connect()
    const barrierId = `barrier_${"a".repeat(32)}`
    await room.storage.put("replica:snapshot", { sessionSeq: 0, barrierId, keyVersion: 1 })
    const fence = await client.prepareLifecycleFence("pause", barrierId)
    const alarmFailure = vi.spyOn(room.storage, "setAlarm").mockRejectedValueOnce(new Error("alarm storage unavailable"))
    await expect(client.commitLifecycleFence(fence.fenceId)).rejects.toThrow(/Finalization is retained/)
    alarmFailure.mockRestore()
    expect(room.storage.data.has("lifecycle:commit")).toBe(false)
    expect(bridge.commit).not.toHaveBeenCalled()
    await expect(client.commitLifecycleFence(fence.fenceId)).rejects.toThrow(/Finalization is retained/)
    expect((await db.get(sessionId))?.lifecycle).toBe("ACTIVE")
    await expect(client.cancelLifecycleFence(fence.fenceId)).rejects.toThrow(/Finalization may already/)
    room.evict()
    failure = "after"
    await expect(client.commitLifecycleFence(fence.fenceId)).rejects.toThrow(/Finalization is retained/)
    expect((await db.get(sessionId))?.lifecycle).toBe("PAUSED")
    expect(room.storage.data.get("lifecycle:commit")).toMatchObject({ phase: "committing" })
    failure = null
    await client.commitLifecycleFence(fence.fenceId)
    expect(room.storage.data.get("lifecycle:commit")).toMatchObject({ phase: "committed" })
    expect((await db.get(sessionId))?.lifecycleRevision).toBe(1)
    const recoveryMessages: Array<{ type: string; code?: string; requestId?: string }> = []
    const recovery = await room.connector()({ onMessage: (data) => recoveryMessages.push(JSON.parse(data)), onClose: () => {} })
    recovery.send(JSON.stringify({ type: "hello", protocolVersion: worker.SESSION_ROOM_PROTOCOL_VERSION,
      clientId: "recovery-manager", token: await sessionTokenFor(worker, principalId,
        { sessionRole: "project_manager", sessionAccess: "recovery" })() }))
    await room.settled()
    expect(recoveryMessages.some((message) => message.type === "ready")).toBe(true)
    for (const type of ["snapshot_get", "sync_request", "lifecycle_get"]) {
      recovery.send(JSON.stringify({ type, requestId: type, afterSeq: 0 }))
    }
    await room.settled()
    expect(recoveryMessages.some((message) => message.type === "snapshot_ack")).toBe(true)
    expect(recoveryMessages.some((message) => message.type === "lifecycle_ack")).toBe(true)
    for (const type of ["session_batch", "lifecycle_prepare", "lifecycle_commit", "lifecycle_cancel",
      "snapshot_publish", "snapshot_barrier_request", "lease_request", "checkpoint_request", "rebase_request", "paused_close"]) {
      recovery.send(JSON.stringify({ type, requestId: type }))
    }
    await room.settled()
    expect(recoveryMessages.filter((message) => message.code === "RECOVERY_READ_ONLY")).toHaveLength(10)
    expect(room.storage.data.get("lifecycle:commit")).toMatchObject({ phase: "committed" })
    await runConvexHandler(sessions.resume, ctx, { sessionId })
    expect(await client.getLifecycleFence()).toBeNull()
    expect(room.storage.data.has("lifecycle:commit")).toBe(false)
    await expect(client.commitLifecycleFence(fence.fenceId)).rejects.toThrow(/Refresh the lifecycle fence/)
    replica.createFile({ path: "resumed.txt", kind: "text", content: "writes resumed", actor: { actorType: "user", principalId } })
    client.submitLocalChanges()
    await waitFor(() => client.pendingBatchCount === 0, "resumed write admission")
    expect(room.storage.data.get("currentSeq")).toBe(1)
    expect(recoveryMessages.some((message) => message.type === "session_batch")).toBe(false)
    recovery.send(JSON.stringify({ type: "sync_request", afterSeq: 0 }))
    await room.settled()
    expect(recoveryMessages.some((message) => message.type === "error" && message.code !== "RECOVERY_READ_ONLY")).toBe(true)
    recovery.close()
    const nextBarrier = `barrier_${"b".repeat(32)}`
    await room.storage.put("replica:snapshot", { sessionSeq: 1, barrierId: nextBarrier, keyVersion: 1 })
    const unattendedFence = await client.prepareLifecycleFence("pause", nextBarrier)
    failure = "before"
    await expect(client.commitLifecycleFence(unattendedFence.fenceId)).rejects.toThrow(/Finalization is retained/)
    expect(room.storage.alarm).not.toBeNull()
    client.disconnect()
    room.evict()
    const fireRetry = async () => {
      const pending = room.storage.data.get("lifecycle:commit") as { nextAttemptAt: number; attempts: number }
      const callsBefore = bridge.commit.mock.calls.length
      const clock = vi.spyOn(Date, "now").mockReturnValue(pending.nextAttemptAt + 1)
      try {
        await room.storage.setAlarm(Date.now())
        await waitFor(() => bridge.commit.mock.calls.length > callsBefore, "unattended lifecycle retry")
        await room.settled()
      } finally { clock.mockRestore() }
    }
    // No client is connected for any of these attempts. Move the test clock to
    // the recorded deadline; production uses the persisted Cloudflare alarm.
    await fireRetry()
    expect((await db.get(sessionId))?.lifecycle).toBe("ACTIVE")
    expect(room.storage.data.get("lifecycle:commit")).toMatchObject({ phase: "committing", attempts: 2 })
    failure = "after"
    await fireRetry()
    expect((await db.get(sessionId))?.lifecycle).toBe("PAUSED")
    expect(room.storage.data.get("lifecycle:commit")).toMatchObject({ phase: "committing", attempts: 3 })
    room.evict()
    failure = null
    await fireRetry()
    expect(room.storage.data.get("lifecycle:commit")).toMatchObject({ phase: "committed", attempts: 4 })
    expect((await db.get(sessionId))?.lifecycleRevision).toBe(3)
    const closeMessages: Array<{ type: string; code?: string }> = []
    const closer = await room.connector()({ onMessage: (data) => closeMessages.push(JSON.parse(data)), onClose: () => {} })
    closer.send(JSON.stringify({ type: "hello", protocolVersion: worker.SESSION_ROOM_PROTOCOL_VERSION,
      clientId: "paused-closer", token: await sessionTokenFor(worker, principalId,
        { sessionRole: "project_manager", sessionAccess: "paused_close" })() }))
    await room.settled()
    const closePaused = async (pauseFenceId: string, allowUnpublishedGit = true) => {
      closeMessages.length = 0
      closer.send(JSON.stringify({ type: "paused_close", requestId: "close", pauseFenceId,
        barrierId: nextBarrier, allowUnpublishedGit }))
      await room.settled()
    }
    await closePaused(unattendedFence.fenceId, false)
    expect(closeMessages).toContainEqual(expect.objectContaining({ code: "CLOSE_REVIEW_CHANGED" }))
    expect(room.storage.data.get("lifecycle:fence")).toMatchObject({ intent: "pause" })
    const failedAlarm = vi.spyOn(room.storage, "setAlarm").mockRejectedValueOnce(new Error("alarm unavailable"))
    await closePaused(unattendedFence.fenceId)
    failedAlarm.mockRestore()
    expect(room.storage.data.get("lifecycle:fence")).toMatchObject({ fenceId: unattendedFence.fenceId })
    failure = "before"
    await closePaused(unattendedFence.fenceId)
    expect(room.storage.data.get("lifecycle:commit")).toMatchObject({ fromPaused: true, phase: "committing" })
    // Resume wins the control-plane revision while the close HTTP attempt is uncertain.
    await runConvexHandler(sessions.resume, ctx, { sessionId })
    await client.connect()
    expect(await client.getLifecycleFence()).toBeNull()
    expect(room.storage.data.has("lifecycle:commit")).toBe(false)
    failure = null
    const finalPause = await client.prepareLifecycleFence("pause", nextBarrier)
    await client.commitLifecycleFence(finalPause.fenceId)
    failure = "after"
    await closePaused(finalPause.fenceId)
    expect((await db.get(sessionId))?.lifecycle).toBe("CLOSED")
    expect(closeMessages).toContainEqual(expect.objectContaining({ code: "LIFECYCLE_COMMIT_UNCERTAIN" }))
    const closeFenceId = (room.storage.data.get("lifecycle:fence") as { fenceId: string }).fenceId
    room.evict()
    failure = null
    await closePaused(finalPause.fenceId)
    expect(closeMessages).toContainEqual(expect.objectContaining({ type: "lifecycle_ack" }))
    expect(room.storage.data.get("lifecycle:commit")).toMatchObject({ fenceId: closeFenceId, phase: "committed" })
    expect((await db.get(sessionId))?.lifecycleRevision).toBe(6)
    closer.close()
    expect(room.errors).toEqual([])
  } finally {
    client.disconnect()
    room.dispose()
    if (oldSecret === undefined) delete process.env.AI_GATEWAY_SECRET
    else process.env.AI_GATEWAY_SECRET = oldSecret
    bridge.validate.mockReset()
    bridge.commit.mockReset()
  }
})
