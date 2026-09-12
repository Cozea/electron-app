/**
 * Tree document CRDT and stable structural operation history.
 *
 * Master Specification: Section 10.2 - 10.7, 10.17 - 10.21
 * Invariants:
 * - C17: Tree identity is stable. File identity survives rename/move. Path is a property, not identity.
 * - C18: Project tree conflicts never silently overwrite.
 */

import * as Y from "yjs"

import { normalizeProjectPath } from "./projectPath"
import { ConflictEngine } from "./ConflictEngine"

export type EntryKind = "text" | "binary" | "symlink"

export interface ChangeActor {
  actorType: "user" | "agent" | "terminal-human" | "terminal-agent" | "external" | "system"
  principalId?: string
  identityKey?: string
  provider?: string
  terminalId?: string
  commandId?: string
  runId?: string
  threadId?: string
}

export interface ProjectEntryRecord {
  fileId: string
  kind: EntryKind
  path: string
  mode: number // 0o100644 | 0o100755
  deleted: boolean
  textDocId?: string
  binaryRevisionId?: string
  symlinkTarget?: string
  lastStructuralOpId: string | null
}

export type StructuralOpKind =
  | "create"
  | "rename"
  | "move"
  | "delete"
  | "restore"
  | "chmod"
  | "reclassify"
  | "symlink-target"

export interface StructuralOp {
  opId: string
  sessionId: string
  fileId: string
  kind: StructuralOpKind
  fromPath?: string
  toPath?: string
  newMode?: number
  newKind?: EntryKind
  newSymlinkTarget?: string
  baseStructuralOpId?: string | null
  /** Explicit alternatives superseded by a reviewed structural resolution. */
  resolvedStructuralOpIds?: string[]
  /**
   * On delete ops: the text doc state vector (clientId -> clock) the deleting replica
   * had seen, so a text edit it had not seen reads as a delete/modify conflict (10.18).
   */
  textStateVector?: Record<string, number>
  binaryRevisionIds?: string[]
  actor: ChangeActor
  createdAt: number
}

export function generateFileId(): string {
  const ts = Date.now().toString(36)
  const rand = crypto.randomUUID().replace(/-/g, "").slice(0, 12)
  return `file_${ts}_${rand}`
}

export function generateOpId(): string {
  return `op_${crypto.randomUUID().replace(/-/g, "")}`
}

export class TreeDoc {
  readonly sessionId: string
  readonly doc: Y.Doc
  readonly entries: Y.Map<ProjectEntryRecord>
  readonly structuralOps: Y.Map<StructuralOp>

  constructor(sessionId: string, doc?: Y.Doc) {
    this.sessionId = sessionId
    this.doc = doc ?? new Y.Doc({ guid: `tree:${sessionId}` })
    this.entries = this.doc.getMap<ProjectEntryRecord>("entries")
    this.structuralOps = this.doc.getMap<StructuralOp>("structuralOps")
  }

  /** Throws InvalidProjectPathError for paths that could escape the project. */
  normalizePath(p: string): string {
    return normalizeProjectPath(p)
  }

  getEntry(fileId: string): ProjectEntryRecord | null {
    return this.entries.get(fileId) ?? null
  }

  listAllEntries(): ProjectEntryRecord[] {
    const list: ProjectEntryRecord[] = []
    this.entries.forEach((record) => {
      list.push({ ...record })
    })
    return list
  }

  listLiveEntries(): ProjectEntryRecord[] {
    return this.listAllEntries().filter((e) => !e.deleted)
  }

  listStructuralOps(): StructuralOp[] {
    const list: StructuralOp[] = []
    this.structuralOps.forEach((op) => {
      list.push({ ...op })
    })
    return list.sort((a, b) => a.createdAt - b.createdAt)
  }

  createEntry(params: {
    path: string
    kind: EntryKind
    fileId?: string
    mode?: number
    symlinkTarget?: string
    actor: ChangeActor
  }): ProjectEntryRecord {
    const fileId = params.fileId ?? generateFileId()
    const opId = generateOpId()
    const normPath = this.normalizePath(params.path)
    const now = Date.now()

    const op: StructuralOp = {
      opId,
      sessionId: this.sessionId,
      fileId,
      kind: "create",
      toPath: normPath,
      newKind: params.kind,
      newMode: params.mode ?? 0o100644,
      newSymlinkTarget: params.symlinkTarget,
      baseStructuralOpId: null,
      actor: params.actor,
      createdAt: now,
    }

    const record: ProjectEntryRecord = {
      fileId,
      kind: params.kind,
      path: normPath,
      mode: params.mode ?? 0o100644,
      deleted: false,
      textDocId: params.kind === "text" ? `text:${fileId}` : undefined,
      symlinkTarget: params.symlinkTarget,
      lastStructuralOpId: opId,
    }

    this.doc.transact(() => {
      this.structuralOps.set(opId, op)
      this.entries.set(fileId, record)
    })

    return record
  }

