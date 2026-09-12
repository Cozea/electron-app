import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { SessionTransport } from "../../apps/projectd/src/collaboration/SessionTransport"
import { SessionRoomClient } from "../../apps/projectd/src/collaboration/SessionRoomClient"
import { EventEmitter } from "node:events"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { randomBytes } from "node:crypto"
import { expect, it, vi } from "vitest"
import { ProjectdClient } from "@cozea/projectd-protocol"
import { ProjectdServer } from "../../apps/projectd/src/server/ProjectdServer"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"
import { BackgroundDeviceIdentityManager } from "../../apps/projectd/src/identity/BackgroundDeviceIdentity"
import { BackgroundSessionStore, type BackgroundSessionDescriptor } from "../../apps/projectd/src/collaboration/BackgroundSessionStore"
import { BackgroundAccessDenied, type BackgroundSessionRequest } from "../../apps/projectd/src/collaboration/BackgroundSessionAuth"
import { RoomHost, loadSessionRoomWorker, sessionTokenFor, TEST_PUBLIC_SESSION_ID, waitFor } from "../helpers/sessionRoomHarness"

it("restores a joined session without a renderer and never resurrects Leave during authentication", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-background-restart-"))
  const socketPath = path.join(root, "daemon.sock")
  const folder = path.join(root, "workspace")
  await fs.mkdir(folder)
  await fs.writeFile(path.join(folder, "hello.txt"), "headless\n")
  const worker = await loadSessionRoomWorker()
  const room = new RoomHost(worker)
  const identityManager = new BackgroundDeviceIdentityManager()
  const identity = await identityManager.generateNewIdentity()
  const identityRead = vi.spyOn(identityManager, "loadExistingIdentity").mockResolvedValue(identity)
  const descriptor: BackgroundSessionDescriptor = {
    publicSessionId: TEST_PUBLIC_SESSION_ID, projectId: "project", workspaceId: "workspace", rootPath: folder,
    roomKeyBase64: randomBytes(32).toString("base64"), roomKeyVersion: 1,
    ticket: { wsUrl: "ws://room.test/collab/sessions/ws", token: await sessionTokenFor(worker, "principal_a")() },
    background: { gatewayUrl: "https://gateway.example", convexUrl: "https://example.convex.cloud" },
  }
  const dbPath = path.join(root, "projectd.sqlite")
  let database = new ProjectdDatabase(dbPath)
  new BackgroundSessionStore(database).save(descriptor, identity)
  database.close()
  database = new ProjectdDatabase(dbPath)
  class QuietEvents extends EventEmitter {
    async start(): Promise<void> {}
    stop(): void {}
  }
  let releaseRefresh: (() => void) | undefined
  const auth = vi.fn(async (saved: BackgroundSessionRequest): Promise<BackgroundSessionDescriptor> => ({
    ...saved, ticket: descriptor.ticket, roomKeyBase64: descriptor.roomKeyBase64,
  }))
  const connectorFactory = vi.fn(() => room.connector())
  const options = {
    socketPath, database, sourceCatalogPath: path.join(root, "no-catalog.sqlite"),
    backgroundIdentity: identityManager, refreshSessionAuth: auth,
    sessionConnectorFactory: connectorFactory, fileEventSourceFactory: () => new QuietEvents(),
    sessionRescanIntervalMs: 0,
  }
  let server = new ProjectdServer(options)
  const client = new ProjectdClient({ socketPath })
  try {
    await server.start()
    await waitFor(() => room.storage.batchCount() > 0, "the daemon to restore and ingest without any desktop connection")
    await client.connect()
    await waitFor(async () => (await client.listSessions())[0]?.state === "live", "restored files to finish hydrating")
    client.disconnect()
    await server.stop()
    expect(new BackgroundSessionStore(database).list(identity)).toHaveLength(1)

    await fs.writeFile(path.join(folder, "hello.txt"), "edited before offline restart\n")
    auth.mockRejectedValueOnce(new Error("Network unavailable"))
    const connectionsBefore = room.sockets.length
    server = new ProjectdServer(options)
    await server.start()
    await client.connect()
    await waitFor(async () => (await client.listSessions())[0]?.fileCount === 1, "encrypted local replica to restore offline")
    await waitFor(async () => (await client.listSessions())[0]?.state === "reconnecting", "offline baseline scan")
    expect(await client.listSessionRecovery()).toEqual([expect.objectContaining({ publicSessionId: TEST_PUBLIC_SESSION_ID,
      source: "joined", descriptorState: "readable", hasRetainedKey: true, snapshotSequence: 1 })])
    const exported = await client.exportSessionRecovery(TEST_PUBLIC_SESSION_ID, root)
    expect(exported.files).toBe(1)
    expect(await fs.readFile(path.join(exported.directory, "project/hello.txt"), "utf8")).toBe("edited before offline restart\n")
    expect(exported.missingBinaryContents).toBe(0)
    expect(JSON.parse(await fs.readFile(path.join(exported.directory, "manifest.json"), "utf8"))).toMatchObject({ publicSessionId: TEST_PUBLIC_SESSION_ID })
    expect(room.sockets.length).toBe(connectionsBefore)
    expect(await fs.readFile(path.join(folder, "hello.txt"), "utf8")).toBe("edited before offline restart\n")
    await fs.writeFile(path.join(folder, "hello.txt"), "edited while offline\n")
    await fs.writeFile(path.join(folder, "offline.bin"), Buffer.from([0, 12, 7]))
    expect((await client.prepareSessionLeave(TEST_PUBLIC_SESSION_ID)).pendingBinaryVersions).toBe(1)
    expect((await client.getSessionStatus(TEST_PUBLIC_SESSION_ID))?.pendingBinaryVersions).toBe(1)
    const offlineExport = await client.exportSessionRecovery(TEST_PUBLIC_SESSION_ID, root)
    expect(offlineExport.pendingBatches).toBeGreaterThan(0)
    expect(offlineExport.pendingBinaryVersions).toBe(1)
    expect(await fs.readFile(path.join(offlineExport.directory, "project/hello.txt"), "utf8")).toBe("edited while offline\n")
    expect(room.sockets.length).toBe(connectionsBefore)
    client.disconnect()
    await server.stop()
    expect(await fs.readFile(path.join(folder, "hello.txt"), "utf8")).toBe("edited while offline\n")

    // A definitive denial must not take the cached-state fallback path.
    auth.mockRejectedValueOnce(new BackgroundAccessDenied("Membership revoked"))
    const deniedCalls = auth.mock.calls.length
    server = new ProjectdServer(options)
    await server.start()
    await client.connect()
    await waitFor(() => auth.mock.calls.length > deniedCalls, "denied background admission")
    expect(await client.listSessions()).toEqual([])
    expect((await client.prepareSessionLeave(TEST_PUBLIC_SESSION_ID)).pendingBinaryVersions).toBe(1)
    client.disconnect()
    await server.stop()

    // Once access was denied, a subsequent network outage cannot revive the
    // cached offline host, even across a daemon restart.
    auth.mockRejectedValueOnce(new Error("Network unavailable after denial"))
    const afterDenialCalls = auth.mock.calls.length
    server = new ProjectdServer(options)
    await server.start()
    await client.connect()
    await waitFor(() => auth.mock.calls.length > afterDenialCalls, "network failure after persisted denial")
    expect(await client.listSessions()).toEqual([])
    expect(new BackgroundSessionStore(database).accessState(TEST_PUBLIC_SESSION_ID, identity).denied).toBe(true)
    expect((await client.listSessionRecovery())[0]?.requiresOnlineVerification).toBe(true)
    expect((await client.exportSessionRecovery(TEST_PUBLIC_SESSION_ID, root)).pendingBinaryVersions).toBe(1)
    client.disconnect()
    await server.stop()

    auth.mockImplementation(async (saved) => {
      await new Promise<void>((resolve) => { releaseRefresh = resolve })
      return { ...saved, ticket: descriptor.ticket, roomKeyBase64: descriptor.roomKeyBase64 }
    })
    server = new ProjectdServer(options)
    await server.start()
    await waitFor(() => Boolean(releaseRefresh), "background authentication to start")
    await client.connect()
    await client.detachSession(TEST_PUBLIC_SESSION_ID)
    expect(await client.listSessionRecovery()).toEqual([expect.objectContaining({ publicSessionId: TEST_PUBLIC_SESSION_ID,
      source: "left", descriptorState: "readable", hasRetainedKey: true })])
    releaseRefresh!()
    await server.stop()
    expect(new BackgroundSessionStore(database).list(identity)).toEqual([])
    expect(room.storage.batchCount()).toBe(1)
  } finally {
    releaseRefresh?.()
    client.disconnect()
    await server.stop()
    database.close()
    identityRead.mockRestore()
    room.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})

