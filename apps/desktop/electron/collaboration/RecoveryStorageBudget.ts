import fs from "node:fs/promises"
import path from "node:path"

import { COLLABORATION_RECOVERY_LIMIT_BYTES, COLLABORATION_ROOM_RECOVERY_LIMIT_BYTES, type RecoveryStorageInventory } from "../../../../shared/collaborationRecovery"

const MAX_RECOVERY_ENTRIES = 50_000
const MAX_RECOVERY_DEPTH = 8

interface RecoveryStorageLimits { bytes?: number; roomBytes?: number; entries?: number }
const gates = new Map<string, Promise<unknown>>()

function missing(error: unknown): boolean { return Boolean(error && typeof error === "object" && "code" in error && error.code === "ENOENT") }

/** Metadata-only and bounded. Never follows links or reads code, keys, paths
 * from records, or ciphertext. Callers receive counts, not source filenames. */
export async function inventoryRecoveryStorage(root: string, maxEntries = MAX_RECOVERY_ENTRIES): Promise<RecoveryStorageInventory> {
  const result: RecoveryStorageInventory = { bytes: 0, files: 0, directories: 0, pendingFiles: 0, outboxRecords: 0, editorIngressRecords: 0, checkpointRecords: 0, projectionBackups: 0 }
  let entries = 0
  const visit = async (directory: string, depth: number): Promise<void> => {
    if (depth > MAX_RECOVERY_DEPTH) throw new Error("Collaboration recovery inventory exceeds its directory limit; all data was retained")
    const directoryStat = await fs.lstat(directory).catch(error => { if (missing(error)) return null; throw error })
    if (!directoryStat) return
    if (!directoryStat.isDirectory() || directoryStat.isSymbolicLink()) throw new Error("Collaboration recovery inventory encountered an unsafe directory; all data was retained")
    const stream = await fs.opendir(directory)
    for await (const entry of stream) {
      if (++entries > maxEntries) throw new Error("Collaboration recovery inventory exceeds its entry limit; all data was retained")
      const filename = path.join(directory, entry.name)
      const stat = await fs.lstat(filename).catch(error => { if (missing(error)) return null; throw error })
      if (!stat) continue // Concurrent acknowledgement may remove a record.
      if (stat.isSymbolicLink()) throw new Error("Collaboration recovery inventory encountered a link; all data was retained")
      if (stat.isDirectory()) { result.directories++; await visit(filename, depth + 1); continue }
      if (!stat.isFile() || !Number.isSafeInteger(stat.size) || stat.size < 0) throw new Error("Collaboration recovery inventory encountered an unexpected entry; all data was retained")
      result.files++; result.bytes += stat.size
      if (!Number.isSafeInteger(result.bytes)) throw new Error("Collaboration recovery inventory size is invalid; all data was retained")
      if (entry.name.endsWith(".pending") || entry.name.endsWith(".staging")) result.pendingFiles++
      if (/^outbox-[A-Za-z0-9_-]+\.json$/.test(entry.name)) result.outboxRecords++
      if (/^ingress-[A-Za-z0-9_-]+\.json$/.test(entry.name)) result.editorIngressRecords++
      if (entry.name === "checkpoint.json" || entry.name === "checkpoint-upload.json") result.checkpointRecords++
      if (entry.name.endsWith(".retained")) result.projectionBackups++
    }
  }
  await visit(path.resolve(root), 0)
  return result
}

/** All store instances/key versions share one main-process write admission
 * gate. Budget peak atomic-write space, including the existing replacement,
 * interrupted temporary files and projection backups. Never evict to make room. */
export function withRecoveryStorageBudget<T>(
  root: string, incomingBytes: number, operation: () => Promise<T>,
  options: { roomRoot?: string; limits?: RecoveryStorageLimits } = {},
): Promise<T> {
  if (!Number.isSafeInteger(incomingBytes) || incomingBytes < 0) return Promise.reject(new Error("Invalid collaboration recovery allocation"))
  const key = path.resolve(root)
  const previous = gates.get(key) ?? Promise.resolve()
  const next = previous.catch(() => {}).then(async () => {
    const inventory = await inventoryRecoveryStorage(key, options.limits?.entries)
    if (inventory.bytes + incomingBytes > (options.limits?.bytes ?? COLLABORATION_RECOVERY_LIMIT_BYTES)) throw new Error("Collaboration recovery storage is full; synchronization paused with unpublished data retained")
    if (options.roomRoot) {
      const relative = path.relative(key, path.resolve(options.roomRoot))
      if (!relative || relative === ".." || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new Error("Invalid collaboration room recovery allocation")
      const room = await inventoryRecoveryStorage(options.roomRoot, options.limits?.entries)
      if (room.bytes + incomingBytes > (options.limits?.roomBytes ?? COLLABORATION_ROOM_RECOVERY_LIMIT_BYTES)) throw new Error("Session recovery storage is full across retained key versions; unpublished data was retained")
    }
    return operation()
  })
  gates.set(key, next)
  const release = () => { if (gates.get(key) === next) gates.delete(key) }
  void next.then(release, release)
  return next
}
