/** Public metadata describes encrypted chunks only; source and paths stay inside them. */
export interface CloudSnapshotManifest {
  contentHash: string
  size: number
  chunkSize: number
  chunks: Array<{ index: number; hash: string; size: number; encryptedRef: string }>
}

export interface CloudSnapshotRecord {
  sessionSeq: number
  barrierId: string
  keyVersion: number
  manifest: CloudSnapshotManifest
}

export function parseCloudSnapshot(value: unknown): CloudSnapshotRecord | null {
  if (!value || typeof value !== "object") return null
  const record = value as Partial<CloudSnapshotRecord>
  if (!Number.isSafeInteger(record.sessionSeq) || record.sessionSeq! < 0 ||
    typeof record.barrierId !== "string" || !/^barrier_[a-f0-9]{32}$/.test(record.barrierId) ||
    !Number.isSafeInteger(record.keyVersion) || record.keyVersion! < 1) return null
  const manifest = record.manifest
  if (!manifest || !/^[a-f0-9]{64}$/.test(manifest.contentHash) ||
    !Number.isSafeInteger(manifest.size) || manifest.size < 1 || manifest.size > 64 * 1024 * 1024 ||
    manifest.chunkSize !== 4 * 1024 * 1024 || !Array.isArray(manifest.chunks) ||
    manifest.chunks.length !== Math.ceil(manifest.size / manifest.chunkSize)) return null
  for (let index = 0; index < manifest.chunks.length; index++) {
    const chunk = manifest.chunks[index]
    const size = Math.min(manifest.chunkSize, manifest.size - index * manifest.chunkSize)
    if (!chunk || chunk.index !== index || chunk.size !== size || !/^[a-f0-9]{64}$/.test(chunk.hash) ||
      chunk.encryptedRef !== `v1/${record.keyVersion}/${manifest.contentHash}/${index}/${chunk.hash}`) return null
  }
  return record as CloudSnapshotRecord
}
