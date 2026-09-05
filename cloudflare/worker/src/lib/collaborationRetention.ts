import type { EncryptedCheckpointDescriptor } from '../../../../shared/collaborationCheckpoint'
import { collaborationDigest, COLLABORATION_CHUNK_CHARS, COLLABORATION_MAX_ENCODED_CHECKPOINT, validateEncryptedCollaborationEnvelope } from '../../../../shared/collaborationWire'
import type { RoomAuthority } from './collaborationV2Convex'

const HISTORY = 'checkpoint-history:'
const MAX_DELETIONS = 128

function validateDescriptor(value: EncryptedCheckpointDescriptor, authority: RoomAuthority, head: number): void {
  if (value.generation !== 3 || value.roomId !== authority.roomId || value.projectId !== authority.projectId ||
    !/^[A-Za-z0-9_-]{1,128}$/.test(value.id) || !Number.isSafeInteger(value.keyVersion) || value.keyVersion < 1 ||
    !Number.isSafeInteger(value.sequence) || value.sequence < 0 || value.sequence > head ||
    !Number.isSafeInteger(value.totalChars) || value.totalChars < 1 || value.totalChars > COLLABORATION_MAX_ENCODED_CHECKPOINT ||
    value.chunkCount !== Math.ceil(value.totalChars / COLLABORATION_CHUNK_CHARS) || !/^[a-f0-9]{64}$/.test(value.digest)) {
    throw new Error('Checkpoint retention encountered invalid metadata; recovery data was retained')
  }
}

/** Bounded reads (one maximum-size checkpoint) and at most 128 deletions per pass.
 * The caller holds the room command queue and supplies freshly verified authority.
 * Pending rotations keep their old active-key fallback. Local sealed keys and
 * offline edits are independent recovery data and are never cleanup targets here.
 */
export async function retainActiveCheckpoint(storage: DurableObjectStorage, authority: RoomAuthority): Promise<{ removedRecords: number }> {
  const unchanged = { removedRecords: 0 }
  if (!authority.allowed || !authority.keyVersion || authority.rotationRequired || !authority.roomId?.startsWith('session:')) return unchanged
  const current = await storage.get<EncryptedCheckpointDescriptor>('encrypted-checkpoint')
  if (!current || current.keyVersion !== authority.keyVersion) return unchanged
  const history = await storage.list<EncryptedCheckpointDescriptor>({ prefix: HISTORY, limit: 16 })
  if (!history.size) return unchanged
  const head = await storage.get<number>('head-sequence') ?? 0
  validateDescriptor(current, authority, head)
  const lease = await storage.get<{ id: string }>('checkpoint-lease')
  const candidate = [...history].find(([name, value]) => {
    validateDescriptor(value, authority, head)
    if (name !== `${HISTORY}${value.keyVersion}`) throw new Error('Checkpoint history identity is invalid; recovery data was retained')
    return value.keyVersion < current.keyVersion && value.sequence <= current.sequence && value.id !== current.id && value.id !== lease?.id
  })
  if (!candidate) return unchanged

  // Do not prune a fallback merely because a replacement descriptor exists.
  // Verify every durable encrypted piece and the authenticated sequence first.
  const pieces: string[] = []
  for (let index = 0; index < current.chunkCount; index++) {
    const piece = await storage.get<string>(`checkpoint-piece:${current.id}:${index}`)
    if (typeof piece !== 'string' || piece.length !== Math.min(COLLABORATION_CHUNK_CHARS, current.totalChars - index * COLLABORATION_CHUNK_CHARS)) throw new Error('Replacement checkpoint is incomplete; recovery data was retained')
    pieces.push(piece)
  }
  const encoded = pieces.join('')
  if (await collaborationDigest(encoded) !== current.digest) throw new Error('Replacement checkpoint checksum failed; recovery data was retained')
  validateEncryptedCollaborationEnvelope(encoded, { roomId: current.roomId, projectId: current.projectId, kind: 'yjs_snapshot', keyVersion: current.keyVersion })
  const envelope = JSON.parse(atob(encoded)) as { aad: string }
  if ((JSON.parse(atob(envelope.aad)) as { snapshotBaseSeq?: number }).snapshotBaseSeq !== current.sequence) throw new Error('Replacement checkpoint sequence is invalid; recovery data was retained')

  const [historyKey, old] = candidate
  const prefix = `checkpoint-piece:${old.id}:`
  const records = await storage.list<string>({ prefix, limit: MAX_DELETIONS })
  for (const name of records.keys()) {
    const index = name.slice(prefix.length)
    if (!/^(0|[1-9][0-9]*)$/.test(index) || Number(index) >= old.chunkCount) throw new Error('Checkpoint history contains an unexpected piece; recovery data was retained')
  }
  const keys = [...records.keys()]
  // Keep the descriptor as the durable cleanup cursor until all pieces are gone.
  // Deleting it with the final batch is atomic and a lost reply is safe to retry.
  if (keys.length < MAX_DELETIONS) keys.push(historyKey)
  return storage.transaction(async transaction => {
    const latest = await transaction.get<EncryptedCheckpointDescriptor>('encrypted-checkpoint')
    const previous = await transaction.get<EncryptedCheckpointDescriptor>(historyKey)
    const pending = await transaction.get<{ id: string }>('checkpoint-lease')
    if (latest?.id !== current.id || latest.digest !== current.digest || previous?.id !== old.id || pending?.id === old.id) return unchanged
    return { removedRecords: await transaction.delete(keys) }
  })
}
