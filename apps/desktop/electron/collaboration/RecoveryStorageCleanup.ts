import * as Y from "yjs"
import { bytesToEnvelope, decryptPayload } from "../../../../shared/collaborationCipher"
import { validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"
import type { CollaborationRecoveryCleanupResult } from "../../../../shared/collaborationRecovery"
import { DurableSessionStore } from "./DurableSessionStore"

/** Authenticate the replacement before deleting only covered receive-log rows.
 * Never removes outboxes, ingress, pending uploads, keys, workspaces, prepared
 * Git objects, projection backups or unknown/corrupt files. */
export async function compactVerifiedRecoveryStore(input: {
  root: string; roomId: string; projectId: string; sessionId: string
  keyVersion: number; roomKeyBase64: string
}): Promise<CollaborationRecoveryCleanupResult> {
  const store = new DurableSessionStore(input.root, input.roomId, input.keyVersion)
  const { checkpoint } = await store.recover()
  if (!checkpoint) return { files: 0, bytes: 0 }
  validateEncryptedCollaborationEnvelope(checkpoint.snapshotBinary, { roomId: input.roomId, projectId: input.projectId, kind: "yjs_snapshot", keyVersion: input.keyVersion })
  const envelope = bytesToEnvelope(Buffer.from(checkpoint.snapshotBinary, "base64"))
  const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString("utf8")) as Record<string, unknown>
  if ((metadata.sessionId !== undefined && metadata.sessionId !== input.sessionId) || metadata.snapshotBaseSeq !== checkpoint.sequence) throw new Error("Recovery checkpoint identity is invalid; all data was retained")
  const update = await decryptPayload({ envelope, roomKeyBase64: input.roomKeyBase64, expectedKind: "yjs_snapshot" })
  const doc = new Y.Doc({ gc: false })
  try { Y.applyUpdate(doc, update) } finally { doc.destroy() }
  return store.compactAcknowledged(checkpoint)
}
