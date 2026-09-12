import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { expect, it, vi } from "vitest"
import { ProjectdClient } from "@cozea/projectd-protocol"
import { ProjectdServer } from "../../apps/projectd/src/server/ProjectdServer"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { BackgroundDeviceIdentityManager } from "../../apps/projectd/src/identity/BackgroundDeviceIdentity"
import { BackgroundSessionStore } from "../../apps/projectd/src/collaboration/BackgroundSessionStore"
import { BackgroundAccessDenied, type RecoveryAccessScope } from "../../apps/projectd/src/collaboration/BackgroundSessionAuth"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { CloudReplicaStore } from "../../apps/projectd/src/collaboration/CloudReplicaStore"
import { SessionBinaryObjectStore } from "../../apps/projectd/src/collaboration/BinaryObjectStore"
import { RoomHost, loadSessionRoomWorker, sessionTokenFor, TEST_PUBLIC_SESSION_ID } from "../helpers/sessionRoomHarness"

const control = vi.hoisted(() => ({ commit: vi.fn() }))
vi.mock("../../cloudflare/worker/src/lib/convex", () => ({
  validateSessionRoomPrincipalInConvex: async () => ({ role: "project_manager", keyVersion: 1, lifecycleRevision: 1 }),
  finalizeSessionLifecycleInConvex: control.commit,
}))

