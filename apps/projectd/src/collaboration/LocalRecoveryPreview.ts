import type {
  ProjectdRecoveryConflictKind,
  ProjectdRecoveryPreviewEntry,
  ProjectdRecoveryPreviewResult,
} from "@cozea/projectd-protocol"
import type { ProjectdDatabase } from "../storage/Database"
import type { BackgroundSessionIntent } from "./BackgroundSessionStore"
import { LocalReplicaStore } from "./LocalReplicaStore"
import { OutboundBatchQueue } from "./OutboundBatchQueue"
import { PendingBinaryStore, type PendingBinaryRecord } from "./PendingBinaryStore"
import { SessionReplica } from "./SessionReplica"

const DEFAULT_PAGE_SIZE = 40
const MAX_PAGE_SIZE = 100
const MAX_TEXT_PREVIEW_BYTES = 8 * 1024
const MAX_SYMLINK_PREVIEW_BYTES = 4 * 1024

export type LocalRecoveryConflictKind = ProjectdRecoveryConflictKind
export type LocalRecoveryPreviewFile = ProjectdRecoveryPreviewEntry
export type LocalRecoveryPreviewResult = ProjectdRecoveryPreviewResult

export interface LocalRecoveryPreviewOptions {
  afterCursor?: string
  limit?: number
}

/**
 * Builds an inspect-only view of retained collaboration state. It never opens the
 * workspace, contacts the room, fetches Git, reads staged binary payload chunks,
 * or mutates the journal. The caller may safely use it while a session is frozen.
 */
