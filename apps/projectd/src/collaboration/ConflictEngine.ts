/**
 * Conflict detection and path collision reducer.
 *
 * Master Specification: Section 10.6, 10.7, 10.18, 11.3
 * Invariants:
 * - C18: Project tree conflicts never silently overwrite.
 */

import type { ProjectEntryRecord, StructuralOp } from "./TreeDoc"

export interface PathCollision {
  readonly kind: "path_collision"
  readonly normalizedPath: string
  readonly fileIds: string[]
  readonly entries: ProjectEntryRecord[]
}

export interface ConcurrentRenameConflict {
  readonly kind: "concurrent_rename"
  readonly fileId: string
  readonly baseStructuralOpId: string | null
  readonly ops: StructuralOp[]
}

export interface DeleteModifyConflict {
  readonly kind: "delete_modify"
  readonly fileId: string
  readonly path: string
  readonly deleteOp: StructuralOp
}

export class ConflictEngine {
  static normalizeForVolumeComparison(p: string): string {
    return p.toLowerCase().replace(/\\/g, "/").replace(/^\.\//, "").replace(/\/+$/, "")
  }

  /**
   * Section 10.6: Path uniqueness reducer.
   * Enumerates live entries and detects if multiple distinct fileIds claim the same path.
   */
  static reducePathCollisions(entries: ProjectEntryRecord[]): PathCollision[] {
    const liveEntries = entries.filter((e) => !e.deleted)
    const byNormalizedPath = new Map<string, ProjectEntryRecord[]>()

    for (const entry of liveEntries) {
      const norm = this.normalizeForVolumeComparison(entry.path)
      const list = byNormalizedPath.get(norm) ?? []
      list.push(entry)
      byNormalizedPath.set(norm, list)
    }

    const collisions: PathCollision[] = []
    for (const [norm, group] of byNormalizedPath.entries()) {
      if (group.length > 1) {
        collisions.push({
          kind: "path_collision",
          normalizedPath: norm,
          fileIds: group.map((e) => e.fileId),
          entries: group,
        })
      }
    }

    return collisions
  }

  /**
   * Section 10.7: Concurrent rename detection.
   * Retains competing rename branches, including descendants of the original
   * siblings, until a later rename explicitly supersedes the reviewed alternatives.
   */
  static detectConcurrentRenames(structuralOps: StructuralOp[]): ConcurrentRenameConflict[] {
    const byFile = new Map<string, StructuralOp[]>()
    for (const op of structuralOps) {
      if (op.kind === "rename" || op.kind === "move") {
        const list = byFile.get(op.fileId) ?? []
        list.push(op)
        byFile.set(op.fileId, list)
      }
    }

    const conflicts: ConcurrentRenameConflict[] = []
    const byId = new Map(structuralOps.map((op) => [op.opId, op]))
    for (const [fileId, ops] of byFile.entries()) {
      if (ops.length < 2) continue
      const superseded = new Set<string>()
      const visited = new Set<string>()
      for (const op of ops) {
        const pending = [...(op.resolvedStructuralOpIds ?? []), ...(op.baseStructuralOpId ? [op.baseStructuralOpId] : [])]
        while (pending.length) {
          const id = pending.pop()!
          if (id === op.opId || visited.has(id)) continue
          visited.add(id)
          const parent = byId.get(id)
          if (!parent || parent.fileId !== fileId) continue
          superseded.add(id)
          if (parent.baseStructuralOpId) pending.push(parent.baseStructuralOpId)
          pending.push(...(parent.resolvedStructuralOpIds ?? []))
        }
      }
      const frontier = ops.filter((op) => !superseded.has(op.opId)).sort((a, b) => a.opId.localeCompare(b.opId))
      if (new Set(frontier.map((op) => op.toPath)).size > 1) {
        const bases = new Set(frontier.map((op) => op.baseStructuralOpId ?? null))
        conflicts.push({ kind: "concurrent_rename", fileId, baseStructuralOpId: bases.size === 1 ? frontier[0]!.baseStructuralOpId ?? null : null, ops: frontier })
      }
    }

    return conflicts
  }

  /**
   * Section 10.18: Delete vs concurrent edit detection.
   */
  static detectDeleteModifyConflicts(
    entries: ProjectEntryRecord[],
    structuralOps: StructuralOp[],
    hasConcurrentEdit: (fileId: string, deleteOp: StructuralOp) => boolean,
  ): DeleteModifyConflict[] {
    const conflicts: DeleteModifyConflict[] = []
    const byId = new Map(structuralOps.map((op) => [op.opId, op]))
    const deletedEntries = entries.filter((e) => e.deleted)

    for (const entry of deletedEntries) {
      // The effective entry's ancestry is authoritative; wall clocks cannot select
      // an older delete after a collaborator explicitly confirms the current edits.
      let deleteOp: StructuralOp | undefined
      let current = entry.lastStructuralOpId
      const visited = new Set<string>()
      while (current && !visited.has(current)) {
        visited.add(current)
        const op = byId.get(current)
        if (!op || op.fileId !== entry.fileId) break
        if (op.kind === "delete") { deleteOp = op; break }
        current = op.baseStructuralOpId ?? null
      }

      if (deleteOp && hasConcurrentEdit(entry.fileId, deleteOp)) {
        conflicts.push({
          kind: "delete_modify",
          fileId: entry.fileId,
          path: entry.path,
          deleteOp,
        })
      }
    }

    return conflicts
  }
}
