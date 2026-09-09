import { createHash, randomUUID } from "node:crypto"
import * as Y from "yjs"
import { SessionFileDocument } from "../../../../shared/SessionFileDocument"
import { validatePublishedManifest, type SessionPublishedManifest } from "../../../../shared/collaborationPublication"
import { assertGitCommitSha } from "../../../../shared/collaborationSession"
import { bytesToEnvelope, decryptPayload, encryptPayload, envelopeToBytes } from "../../../../shared/collaborationCipher"
import { validateEncryptedCollaborationEnvelope } from "../../../../shared/collaborationWire"

export interface PublicationBasisContext { sessionId: string; projectId: string; roomId: string; keyVersion: number; roomKeyBase64: string }
export interface PublicationBasisIdentity { id: string; parentCommitSha: string; sequence: number }
export function gitTextBlobOid(content: string): string {
  return createHash("sha1").update(`blob ${Buffer.byteLength(content)}\0`).update(content, "utf8").digest("hex")
}
export async function encodePublicationBasis(context: PublicationBasisContext, parentCommitSha: string, sequence: number, update: Uint8Array): Promise<PublicationBasisIdentity & { encoded: string }> {
  assertGitCommitSha(parentCommitSha)
  if (!Number.isSafeInteger(sequence) || sequence < 0) throw new Error("Invalid publication capture sequence")
  const id = randomUUID()
  const envelope = await encryptPayload({ roomKeyBase64: context.roomKeyBase64, keyVersion: context.keyVersion, kind: "yjs_snapshot", plaintext: update,
    metadata: { roomId: context.roomId, projectId: context.projectId, sessionId: context.sessionId, purpose: "publication-basis", id, parentCommitSha, snapshotBaseSeq: sequence } })
  return { id, parentCommitSha, sequence, encoded: Buffer.from(envelopeToBytes(envelope)).toString("base64") }
}
export async function manifestFromPublicationBasis(context: PublicationBasisContext, identity: PublicationBasisIdentity, commitSha: string, encoded: string): Promise<SessionPublishedManifest> {
  assertGitCommitSha(commitSha); assertGitCommitSha(identity.parentCommitSha)
  validateEncryptedCollaborationEnvelope(encoded, { roomId: context.roomId, projectId: context.projectId, keyVersion: context.keyVersion, kind: "yjs_snapshot" })
  const envelope = bytesToEnvelope(Buffer.from(encoded, "base64"))
  const metadata = JSON.parse(Buffer.from(envelope.aad, "base64").toString("utf8")) as Record<string, unknown>
  if (metadata.purpose !== "publication-basis" || metadata.sessionId !== context.sessionId || metadata.id !== identity.id || metadata.parentCommitSha !== identity.parentCommitSha || metadata.snapshotBaseSeq !== identity.sequence) throw new Error("Prepared commit capture identity changed; retain both records for recovery")
  const document = new SessionFileDocument(context.sessionId)
  try {
    Y.applyUpdate(document.doc, await decryptPayload({ envelope, roomKeyBase64: context.roomKeyBase64 }))
    if (document.pathConflicts().length || document.renameConflicts().length) throw new Error("Prepared snapshot has unresolved file operations")
    return validatePublishedManifest({ version: 1, sessionId: context.sessionId, parentCommitSha: identity.parentCommitSha, commitSha, throughSequence: identity.sequence,
      files: document.files().map(file => ({ id: file.id, path: file.deleted ? null : file.path, blobOid: file.deleted ? null : gitTextBlobOid(file.content), executable: file.executable })) })
  } finally { document.destroy() }
}
