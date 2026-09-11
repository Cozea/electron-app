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
   * Detects if two operations for the same fileId share the same baseStructuralOpId
   * but specify different destination paths.
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
    for (const [fileId, ops] of byFile.entries()) {
      if (ops.length < 2) continue

      // Group by baseStructuralOpId
      const byBase = new Map<string, StructuralOp[]>()
      for (const op of ops) {
        const baseKey = op.baseStructuralOpId ?? "root"
        const group = byBase.get(baseKey) ?? []
        group.push(op)
        byBase.set(baseKey, group)
      }

      for (const [baseKey, group] of byBase.entries()) {
        // If multiple ops share the same base and have different toPaths
        const destinations = new Set(group.map((o) => o.toPath))
        if (destinations.size > 1) {
          conflicts.push({
            kind: "concurrent_rename",
            fileId,
            baseStructuralOpId: baseKey === "root" ? null : baseKey,
            ops: group,
          })
        }
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
    const deletedEntries = entries.filter((e) => e.deleted)

    for (const entry of deletedEntries) {
      // Find latest delete op for this fileId
      const deleteOp = structuralOps
        .filter((op) => op.fileId === entry.fileId && op.kind === "delete")
        .sort((a, b) => b.createdAt - a.createdAt)[0]

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
