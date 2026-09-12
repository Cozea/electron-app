import { randomUUID } from "node:crypto"
import type { BackgroundRecoveryAccess } from "./BackgroundSessionAuth"
import { SessionBinaryObjectStore } from "./BinaryObjectStore"
import { CloudReplicaStore } from "./CloudReplicaStore"
import { exportRecoveryReplica } from "./LocalRecoveryExporter"
import { SessionReplica } from "./SessionReplica"
import { SessionTransport } from "./SessionTransport"
import { SessionRoomClient, webSocketRoomConnector, type RoomConnector } from "./SessionRoomClient"

interface CloudRecoveryExportOptions {
  getAccess: () => Promise<BackgroundRecoveryAccess>
  destinationParent: string
  sourceRoot?: string
  connectorFactory?: (url: string) => RoomConnector
  fetchFn?: typeof fetch
}

/** Read-only frozen-session recovery, independent of the local replica and outbox. */
export async function exportCloudRecovery(options: CloudRecoveryExportOptions) {
  const access = await options.getAccess()
  if (access.ticket.sessionAccess !== "recovery") throw new Error("A read-only recovery ticket is required")
  const replica = new SessionReplica(access.publicSessionId, `cloud_export_${randomUUID()}`)
  const keys = { sessionId: access.publicSessionId, roomKey: Buffer.from(access.roomKeyBase64, "base64"),
    roomKeyVersion: access.roomKeyVersion, previousRoomKeys: Object.fromEntries(Object.entries(access.previousRoomKeysBase64)
      .map(([version, key]) => [version, Buffer.from(key, "base64")])) }
  const objects = new SessionBinaryObjectStore({ ...keys, getRoomUrl: () => access.ticket.wsUrl,
    getToken: async () => access.ticket.token, fetchFn: options.fetchFn })
  const cloud = new CloudReplicaStore(access.publicSessionId, objects)
  const client = new SessionRoomClient({ transport: new SessionTransport({ ...keys, replica }),
    connect: (options.connectorFactory ?? webSocketRoomConnector)(access.ticket.wsUrl),
    getToken: async () => access.ticket.token, loadSnapshot: (record) => cloud.download(record) })
  try {
    await client.connect()
    const lifecycle = await client.getLifecycleState()
    const snapshot = await client.getSnapshot()
    const fence = lifecycle.fence
    if (!snapshot || !fence || snapshot.sessionSeq !== fence.sessionSeq ||
      snapshot.barrierId !== fence.barrierId || snapshot.keyVersion !== fence.keyVersion) {
      throw new Error("The session has no complete frozen recovery snapshot")
    }
    const retained = new SessionReplica(access.publicSessionId, `export_${randomUUID()}`)
    retained.restoreSnapshot(await cloud.download(snapshot))
    return await exportRecoveryReplica({ replica: retained, pending: [], snapshotSequence: snapshot.sessionSeq,
      source: "cloud", sourceRoot: options.sourceRoot, destinationParent: options.destinationParent,
      writeBinary: async (revision, write) => {
        if (!revision.manifest) return false
        if (revision.manifest.contentHash !== revision.contentHash || revision.manifest.size !== revision.size) {
          throw new Error("Recovery binary manifest does not match its revision")
        }
        // Authentication, integrity and network failures abort the export rather
        // than silently presenting a damaged cloud download as a complete copy.
        await objects.downloadTo(revision.manifest, write)
        return true
      } })
  } finally { client.disconnect() }
}