export function previewLocalRecovery(
  db: ProjectdDatabase,
  descriptor: BackgroundSessionIntent,
  options: LocalRecoveryPreviewOptions = {},
): ProjectdRecoveryPreviewResult {
  if (!descriptor.roomKeyBase64) throw new Error("The local recovery key is unavailable")
  const roomKey = Buffer.from(descriptor.roomKeyBase64, "base64")
  if (roomKey.length !== 32) throw new Error("The local recovery key is invalid")
  const previousRoomKeys = Object.fromEntries(
    Object.entries(descriptor.previousRoomKeysBase64 ?? {}).map(([version, key]) => [version, Buffer.from(key, "base64")]),
  )
  const keys = {
    sessionId: descriptor.publicSessionId,
    roomKey,
    roomKeyVersion: descriptor.roomKeyVersion,
    previousRoomKeys,
  }

  // These reads are synchronous and occur before any result is exposed, so the
  // preview describes one local journal observation without yielding to writers.
  const snapshot = new LocalReplicaStore(db, keys).load()
  const pending = new OutboundBatchQueue(db, keys).getPendingBatches(descriptor.publicSessionId, false)
  const staged = new PendingBinaryStore(db, keys).list()
  if (!snapshot && pending.length === 0 && staged.length === 0) {
    throw new Error("No local snapshot or pending changes are retained")
  }

  const replica = new SessionReplica(descriptor.publicSessionId, "recovery_preview")
  if (snapshot) replica.restoreSnapshot(snapshot.replica)
  for (const queued of pending) replica.applyBatch(queued.batch)

  const conflicts = replica.detectConflicts()
  const conflictKinds = new Map<string, Set<ProjectdRecoveryConflictKind>>()
  const mark = (fileId: string, kind: ProjectdRecoveryConflictKind) => {
    const kinds = conflictKinds.get(fileId) ?? new Set<ProjectdRecoveryConflictKind>()
    kinds.add(kind)
    conflictKinds.set(fileId, kinds)
  }
  for (const conflict of conflicts.pathCollisions) for (const fileId of conflict.fileIds) mark(fileId, "path_collision")
  for (const conflict of conflicts.concurrentRenames) mark(conflict.fileId, "concurrent_rename")
  for (const conflict of conflicts.deleteModifyConflicts) mark(conflict.fileId, "delete_modify")

  // File identity, not path, determines whether a staged binary belongs to an
  // existing replica entry. A deleted file and a new file may legitimately reuse
  // the same path and must remain distinct in recovery inspection.
  const stagedByFileId = new Map<string, PendingBinaryRecord[]>()
  const unmatchedStaged = new Map<string, PendingBinaryRecord>()
  for (const record of staged) {
    unmatchedStaged.set(record.revisionId, record)
    if (!record.fileId) continue
    const records = stagedByFileId.get(record.fileId) ?? []
    records.push(record)
    stagedByFileId.set(record.fileId, records)
  }

  let binaryConflicts = 0
  const entries: ProjectdRecoveryPreviewEntry[] = replica.tree.listAllEntries().map((entry) => {
    const stagedForEntry = stagedByFileId.get(entry.fileId) ?? []
    for (const record of stagedForEntry) unmatchedStaged.delete(record.revisionId)
    let size: number | null = null
    let textPreview: string | null = null
    let textTruncated = false
    let symlinkTarget: string | null = null
    let symlinkTargetTruncated = false
    let revisionCount = 0

    if (entry.kind === "text") {
      const text = replica.textDocs.has(entry.fileId) ? replica.textDocs.getTextContent(entry.fileId) : ""
      const preview = boundedUtf8(text, MAX_TEXT_PREVIEW_BYTES)
      size = Buffer.byteLength(text, "utf8")
      textPreview = preview.value
      textTruncated = preview.truncated
    } else if (entry.kind === "binary") {
      const revisions = replica.binaryStore.getRevisions(entry.fileId)
      const head = replica.binaryStore.getHeadRevision(entry.fileId)
      revisionCount = revisions.length
      size = head?.size ?? null
      if (replica.binaryStore.detectConcurrentRevisions(entry.fileId)) {
        mark(entry.fileId, "binary_concurrent_revision")
        binaryConflicts++
      }
    } else {
      const target = entry.symlinkTarget ?? ""
      const preview = boundedUtf8(target, MAX_SYMLINK_PREVIEW_BYTES)
      size = Buffer.byteLength(target, "utf8")
      symlinkTarget = preview.value
      symlinkTargetTruncated = preview.truncated
    }

    return {
      cursor: `file:${entry.fileId}`,
      fileId: entry.fileId,
      path: entry.path,
      kind: entry.kind,
      mode: entry.mode,
      deleted: entry.deleted,
      size,
      textPreview,
      textTruncated,
      symlinkTarget,
      symlinkTargetTruncated,
      revisionCount,
      pendingBinaryVersions: stagedForEntry.length,
      conflictKinds: [...(conflictKinds.get(entry.fileId) ?? [])].sort(),
    }
  })

  const unmatchedGroups = new Map<string, PendingBinaryRecord[]>()
  for (const record of unmatchedStaged.values()) {
    const identity = record.fileId ? `file:${record.fileId}` : `path:${record.path}`
    const records = unmatchedGroups.get(identity) ?? []
    records.push(record)
    unmatchedGroups.set(identity, records)
  }
  for (const records of unmatchedGroups.values()) {
    const latest = [...records].sort((a, b) => b.createdAt - a.createdAt || b.revisionId.localeCompare(a.revisionId))[0]!
    entries.push({
      cursor: `pending:${latest.revisionId}`,
      fileId: latest.fileId,
      path: latest.path,
      kind: "binary",
      mode: latest.mode,
      deleted: false,
      size: latest.size,
      textPreview: null,
      textTruncated: false,
      symlinkTarget: null,
      symlinkTargetTruncated: false,
      revisionCount: 0,
      pendingBinaryVersions: records.length,
      conflictKinds: [],
    })
  }

  entries.sort((a, b) => a.path.localeCompare(b.path) || a.cursor.localeCompare(b.cursor))
  const limit = Number.isFinite(options.limit)
    ? Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(options.limit!)))
    : DEFAULT_PAGE_SIZE
  let start = 0
  if (options.afterCursor) {
    const index = entries.findIndex((entry) => entry.cursor === options.afterCursor)
    if (index < 0) throw new Error("The recovery preview changed. Refresh it before continuing.")
    start = index + 1
  }
  const page = entries.slice(start, start + limit)
  const nextCursor = start + page.length < entries.length && page.length > 0 ? page[page.length - 1]!.cursor : null

  return {
    publicSessionId: descriptor.publicSessionId,
    snapshotSequence: snapshot?.sequence ?? null,
    pendingBatches: pending.length,
    pendingBinaryVersions: staged.length,
    totalEntries: entries.length,
    entries: page,
    nextCursor,
    conflicts: {
      pathCollisions: conflicts.pathCollisions.length,
      concurrentRenames: conflicts.concurrentRenames.length,
      deleteModify: conflicts.deleteModifyConflicts.length,
      binary: binaryConflicts,
    },
  }
}

function boundedUtf8(value: string, maxBytes: number): { value: string; truncated: boolean } {
  const bytes = Buffer.from(value, "utf8")
  if (bytes.length <= maxBytes) return { value, truncated: false }
  let preview = bytes.subarray(0, maxBytes).toString("utf8")
  if (preview.endsWith("\uFFFD")) preview = preview.slice(0, -1)
  return { value: preview, truncated: true }
}