  resolveRenames(fileId: string, newPath: string, reviewedOpIds: string[], actor: ChangeActor): ProjectEntryRecord {
    const conflict = ConflictEngine.detectConcurrentRenames(this.listStructuralOps()).find((item) => item.fileId === fileId)
    const ids = conflict?.ops.map((op) => op.opId) ?? []
    if (!ids.length || reviewedOpIds.length !== ids.length || new Set(reviewedOpIds).size !== ids.length || reviewedOpIds.some((id) => !ids.includes(id))) {
      throw new Error("The rename conflict changed. Review its current paths before resolving.")
    }
    return this.renameEntry(fileId, newPath, actor, reviewedOpIds)
  }

  renameEntry(fileId: string, newPath: string, actor: ChangeActor, resolvedOpIds?: string[]): ProjectEntryRecord {
    const existing = this.getEntry(fileId)
    if (!existing) {
      throw new Error(`Cannot rename non-existent entry '${fileId}'`)
    }

    const normPath = this.normalizePath(newPath)
    if (existing.path === normPath && !resolvedOpIds?.length) {
      return existing
    }

    const opId = generateOpId()
    const now = Date.now()

    const op: StructuralOp = {
      opId,
      sessionId: this.sessionId,
      fileId,
      kind: "rename",
      resolvedStructuralOpIds: resolvedOpIds ? [...resolvedOpIds].sort() : undefined,
      fromPath: existing.path,
      toPath: normPath,
      baseStructuralOpId: existing.lastStructuralOpId,
      actor,
      createdAt: now,
    }

    const updated: ProjectEntryRecord = {
      ...existing,
      path: normPath,
      lastStructuralOpId: opId,
    }

    this.doc.transact(() => {
      this.structuralOps.set(opId, op)
      this.entries.set(fileId, updated)
    })

    return updated
  }

  deleteEntry(
    fileId: string,
    actor: ChangeActor,
    textStateVector?: Record<string, number>,
    binaryRevisionIds?: string[],
    confirmDeleted = false,
  ): ProjectEntryRecord {
    const existing = this.getEntry(fileId)
    if (!existing) {
      throw new Error(`Cannot delete non-existent entry '${fileId}'`)
    }

    if (existing.deleted && !confirmDeleted) {
      return existing
    }

    const opId = generateOpId()
    const now = Date.now()

    const op: StructuralOp = {
      opId,
      sessionId: this.sessionId,
      fileId,
      kind: "delete",
      fromPath: existing.path,
      baseStructuralOpId: existing.lastStructuralOpId,
      textStateVector,
      binaryRevisionIds,
      actor,
      createdAt: now,
    }

    const tombstoned: ProjectEntryRecord = {
      ...existing,
      deleted: true,
      lastStructuralOpId: opId,
    }

    this.doc.transact(() => {
      this.structuralOps.set(opId, op)
      this.entries.set(fileId, tombstoned)
    })

    return tombstoned
  }

  restoreEntry(fileId: string, actor: ChangeActor): ProjectEntryRecord {
    const existing = this.getEntry(fileId)
    if (!existing) {
      throw new Error(`Cannot restore non-existent entry '${fileId}'`)
    }

    if (!existing.deleted) {
      return existing
    }

    const opId = generateOpId()
    const now = Date.now()

    const op: StructuralOp = {
      opId,
      sessionId: this.sessionId,
      fileId,
      kind: "restore",
      toPath: existing.path,
      baseStructuralOpId: existing.lastStructuralOpId,
      actor,
      createdAt: now,
    }

    const restored: ProjectEntryRecord = {
      ...existing,
      deleted: false,
      lastStructuralOpId: opId,
    }

    this.doc.transact(() => {
      this.structuralOps.set(opId, op)
      this.entries.set(fileId, restored)
    })

    return restored
  }