it("reviews encrypted retained conflicts and closes through daemon IPC without attaching or touching a workspace", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-retained-close-"))
  let database = new ProjectdDatabase(path.join(root, "projectd.sqlite"))
  const manager = new BackgroundDeviceIdentityManager()
  const identity = await manager.generateNewIdentity()
  const identityRead = vi.spyOn(manager, "loadExistingIdentity").mockResolvedValue(identity)
  const worker = await loadSessionRoomWorker()
  const objects = new Map<string, Uint8Array>()
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init)
    if (request.method === "PUT") {
      objects.set(request.url, new Uint8Array(await request.arrayBuffer()))
      return new Response(null, { status: 204 })
    }
    const bytes = objects.get(request.url)
    return bytes ? new Response(Uint8Array.from(bytes)) : new Response(null, { status: 404 })
  }
  vi.stubGlobal("fetch", fetcher)
  const roomKey = randomBytes(32)
  const token = await sessionTokenFor(worker, "manager", { sessionRole: "project_manager", sessionAccess: "paused_close" })()
  const ticket = { wsUrl: "wss://room.example/collab/sessions/ws", token, role: "project_manager" as const, sessionAccess: "paused_close" as const }
  const replica = new SessionReplica(TEST_PUBLIC_SESSION_ID, "source")
  for (const content of ["first", "second"]) replica.createFile({ path: "collision.txt", kind: "text", content,
    actor: { actorType: "user", principalId: "manager" } })
  replica.createFile({ path: "src/recovered.txt", kind: "text", content: "cloud-only content",
    actor: { actorType: "user", principalId: "manager" } })
  const binaryObjects = new SessionBinaryObjectStore({ sessionId: TEST_PUBLIC_SESSION_ID, roomKey,
    getRoomUrl: () => ticket.wsUrl, getToken: async () => token })
  const binary = replica.createFile({ path: "asset.bin", kind: "binary", actor: { actorType: "user", principalId: "manager" } })
  const manifest = await binaryObjects.upload(Buffer.from("cloud-only binary"))
  replica.addBinaryRevision({ revisionId: "cloud-revision", fileId: binary.fileId, baseRevisionId: null,
    contentHash: manifest.contentHash, size: manifest.size, manifest, encryptedManifestRef: "inline:v1:" + manifest.contentHash,
    actor: { actorType: "user", principalId: "manager" }, createdAt: 1 })
  const barrierId = `barrier_${"a".repeat(32)}`
  const snapshot = await new CloudReplicaStore(TEST_PUBLIC_SESSION_ID, new SessionBinaryObjectStore({
    sessionId: TEST_PUBLIC_SESSION_ID, roomKey, getRoomUrl: () => ticket.wsUrl, getToken: async () => token,
  })).upload({ sessionSeq: 0, barrierId, keyVersion: 1 }, replica.captureSnapshot())
  const room = new RoomHost(worker, { controlPlane: { convexUrl: "https://test.convex.cloud", serverSecret: "test" },
    binaryObjects: { head: async () => null } })
  const pauseFenceId = "12345678-1234-4234-8234-123456789abc"
  await room.storage.put("replica:snapshot", snapshot)
  await room.storage.put("lifecycle:fence", { fenceId: pauseFenceId, intent: "pause", sessionSeq: 0,
    barrierId, keyVersion: 1, requestedByPrincipalId: "manager", createdAt: Date.now(), gitSavedThroughSeq: null })
  await room.storage.put("lifecycle:commit", { fenceId: pauseFenceId, expectedRevision: 0, phase: "committed" })
  control.commit.mockResolvedValue({ committed: true, revision: 2, superseded: false })
  const workspace = path.join(root, "absent-workspace")
  new BackgroundSessionStore(database).save({ publicSessionId: TEST_PUBLIC_SESSION_ID, projectId: "project",
    workspaceId: "workspace", rootPath: workspace, branchName: "session", background: {
      gatewayUrl: "https://gateway.example", convexUrl: "https://test.convex.cloud" } }, identity)
  const recoveryToken = await sessionTokenFor(worker, "manager", { sessionRole: "project_manager", sessionAccess: "recovery" })()
  const recoveryAuth = vi.fn(async (_descriptor: unknown, _identity: unknown, _manager: unknown, scope: RecoveryAccessScope = "recovery") => ({
    publicSessionId: TEST_PUBLIC_SESSION_ID, ticket: scope === "recovery" ? { ...ticket, token: recoveryToken, sessionAccess: scope } : ticket,
    roomKeyBase64: roomKey.toString("base64"), roomKeyVersion: 1, previousRoomKeysBase64: {} }))
  const socketPath = path.join(root, "daemon.sock")
  const createServer = () => new ProjectdServer({ database, socketPath, sourceCatalogPath: path.join(root, "absent-catalog"),
    backgroundIdentity: manager, sessionConnectorFactory: () => room.connector(), recoverySessionAuth: recoveryAuth,
    refreshSessionAuth: async () => { throw new BackgroundAccessDenied("Paused") } })
  let server = createServer()
  const client = new ProjectdClient({ socketPath })
  try {
    await server.start()
    await client.connect()
    // No local key, replica, binary cache, or workspace exists. Fresh recovery
    // authorization supplies cloud keys without creating local session state.
    await expect(client.exportSessionRecovery(TEST_PUBLIC_SESSION_ID, root)).rejects.toThrow(/key is unavailable/)
    // Also bypass an unreadable descriptor: the authenticated cloud project
    // context is sufficient, and the damaged encrypted record is preserved.
    const savedEnvelope = database.db.prepare("SELECT envelope FROM background_sessions WHERE session_id=?").get(TEST_PUBLIC_SESSION_ID) as { envelope: Uint8Array }
    database.db.prepare("UPDATE background_sessions SET envelope=? WHERE session_id=?").run(new Uint8Array([1]), TEST_PUBLIC_SESSION_ID)
    const exported = await client.exportSessionRecovery(TEST_PUBLIC_SESSION_ID, root, "cloud", { projectId: "project",
      background: { gatewayUrl: "https://gateway.example", convexUrl: "https://test.convex.cloud" } })
    expect(database.db.prepare("SELECT length(envelope) AS size FROM background_sessions WHERE session_id=?").get(TEST_PUBLIC_SESSION_ID)).toMatchObject({ size: 1 })
    database.db.prepare("UPDATE background_sessions SET envelope=? WHERE session_id=?").run(savedEnvelope.envelope, TEST_PUBLIC_SESSION_ID)
    expect(exported).toMatchObject({ files: 4, pendingBatches: 0, missingBinaryContents: 0, pendingOnly: false })
    expect(await fs.readFile(path.join(exported.directory, "project/src/recovered.txt"), "utf8")).toBe("cloud-only content")
    expect(await fs.readFile(path.join(exported.directory, "project/asset.bin"), "utf8")).toBe("cloud-only binary")
    const exportManifest = JSON.parse(await fs.readFile(path.join(exported.directory, "manifest.json"), "utf8"))
    expect(exportManifest).toMatchObject({ format: "cozea-cloud-recovery", conflicts: { pathCollisions: [expect.anything()] } })
    expect(await client.listSessions()).toEqual([])
    // A corrupted encrypted chunk aborts and removes only its incomplete export.
    const objectUrl = [...objects.keys()].find((url) => url.includes(manifest.contentHash))!
    const originalObject = objects.get(objectUrl)!
    objects.set(objectUrl, new Uint8Array(originalObject.length))
    const foldersBefore = await fs.readdir(root)
    await expect(client.exportSessionRecovery(TEST_PUBLIC_SESSION_ID, root, "cloud")).rejects.toThrow(/authenticated/)
    expect(await fs.readdir(root)).toEqual(foldersBefore)
    objects.set(objectUrl, originalObject)
    const review = await client.prepareSessionClose(TEST_PUBLIC_SESSION_ID)
    expect(review).toMatchObject({ gitLag: true, conflicts: { pathCollisions: 1 }, merge: null })
    const choice = { reviewId: review.reviewId, allowUnpublishedGit: false, allowUnresolvedConflicts: false }
    await expect(client.closeSession(TEST_PUBLIC_SESSION_ID, choice)).rejects.toThrow(/unpublished Git/)
    await expect(client.closeSession(TEST_PUBLIC_SESSION_ID, { ...choice, allowUnpublishedGit: true })).rejects.toThrow(/unresolved conflicts/)
    expect(control.commit).not.toHaveBeenCalled()
    control.commit.mockRejectedValueOnce(new Error("Uncertain network failure"))
    await expect(client.closeSession(TEST_PUBLIC_SESSION_ID,
      { ...choice, allowUnpublishedGit: true, allowUnresolvedConflicts: true })).rejects.toThrow(/retained write admission remains fenced/)
    expect(control.commit).toHaveBeenCalledOnce()
    const retainedClose = room.storage.data.get("lifecycle:fence") as { fenceId: string }
    client.disconnect()
    await server.stop()
    database.close()
    database = new ProjectdDatabase(path.join(root, "projectd.sqlite"))
    room.evict()
    server = createServer()
    await server.start()
    await client.connect()
    const recoveredReview = await client.prepareSessionClose(TEST_PUBLIC_SESSION_ID)
    expect(recoveredReview).toMatchObject({ gitLag: true, conflicts: { pathCollisions: 1 } })
    expect(recoveredReview.reviewId).not.toBe(review.reviewId)
    await expect(client.closeSession(TEST_PUBLIC_SESSION_ID,
      { ...choice, allowUnpublishedGit: true, allowUnresolvedConflicts: true })).rejects.toThrow(/Review the retained session/)
    await expect(client.closeSession(TEST_PUBLIC_SESSION_ID,
      { reviewId: recoveredReview.reviewId, allowUnpublishedGit: true, allowUnresolvedConflicts: true })).resolves.toEqual({ gitLag: true })
    expect(control.commit).toHaveBeenCalledTimes(2)
    expect(room.storage.data.get("lifecycle:fence")).toMatchObject({ fenceId: retainedClose.fenceId })
    expect(recoveryAuth.mock.calls.filter((call) => call[3] === "paused_close")).toHaveLength(4)
    expect(await client.listSessions()).toEqual([])
    await expect(fs.stat(workspace)).rejects.toMatchObject({ code: "ENOENT" })
    expect(room.errors).toEqual([])
  } finally {
    client.disconnect()
    await server.stop()
    database.close()
    identityRead.mockRestore()
    control.commit.mockReset()
    vi.unstubAllGlobals()
    room.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
