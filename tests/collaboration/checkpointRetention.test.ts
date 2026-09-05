/* oxlint-disable typescript/triple-slash-reference -- Worker globals are ambient. */
/// <reference path="../../cloudflare/worker/src/cloudflare-runtime.d.ts" />
import { describe, expect, it } from 'vitest'
import * as Y from 'yjs'
import { retainActiveCheckpoint } from '../../cloudflare/worker/src/lib/collaborationRetention'
import { encryptPayload, envelopeToBytes, decryptPayload, bytesToEnvelope } from '../../shared/collaborationCipher'
import { collaborationDigest, COLLABORATION_CHUNK_CHARS } from '../../shared/collaborationWire'
import type { EncryptedCheckpointDescriptor } from '../../shared/collaborationCheckpoint'

const authority = { allowed: true, roomId: 'session:s', projectId: 'p', keyVersion: 3 }
const key = Buffer.alloc(32, 3).toString('base64')

async function fixture() {
  const records = new Map<string, unknown>()
  let failDelete = false
  const deletions: string[][] = []
  const storage = {
    get: async (name: string) => structuredClone(records.get(name)),
    list: async (options: DurableObjectStorageListOptions = {}) => new Map([...records].sort(([a], [b]) => a.localeCompare(b)).filter(([name]) => !options.prefix || name.startsWith(options.prefix)).slice(0, options.limit)),
    delete: async (names: string[]) => {
      if (names.length > 128) throw new Error('Cloudflare delete limit')
      if (failDelete) { failDelete = false; throw new Error('storage unavailable') }
      deletions.push(names)
      return names.reduce((count, name) => count + Number(records.delete(name)), 0)
    },
    transaction: async (run: (transaction: DurableObjectStorage) => Promise<unknown>) => {
      const before = structuredClone(records)
      try { return await run(storage as unknown as DurableObjectStorage) }
      catch (error) { records.clear(); for (const [name, value] of before) records.set(name, value); throw error }
    },
  } as unknown as DurableObjectStorage
  const doc = new Y.Doc({ gc: false })
  doc.getText('file').insert(0, 'base')
  const original = Y.encodeStateAsUpdate(doc)
  const offline = new Y.Doc({ gc: false })
  Y.applyUpdate(offline, original)
  const vector = Y.encodeStateVector(offline)
  offline.getText('file').insert(2, 'offline')
  doc.getText('file').delete(0, 1)
  const encoded = Buffer.from(envelopeToBytes(await encryptPayload({ roomKeyBase64: key, kind: 'yjs_snapshot', keyVersion: 3,
    plaintext: Y.encodeStateAsUpdate(doc), metadata: { roomId: 'session:s', projectId: 'p', snapshotBaseSeq: 5 } }))).toString('base64')
  const current: EncryptedCheckpointDescriptor = { generation: 3, id: 'current', roomId: 'session:s', projectId: 'p', keyVersion: 3,
    sequence: 5, totalChars: encoded.length, chunkCount: Math.ceil(encoded.length / COLLABORATION_CHUNK_CHARS), digest: await collaborationDigest(encoded), createdAt: 1 }
  records.set('encrypted-checkpoint', current)
  records.set('head-sequence', 7)
  for (let index = 0; index < current.chunkCount; index++) records.set(`checkpoint-piece:current:${index}`, encoded.slice(index * COLLABORATION_CHUNK_CHARS, (index + 1) * COLLABORATION_CHUNK_CHARS))
  const history = (version: number, chunks = 1) => {
    records.set(`checkpoint-history:${version}`, { ...current, id: `old-${version}`, keyVersion: version, sequence: 3, chunkCount: chunks, totalChars: chunks * COLLABORATION_CHUNK_CHARS })
    for (let index = 0; index < chunks; index++) records.set(`checkpoint-piece:old-${version}:${index}`, 'retained encrypted history piece')
  }
  history(1); history(2)
  records.set('checkpoint-lease', { id: 'pending' })
  records.set('checkpoint-piece:pending:0', 'unfinished encrypted upload')
  records.set('file-initialization:file', { sequence: 2, leaseId: 'original' })
  records.set('update:0000000000000006', { updateBinary: 'newer encrypted edit' })
  records.set('idempotency:offline', { sequence: 2 })
  const delta = Y.encodeStateAsUpdate(offline, vector)
  Y.applyUpdate(doc, delta)
  const expectedText = doc.getText('file').toString()
  doc.destroy(); offline.destroy()
  return { storage, records, current, history, deletions, delta, expectedText, failNextDelete: () => { failDelete = true } }
}

