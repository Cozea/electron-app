import { randomBytes } from "node:crypto"
import fs from "node:fs/promises"
import os from "node:os"
import path from "node:path"
import { afterEach, describe, expect, it } from "vitest"

import { ProjectdClient } from "@cozea/projectd-protocol"
import { BackgroundSessionStore, type BackgroundSessionDescriptor } from "../../apps/projectd/src/collaboration/BackgroundSessionStore"
import { LocalReplicaStore } from "../../apps/projectd/src/collaboration/LocalReplicaStore"
import { SessionReplica } from "../../apps/projectd/src/collaboration/SessionReplica"
import { BackgroundDeviceIdentityManager } from "../../apps/projectd/src/identity/BackgroundDeviceIdentity"
import { ProjectdServer } from "../../apps/projectd/src/server/ProjectdServer"
import { ProjectdDatabase } from "../../apps/projectd/src/storage/Database"

describe("frozen recovery preview protocol", () => {
  const cleanup: Array<() => Promise<void> | void> = []

  afterEach(async () => {
    for (const dispose of cleanup.splice(0).reverse()) await dispose()
  })

  it("previews retained state over the socket without attaching or mutating the session", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "cozea-recovery-preview-rpc-"))
    cleanup.push(() => fs.rm(root, { recursive: true, force: true }))
    const socketPath = path.join(root, "projectd.sock")
    const database = new ProjectdDatabase(path.join(root, "projectd.sqlite"))
    cleanup.push(() => database.close())

    const identityFactory = new BackgroundDeviceIdentityManager()
    const identity = await identityFactory.generateNewIdentity()
    const backgroundIdentity = {
      loadExistingIdentity: async () => identity,
    } as BackgroundDeviceIdentityManager

    const publicSessionId = "czs_0123456789abcdef"
    const roomKey = randomBytes(32)
    const descriptor: BackgroundSessionDescriptor = {
      publicSessionId,
      projectId: "project",
      workspaceId: "workspace",
      rootPath: path.join(root, "workspace"),
      branchName: "collab/test",
      roomKeyBase64: roomKey.toString("base64"),
      roomKeyVersion: 1,
      ticket: { wsUrl: "wss://unused.example", token: "retained-ticket", role: "developer" },
      background: { gatewayUrl: "https://unused.example", convexUrl: "https://unused.convex.cloud" },
    }
    const store = new BackgroundSessionStore(database)
    store.save(descriptor, identity)
    store.remove(publicSessionId)

    const replica = new SessionReplica(publicSessionId, "rpc-fixture")
    replica.createFile({ path: "src/recovered.ts", kind: "text", content: "export const retained = true", actor: { actorType: "user" } })
    new LocalReplicaStore(database, { sessionId: publicSessionId, roomKey }).save({
      sequence: 9,
      replica: replica.captureSnapshot(),
    })

    const server = new ProjectdServer({ socketPath, database, backgroundIdentity })
    await server.start()
    cleanup.push(() => server.stop())
    const client = new ProjectdClient({ socketPath })
    cleanup.push(() => client.disconnect())

    const preview = await client.previewSessionRecovery(publicSessionId, undefined, 1)
    expect(preview).toMatchObject({
      publicSessionId,
      snapshotSequence: 9,
      pendingBatches: 0,
      pendingBinaryVersions: 0,
      totalEntries: 1,
      nextCursor: null,
      entries: [{ path: "src/recovered.ts", kind: "text", textPreview: "export const retained = true" }],
    })
    expect(await client.listSessions()).toEqual([])
    expect(store.listRecovery(identity)).toEqual([descriptor])
    expect(new LocalReplicaStore(database, { sessionId: publicSessionId, roomKey }).load()?.sequence).toBe(9)

    await expect(client.request("sessions.recovery.preview", { publicSessionId, limit: 101 }))
      .rejects.toMatchObject({ code: "INVALID_PARAMS" })
    await expect(client.previewSessionRecovery("czs_ffffffffffffffff"))
      .rejects.toMatchObject({ code: "NOT_FOUND" })
  })
})