it("keeps a Session Workbench idle until background authentication and room hydration finish", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-session-ready-"))
  let database = new ProjectdDatabase(path.join(root, "projectd.sqlite"))
  const identityManager = new BackgroundDeviceIdentityManager()
  const identity = await identityManager.generateNewIdentity()
  const identityRead = vi.spyOn(identityManager, "loadExistingIdentity").mockResolvedValue(identity)
  const worker = await loadSessionRoomWorker()
  const room = new RoomHost(worker)
  const token = await sessionTokenFor(worker, "principal_ready")()
  let offline = false
  let denied = false
  const retainedKey = randomBytes(32).toString("base64")
  let releaseAuth: (() => void) | undefined
  class QuietEvents extends EventEmitter {
    async start(): Promise<void> {}
    stop(): void {}
  }
  const socketPath = path.join(root, "daemon.sock")
  const createServer = () => new ProjectdServer({
    socketPath, database, sourceCatalogPath: path.join(root, "absent.sqlite"),
    backgroundIdentity: identityManager,
    refreshSessionAuth: async (request) => {
      if (denied) throw new BackgroundAccessDenied("Membership revoked")
      if (offline) throw new Error("Network unavailable")
      if (!releaseAuth) await new Promise<void>((resolve) => { releaseAuth = resolve })
      return { ...request, roomKeyBase64: retainedKey,
        ticket: { wsUrl: "ws://room.test/collab/sessions/ws", token } }
    },
    sessionConnectorFactory: () => async (handlers) => {
      if (offline) throw new Error("Network unavailable")
      return room.connector()(handlers)
    }, fileEventSourceFactory: () => new QuietEvents(),
    sessionRescanIntervalMs: 0,
  })
  let server = createServer()
  const client = new ProjectdClient({ socketPath })
  try {
    await server.start()
    await client.connect()
    const request = {
      projectId: "project", publicSessionId: TEST_PUBLIC_SESSION_ID,
      workspaceId: "session-workspace", rootPath: path.join(root, "workspace"),
      branchName: "main", title: "Session", setActive: true,
      background: { gatewayUrl: "https://gateway.example", convexUrl: "https://example.convex.cloud" },
    }
    const pending = client.ensureSessionWorkbench(request)
    await waitFor(() => Boolean(releaseAuth), "session authentication to begin")
    expect(await client.listWorkbenches("project")).toEqual([expect.objectContaining({ lifecycle: "idle" })])
    expect(await client.listSessions()).toEqual([])
    releaseAuth!()
    const ready = await pending
    expect(ready.workbench.lifecycle).toBe("active")
    expect((await client.getSessionStatus(TEST_PUBLIC_SESSION_ID))?.state).toBe("live")
    offline = true
    for (const socket of room.sockets) socket.close()
    await waitFor(async () => (await client.getSessionStatus(TEST_PUBLIC_SESSION_ID))?.state === "reconnecting", "room disconnection")
    const offlineWorkbench = await client.ensureSessionWorkbench(request)
    expect(offlineWorkbench.workbench.lifecycle).toBe("active")
    expect((await client.getSessionStatus(TEST_PUBLIC_SESSION_ID))?.state).toBe("reconnecting")
    expect(new BackgroundSessionStore(database).list(identity)[0]?.roomKeyBase64).toBe(retainedKey)
    await fs.writeFile(path.join(root, "workspace/offline.txt"), "new local work during outage")
    expect((await client.prepareSessionLeave(TEST_PUBLIC_SESSION_ID)).pendingBatches).toBeGreaterThan(0)
    const recovery = await client.exportSessionRecovery(TEST_PUBLIC_SESSION_ID, root)
    expect(await fs.readFile(path.join(recovery.directory, "project/offline.txt"), "utf8")).toBe("new local work during outage")
    client.disconnect()
    await server.stop()
    database.close()
    database = new ProjectdDatabase(path.join(root, "projectd.sqlite"))
    const connectionsBeforeColdStart = room.sockets.length
    server = createServer()
    await server.start()
    await client.connect()
    const coldWorkbench = await client.ensureSessionWorkbench(request)
    expect(coldWorkbench.workbench.workbenchId).toBe(ready.workbench.workbenchId)
    expect(coldWorkbench.workbench.lifecycle).toBe("active")
    expect(room.sockets.length).toBe(connectionsBeforeColdStart)
    await fs.writeFile(path.join(root, "workspace/offline.txt"), "edited after cold offline restart")
    expect((await client.prepareSessionLeave(TEST_PUBLIC_SESSION_ID)).pendingBatches).toBeGreaterThan(0)
    offline = false
    await client.ensureSessionWorkbench(request)
    await waitFor(async () => (await client.getSessionStatus(TEST_PUBLIC_SESSION_ID))?.pendingBatches === 0, "offline work acknowledged after reconnect")
    const replica = new SessionReplica(TEST_PUBLIC_SESSION_ID, "reader-after-cold-restart")
    const reader = new SessionRoomClient({ transport: new SessionTransport({ sessionId: TEST_PUBLIC_SESSION_ID,
      roomKey: Buffer.from(retainedKey, "base64"), replica }), connect: room.connector(),
      getToken: sessionTokenFor(worker, "reader_after_cold_restart") })
    try {
      await reader.connect()
      const entry = replica.tree.listLiveEntries().find((file) => file.path === "offline.txt")!
      expect(replica.textDocs.getTextContent(entry.fileId)).toBe("edited after cold offline restart")
    } finally { reader.disconnect() }
    denied = true
    await expect(client.ensureSessionWorkbench(request)).rejects.toThrow(/Membership revoked/)
    expect(await client.listSessions()).toEqual([])
    expect(new BackgroundSessionStore(database).list(identity)[0]?.roomKeyBase64).toBe(retainedKey)
  } finally {
    releaseAuth?.()
    client.disconnect()
    await server.stop()
    database.close()
    identityRead.mockRestore()
    room.dispose()
    await fs.rm(root, { recursive: true, force: true })
  }
})
