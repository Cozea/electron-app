import { claimFileInitialization } from './collaborationFileInitialization'
import { collaborationDigest, COLLABORATION_CHUNK_CHARS, COLLABORATION_MAX_ENCODED_CHECKPOINT, validateEncryptedCollaborationEnvelope } from '../../../../shared/collaborationWire'
import type { CheckpointUploadLease, EncryptedCheckpointDescriptor } from '../../../../shared/collaborationCheckpoint'

interface CheckpointAuthority {
  userId: string
  roomId: string
  projectId: string
  role: 'editor' | 'observer'
  keyVersion: number | null
  rotationRequired?: boolean
  previousKeyVersion?: number
  sessionId?: string
}
interface StagedCheckpoint extends CheckpointUploadLease {
  totalChars?: number
  digest?: string
  received?: number[]
}
const DESCRIPTOR = 'encrypted-checkpoint'
const LEASE = 'checkpoint-lease'
const partKey = (id: string, index: number) => `checkpoint-piece:${id}:${index}`

/** All operations run through the room's command queue, including finalization. */
export async function handleCheckpointOperation(storage: DurableObjectStorage, authority: CheckpointAuthority, body: Record<string, unknown>): Promise<unknown> {
  if (authority.rotationRequired && !authority.previousKeyVersion && !['inspect', 'read'].includes(String(body.operation))) throw new Error('Room key rotation must finish before checkpoint or file changes')
  if (body.operation === 'file.claim') return claimFileInitialization(storage, authority, body.fileId)
  const latest = await storage.get<EncryptedCheckpointDescriptor>(DESCRIPTOR)
  // During cutover old-key readers can finish catching up from the retained
  // previous checkpoint. They never receive future-key ciphertext as old state.
  const current = latest && latest.keyVersion !== authority.keyVersion && !authority.previousKeyVersion
    ? await storage.get<EncryptedCheckpointDescriptor>(`checkpoint-history:${authority.keyVersion}`) : latest
  if (body.operation === 'inspect') return { checkpoint: current ?? null, headSequence: await storage.get<number>('head-sequence') ?? 0 }
  if (body.operation === 'read') {
    const index = body.index as number
    if (!current || body.id !== current.id || !Number.isSafeInteger(index) || index < 0 || index >= current.chunkCount) throw new Error('Checkpoint changed; inspect and retry recovery')
    const data = await storage.get<string>(partKey(current.id, index))
    if (!data) throw new Error('Encrypted checkpoint is incomplete; recovery data was retained')
    return { id: current.id, index, data }
  }
  if (authority.role !== 'editor' || !authority.keyVersion) throw new Error('An authorized editor with the current room key is required')
  if (body.operation === 'claim') {
    const sequence = body.sequence as number
    const head = await storage.get<number>('head-sequence') ?? 0
    if (authority.previousKeyVersion) {
      if (sequence !== head) throw new Error('Rotation checkpoint must cover the frozen room head')
      if (current?.keyVersion === authority.keyVersion && current.sequence === sequence) return { checkpoint: current }
    }
    if (!Number.isSafeInteger(sequence) || sequence < (current?.sequence ?? 0) || sequence > head || (!current && sequence !== 0)) throw new Error('Checkpoint sequence must cover a complete acknowledged state')
    const previous = await storage.get<StagedCheckpoint>(LEASE)
    if (previous && previous.id !== current?.id && previous.expiresAt > Date.now() && previous.keyVersion === authority.keyVersion) {
      if (previous.userId !== authority.userId || previous.sequence !== sequence) return { waiting: true, expiresAt: previous.expiresAt }
      return { lease: previous }
    }
    const lease: CheckpointUploadLease = { id: crypto.randomUUID(), userId: authority.userId, sequence, keyVersion: authority.keyVersion, expiresAt: Date.now() + 120_000 }
    // Retire only a superseded upload. Record its exact identity atomically with
    // the new lease; a crash must not strand pieces or delete a finalized base.
    await storage.put({
      [LEASE]: lease,
      ...(previous?.totalChars && previous.id !== latest?.id ? {
        [`checkpoint-cleanup:${previous.id}`]: { generation: 3, id: previous.id, roomId: authority.roomId, projectId: authority.projectId,
          keyVersion: previous.keyVersion, totalChars: previous.totalChars, chunkCount: Math.ceil(previous.totalChars / COLLABORATION_CHUNK_CHARS) },
      } : {}),
    })
    return { lease }
  }
  // Lost finalization replies are safe to retry even after the lease was cleared.
  if (body.operation === 'finalize' && current?.id === body.id) return { checkpoint: current }
  const lease = await storage.get<StagedCheckpoint>(LEASE)
  if (!lease || lease.id !== body.id || lease.userId !== authority.userId || lease.expiresAt <= Date.now() || lease.keyVersion !== authority.keyVersion) throw new Error('Checkpoint upload lease expired or changed')
  if (body.operation === 'upload') {
    const index = body.index as number, totalChars = body.totalChars as number
    const data = body.data, digest = body.digest
    if (!Number.isSafeInteger(totalChars) || totalChars < 1 || totalChars > COLLABORATION_MAX_ENCODED_CHECKPOINT ||
      !Number.isSafeInteger(index) || index < 0 || index >= Math.ceil(totalChars / COLLABORATION_CHUNK_CHARS) ||
      typeof digest !== 'string' || !/^[a-f0-9]{64}$/.test(digest) || typeof data !== 'string' || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) ||
      data.length !== Math.min(COLLABORATION_CHUNK_CHARS, totalChars - index * COLLABORATION_CHUNK_CHARS)) throw new Error('Invalid encrypted checkpoint chunk')
    if (lease.digest && (lease.digest !== digest || lease.totalChars !== totalChars)) throw new Error('Checkpoint upload content changed')
    const previous = await storage.get<string>(partKey(lease.id, index))
    if (previous && previous !== data) throw new Error('Checkpoint chunk content changed')
    const received = new Set(lease.received ?? [])
    received.add(index)
    await storage.put({ [partKey(lease.id, index)]: data, [LEASE]: { ...lease, totalChars, digest, received: [...received] } })
    return { received: index }
  }
  if (body.operation !== 'finalize') throw new Error('Unknown checkpoint operation')
  const count = Math.ceil((lease.totalChars ?? 0) / COLLABORATION_CHUNK_CHARS)
  if (!count || lease.received?.length !== count) throw new Error('Checkpoint upload is incomplete')
  const pieces: string[] = []
  for (let index = 0; index < count; index++) {
    const piece = await storage.get<string>(partKey(lease.id, index))
    if (!piece) throw new Error('Checkpoint storage is incomplete')
    pieces.push(piece)
  }
  const encoded = pieces.join('')
  if (await collaborationDigest(encoded) !== lease.digest) throw new Error('Checkpoint checksum failed')
  validateEncryptedCollaborationEnvelope(encoded, { roomId: authority.roomId, projectId: authority.projectId, kind: 'yjs_snapshot', keyVersion: authority.keyVersion })
  const envelope = JSON.parse(atob(encoded)) as { aad: string }
  const metadata = JSON.parse(atob(envelope.aad)) as { snapshotBaseSeq?: number }
  if (metadata.snapshotBaseSeq !== lease.sequence) throw new Error('Checkpoint does not authenticate its sequence')
  const descriptor: EncryptedCheckpointDescriptor = {
    generation: 3, id: lease.id, roomId: authority.roomId, projectId: authority.projectId,
    sequence: lease.sequence, keyVersion: lease.keyVersion, totalChars: encoded.length,
    chunkCount: count, digest: lease.digest!, createdAt: Date.now(),
  }
  // Preserve old-key bootstrap until activation completes, including if another
  // removal supersedes this pending key before the gateway receives our reply.
  await storage.put({
    [DESCRIPTOR]: descriptor,
    ...(current ? { [current.keyVersion !== descriptor.keyVersion ? `checkpoint-history:${current.keyVersion}` : `checkpoint-cleanup:${current.id}`]: current } : {}),
  })
  await storage.delete(LEASE)
  // Bounded retention consumes the durable cleanup record after validating the
  // replacement, including after a lost finalization reply or process restart.
  return { checkpoint: descriptor }
}
