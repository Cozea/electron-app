import type { BinaryObjectClient } from "./BinaryObjectStore"
import type { ReplicaSnapshot } from "./SessionReplica"
import { parseCloudSnapshot, type CloudSnapshotRecord } from "@shared/collaboration/cloudSnapshot"

export class CloudReplicaStore {
  private readonly objects: BinaryObjectClient
  private readonly sessionId: string

  constructor(sessionId: string, objects: BinaryObjectClient) {
    this.sessionId = sessionId
    this.objects = objects
  }

  async upload(input: { sessionSeq: number; barrierId: string; keyVersion: number }, replica: ReplicaSnapshot): Promise<CloudSnapshotRecord> {
    if (replica.sessionId !== this.sessionId) throw new Error("Cloud snapshot session mismatch")
    const bytes = Buffer.from(JSON.stringify({ ...input, replica }, (_, value) => value instanceof Uint8Array
      ? { __b64: Buffer.from(value).toString("base64") } : value))
    if (bytes.length > 64 * 1024 * 1024) throw new Error("Cloud snapshot exceeds storage budget")
    const manifest = await this.objects.upload(bytes)
    const record = { ...input, manifest }
    if (!parseCloudSnapshot(record)) throw new Error("Invalid cloud snapshot manifest")
    // Verify authenticated durable objects before allowing the room to publish a
    // bootstrap pointer. Interrupted uploads leave no published snapshot.
    if (!(await this.objects.download(manifest)).equals(bytes)) throw new Error("Cloud snapshot verification failed")
    return record
  }

  async download(record: CloudSnapshotRecord): Promise<ReplicaSnapshot> {
    if (!parseCloudSnapshot(record)) throw new Error("Invalid cloud snapshot manifest")
    const bytes = await this.objects.download(record.manifest)
    const value = JSON.parse(bytes.toString("utf8"), (_, item) => item && typeof item === "object" && typeof item.__b64 === "string"
      ? new Uint8Array(Buffer.from(item.__b64, "base64")) : item) as {
        sessionSeq: number; barrierId: string; keyVersion: number; replica: ReplicaSnapshot
      }
    if (value.sessionSeq !== record.sessionSeq || value.barrierId !== record.barrierId || value.keyVersion !== record.keyVersion ||
      value.replica?.sessionId !== this.sessionId || !(value.replica.treeUpdate instanceof Uint8Array) ||
      !value.replica.textUpdates || !Array.isArray(value.replica.binaryRevisions) ||
      Object.values(value.replica.textUpdates).some((update) => !(update instanceof Uint8Array))) {
      throw new Error("Cloud snapshot identity mismatch")
    }
    return value.replica
  }
}
