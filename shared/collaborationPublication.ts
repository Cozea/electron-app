import type { CollaborationTextChange } from "./collaborationDesktop"
import type { SharedSessionFile } from "./SessionFileDocument"
import { assertGitCommitSha } from "./collaborationSession"
import { assertSharedFilePath, sharedPathComparisonKey } from "./collaborationPaths"

export interface PublishedFileBaseline {
  id: string
  path: string | null
  blobOid: string | null
  executable: boolean
}
export interface SessionPublishedManifest {
  version: 1
  sessionId: string
  commitSha: string
  parentCommitSha: string
  throughSequence: number
  files: PublishedFileBaseline[]
}

/** Immutable publication metadata travels inside the encrypted Yjs document.
 * It is used only when its SHA is the server-verified Git base. It does not
 * replace the evolving live state or this device's projection receipts.
 */
export function validatePublishedManifest(value: unknown, expected: { sessionId?: string; commitSha?: string } = {}): SessionPublishedManifest {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Published file baseline is unavailable")
  const record = value as Record<string, unknown>
  if (record.version !== 1 || typeof record.sessionId !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(record.sessionId) ||
      typeof record.commitSha !== "string" || typeof record.parentCommitSha !== "string" ||
      !Number.isSafeInteger(record.throughSequence) || Number(record.throughSequence) < 0 || !Array.isArray(record.files) || record.files.length > 10_000 ||
      expected.sessionId !== undefined && record.sessionId !== expected.sessionId || expected.commitSha !== undefined && record.commitSha !== expected.commitSha) throw new Error("Published file baseline identity is invalid")
  assertGitCommitSha(record.commitSha); assertGitCommitSha(record.parentCommitSha)
  const ids = new Set<string>(), paths = new Set<string>()
  const files: PublishedFileBaseline[] = record.files.map(value => {
    if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Published file baseline entry is invalid")
    const file = value as Record<string, unknown>
    if (typeof file.id !== "string" || !/^[A-Za-z0-9_-]{1,160}$/.test(file.id) || ids.has(file.id) || typeof file.executable !== "boolean") throw new Error("Published file identity is invalid")
    ids.add(file.id)
    if (file.path === null && file.blobOid === null) return { id: file.id, path: null, blobOid: null, executable: file.executable }
    if (typeof file.path !== "string" || typeof file.blobOid !== "string" || !/^[a-f0-9]{40}$/.test(file.blobOid)) throw new Error("Published file path/object is invalid")
    const relative = assertSharedFilePath(file.path), key = sharedPathComparisonKey(relative)
    if (paths.has(key)) throw new Error("Published baseline contains colliding paths")
    paths.add(key)
    return { id: file.id, path: relative, blobOid: file.blobOid, executable: file.executable }
  })
  for (const key of paths) {
    const parts = key.split("/")
    for (let count = 1; count < parts.length; count++) if (paths.has(parts.slice(0, count).join("/"))) throw new Error("Published baseline contains file/directory collisions")
  }
  return { version: 1, sessionId: record.sessionId, commitSha: record.commitSha, parentCommitSha: record.parentCommitSha,
    throughSequence: Number(record.throughSequence), files: files.sort((a, b) => a.id < b.id ? -1 : a.id > b.id ? 1 : 0) }
}

/** Compare the live snapshot with its actual published parent, never with the
 * path at which a file happened to enter the session. New file initializations
 * not yet in the manifest may still use their Git-origin path for this parent.
 */
export function changesFromPublishedBaseline(files: readonly SharedSessionFile[], published?: SessionPublishedManifest): CollaborationTextChange[] {
  const live = new Map(files.map(file => [file.id, file]))
  const baseline = new Map((published?.files ?? []).map(file => [file.id, file]))
  const changes = new Map<string, CollaborationTextChange>()
  for (const before of baseline.values()) {
    const after = live.get(before.id)
    if (!after) throw new Error("A published file identity is absent from the live snapshot; retain the history and recover it before committing")
    if (before.path !== null && (after.deleted || after.path !== before.path)) changes.set(before.path, { path: before.path, content: null })
  }
  for (const file of files) {
    if (!baseline.has(file.id) && file.originalPath && (file.deleted || file.path !== file.originalPath)) changes.set(file.originalPath, { path: file.originalPath, content: null })
  }
  // Additions intentionally follow deletions: reuse of an old path by a new
  // identity materializes the new file instead of reviving the old identity.
  for (const file of files) if (!file.deleted) changes.set(file.path, { path: file.path, content: file.content, executable: file.executable })
  return [...changes.values()].sort((a, b) => a.path.localeCompare(b.path))
}