describe('activated encrypted checkpoint history retention', () => {
  it('retains rotation fallbacks until activation and allows an older offline edit after history cleanup', async () => {
    const f = await fixture(), before = structuredClone(f.records)
    for (const auth of [{ ...authority, keyVersion: 2 }, { ...authority, rotationRequired: true }, { ...authority, allowed: false }]) {
      expect(await retainActiveCheckpoint(f.storage, auth)).toEqual({ removedRecords: 0 })
      expect(f.records).toEqual(before)
    }
    expect(await retainActiveCheckpoint(f.storage, authority)).toEqual({ removedRecords: 2 })
    expect(await retainActiveCheckpoint(f.storage, authority)).toEqual({ removedRecords: 2 })
    expect(await retainActiveCheckpoint(f.storage, authority)).toEqual({ removedRecords: 0 })
    for (const [name, value] of before) if (!name.startsWith('checkpoint-history:') && !name.startsWith('checkpoint-piece:old-')) expect(f.records.get(name)).toEqual(value)
    const recovered = new Y.Doc({ gc: false })
    try {
      Y.applyUpdate(recovered, await decryptPayload({ roomKeyBase64: key, envelope: bytesToEnvelope(Buffer.from(f.records.get('checkpoint-piece:current:0') as string, 'base64')) }))
      Y.applyUpdate(recovered, f.delta)
      expect(recovered.getText('file').toString()).toBe(f.expectedText)
      expect(f.expectedText).toContain('offline')
    } finally { recovered.destroy() }
  })

  it('bounds deletion and resumes after a lost reply or failed batch without touching pending uploads', async () => {
    const f = await fixture(); f.history(1, 260)
    f.failNextDelete()
    const before = structuredClone(f.records)
    await expect(retainActiveCheckpoint(f.storage, authority)).rejects.toThrow('storage unavailable')
    expect(f.records).toEqual(before)
    // The return value of the first successful request is deliberately lost.
    await retainActiveCheckpoint(f.storage, authority)
    expect(f.records.has('checkpoint-history:1')).toBe(true)
    expect(await retainActiveCheckpoint(f.storage, authority)).toEqual({ removedRecords: 128 })
    expect(await retainActiveCheckpoint(f.storage, authority)).toEqual({ removedRecords: 5 })
    expect(f.records.has('checkpoint-history:1')).toBe(false)
    expect(f.deletions.every(names => names.length <= 128)).toBe(true)
    expect(f.records.has('checkpoint-piece:pending:0')).toBe(true)
    expect(f.records.has('checkpoint-history:2')).toBe(true)
  })

  it.each(['missing', 'corrupt', 'wrong-sequence', 'wrong-room', 'unexpected-piece'])('retains all remaining history when replacement evidence is %s', async kind => {
    const f = await fixture()
    if (kind === 'missing') f.records.delete('checkpoint-piece:current:0')
    if (kind === 'corrupt') f.records.set('checkpoint-piece:current:0', 'A'.repeat(f.current.totalChars))
    if (kind === 'wrong-sequence') f.records.set('encrypted-checkpoint', { ...f.current, sequence: 6 })
    if (kind === 'wrong-room') f.records.set('encrypted-checkpoint', { ...f.current, roomId: 'session:other' })
    if (kind === 'unexpected-piece') f.records.set('checkpoint-piece:old-1:unknown', 'unclassified')
    const before = structuredClone(f.records)
    await expect(retainActiveCheckpoint(f.storage, authority)).rejects.toThrow()
    expect(f.records).toEqual(before)
    expect(f.deletions).toEqual([])
  })
})