  chmodEntry(fileId: string, newMode: number, actor: ChangeActor): ProjectEntryRecord {
    const existing = this.getEntry(fileId)
    if (!existing) {
      throw new Error(`Cannot chmod non-existent entry '${fileId}'`)
    }

    if (existing.mode === newMode) {
      return existing
    }

    const opId = generateOpId()
    const now = Date.now()

    const op: StructuralOp = {
      opId,
      sessionId: this.sessionId,
      fileId,
      kind: "chmod",
      newMode,
      baseStructuralOpId: existing.lastStructuralOpId,
      actor,
      createdAt: now,
    }

    const updated: ProjectEntryRecord = {
      ...existing,
      mode: newMode,
      lastStructuralOpId: opId,
    }

    this.doc.transact(() => {
      this.structuralOps.set(opId, op)
      this.entries.set(fileId, updated)
    })

    return updated
  }

  reclassifyEntry(fileId: string, newKind: EntryKind, actor: ChangeActor): ProjectEntryRecord {
    const existing = this.getEntry(fileId)
    if (!existing) {
      throw new Error(`Cannot reclassify non-existent entry '${fileId}'`)
    }

    if (existing.kind === newKind) {
      return existing
    }

    const opId = generateOpId()
    const now = Date.now()

    const op: StructuralOp = {
      opId,
      sessionId: this.sessionId,
      fileId,
      kind: "reclassify",
      newKind,
      baseStructuralOpId: existing.lastStructuralOpId,
      actor,
      createdAt: now,
    }

    const updated: ProjectEntryRecord = {
      ...existing,
      kind: newKind,
      textDocId: newKind === "text" ? `text:${fileId}` : undefined,
      binaryRevisionId: newKind === "binary" ? existing.binaryRevisionId : undefined,
      lastStructuralOpId: opId,
    }

    this.doc.transact(() => {
      this.structuralOps.set(opId, op)
      this.entries.set(fileId, updated)
    })

    return updated
  }

  setSymlinkTarget(fileId: string, target: string, actor: ChangeActor): ProjectEntryRecord {
    const existing = this.getEntry(fileId)
    if (!existing) {
      throw new Error(`Cannot set symlink target on non-existent entry '${fileId}'`)
    }

    const opId = generateOpId()
    const now = Date.now()

    const op: StructuralOp = {
      opId,
      sessionId: this.sessionId,
      fileId,
      kind: "symlink-target",
      newSymlinkTarget: target,
      baseStructuralOpId: existing.lastStructuralOpId,
      actor,
      createdAt: now,
    }

    const updated: ProjectEntryRecord = {
      ...existing,
      kind: "symlink",
      symlinkTarget: target,
      lastStructuralOpId: opId,
    }

    this.doc.transact(() => {
      this.structuralOps.set(opId, op)
      this.entries.set(fileId, updated)
    })

    return updated
  }

  /**
   * Atomic directory rename (Section 10.19).
   * Moves all affected paths in a single atomic Yjs transaction. All file IDs remain stable.
   */
  renameDirectory(fromDir: string, toDir: string, actor: ChangeActor): ProjectEntryRecord[] {
    const normFrom = this.normalizePath(fromDir) + "/"
    const normTo = this.normalizePath(toDir) + "/"
    const affected = this.listLiveEntries().filter(
      (e) => e.path === this.normalizePath(fromDir) || e.path.startsWith(normFrom),
    )

    const updatedRecords: ProjectEntryRecord[] = []
    const now = Date.now()

    this.doc.transact(() => {
      for (const entry of affected) {
        const relativeSuffix = entry.path.startsWith(normFrom)
          ? entry.path.slice(normFrom.length)
          : ""
        const destination = normTo + relativeSuffix

        const opId = generateOpId()
        const op: StructuralOp = {
          opId,
          sessionId: this.sessionId,
          fileId: entry.fileId,
          kind: "move",
          fromPath: entry.path,
          toPath: destination,
          baseStructuralOpId: entry.lastStructuralOpId,
          actor,
          createdAt: now,
        }

        const updated: ProjectEntryRecord = {
          ...entry,
          path: destination,
          lastStructuralOpId: opId,
        }

        this.structuralOps.set(opId, op)
        this.entries.set(entry.fileId, updated)
        updatedRecords.push(updated)
      }
    })

    return updatedRecords
  }
}
