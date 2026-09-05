import { collaborationDigest, validateCollaborationChunk, type CollaborationChunk } from '../../../../shared/collaborationWire'

interface Assembly {
  owner: string
  digest: string
  totalChars: number
  count: number
  received: number[]
  expiresAt: number
}
const PREFIX = 'chunk-assembly:'
const key = (id: string) => `${PREFIX}${id}`
const pieceKey = (id: string, index: number) => `chunk-piece:${id}:${index}`

/** Called through the room's ordered command queue. Pieces survive hibernation. */
export async function acceptDurableCollaborationChunk(storage: DurableObjectStorage, owner: string, chunk: CollaborationChunk): Promise<string | null> {
  validateCollaborationChunk(chunk)
  const now = Date.now()
  let assembly = await storage.get<Assembly>(key(chunk.id))
  if (!assembly) {
    const pending = await storage.list<Assembly>({ prefix: PREFIX, limit: 33 })
    for (const [assemblyKey, candidate] of pending) {
      if (candidate.expiresAt > now) continue
      await discardDurableCollaborationChunks(storage, assemblyKey.slice(PREFIX.length), candidate.count)
      pending.delete(assemblyKey)
    }
    if (pending.size >= 32 || [...pending.values()].filter(value => value.owner === owner).length >= 4) throw new Error('Incomplete collaboration upload limit reached')
    assembly = { owner, digest: chunk.digest, totalChars: chunk.totalChars, count: chunk.count, received: [], expiresAt: now + 5 * 60_000 }
  }
  if (assembly.owner !== owner || assembly.digest !== chunk.digest || assembly.totalChars !== chunk.totalChars) throw new Error('Chunk upload belongs to a different operation')
  const previous = await storage.get<string>(pieceKey(chunk.id, chunk.index))
  if (previous !== undefined && previous !== chunk.data) throw new Error('Chunk was retried with different content')
  if (!assembly.received.includes(chunk.index)) assembly.received.push(chunk.index)
  await storage.put({ [key(chunk.id)]: assembly, [pieceKey(chunk.id, chunk.index)]: chunk.data })
  if (assembly.received.length !== assembly.count) return null
  const pieces: string[] = []
  for (let index = 0; index < assembly.count; index++) {
    const piece = await storage.get<string>(pieceKey(chunk.id, index))
    if (piece === undefined) throw new Error('Encrypted chunk storage is incomplete; retry the upload')
    pieces.push(piece)
  }
  const result = pieces.join('')
  if (await collaborationDigest(result) !== assembly.digest) throw new Error('Encrypted chunk checksum failed')
  return result
}

export async function discardDurableCollaborationChunks(storage: DurableObjectStorage, id: string, count: number): Promise<void> {
  await storage.delete([key(id), ...Array.from({ length: count }, (_, index) => pieceKey(id, index))])
}
