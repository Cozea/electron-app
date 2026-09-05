import { fileInitializationOrigin, type FileInitializationLease } from '../../../../shared/collaborationFileInitialization'

const recordKey = (id: string) => `file-initialization:${id}`
interface Authority { userId: string; keyVersion: number | null; role: 'editor' | 'observer' }

export async function claimFileInitialization(storage: DurableObjectStorage, authority: Authority, fileId: unknown): Promise<{ lease?: FileInitializationLease; sequence?: number; waiting?: boolean }> {
  if (typeof fileId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(fileId)) throw new Error('Invalid shared file identity')
  const previous = await storage.get<FileInitializationLease>(recordKey(fileId))
  if (previous?.sequence !== undefined) return { sequence: previous.sequence }
  if (authority.role !== 'editor' || !authority.keyVersion) return { waiting: true }
  if (!await storage.get('encrypted-checkpoint')) throw new Error('Wait for canonical session bootstrap')
  if (previous && previous.expiresAt > Date.now() && previous.keyVersion === authority.keyVersion) return previous.userId === authority.userId ? { lease: previous } : { waiting: true }
  const count = await storage.get<number>('file-initialization-count') ?? 0
  if (!previous && count >= 10_000) throw new Error('Session file limit reached; local work was retained')
  const lease: FileInitializationLease = { fileId, leaseId: crypto.randomUUID(), userId: authority.userId, keyVersion: authority.keyVersion, expiresAt: Date.now() + 120_000 }
  await storage.put({ [recordKey(fileId)]: lease, 'file-initialization-count': count + (previous ? 0 : 1) })
  return { lease }
}

/** Return state to persist atomically alongside the sequenced encrypted update. */
export async function acceptFileInitialization(storage: DurableObjectStorage, authority: Authority, encoded: string, sequence: number): Promise<Record<string, FileInitializationLease>> {
  const envelope = JSON.parse(atob(encoded)) as { aad: string }
  const aad = JSON.parse(atob(envelope.aad)) as { initialization?: unknown }
  if (aad.initialization === undefined) return {}
  const origin = fileInitializationOrigin(aad.initialization)
  if (!origin) throw new Error('Invalid shared file initialization')
  const lease = await storage.get<FileInitializationLease>(recordKey(origin.fileId))
  if (!lease || lease.sequence !== undefined || lease.userId !== authority.userId || lease.keyVersion !== authority.keyVersion || lease.leaseId !== origin.leaseId || lease.expiresAt <= Date.now()) throw new Error('File initialization lease expired or changed; preserve local edits for recovery')
  return { [recordKey(origin.fileId)]: { ...lease, sequence } }
}
