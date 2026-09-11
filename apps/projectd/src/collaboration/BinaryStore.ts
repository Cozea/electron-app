/**
 * Binary revision ledger and concurrent conflict detection.
 *
 * Master Specification: Section 11.2 - 11.3
 * Invariants:
 * - Append-only revisions (no single LWW pointer erasing alternatives).
 * - Concurrent binary updates create explicit conflict state while preserving both alternatives.
 */

import type { ChangeActor } from "./TreeDoc"

export interface BinaryRevision {
  revisionId: string
  fileId: string
  baseRevisionId: string | null
  contentHash: string
  encryptedManifestRef: string
  size: number
  actor: ChangeActor
  createdAt: number
}

export interface BinaryConflict {
  kind: "binary_concurrent_revision"
  fileId: string
  baseRevisionId: string | null
  conflictingRevisions: BinaryRevision[]
}

export class BinaryStore {
  private readonly revisionsByFile = new Map<string, BinaryRevision[]>()

  addRevision(rev: BinaryRevision): void {
    const list = this.revisionsByFile.get(rev.fileId) ?? []
    list.push(rev)
    // Sort by createdAt
    list.sort((a, b) => a.createdAt - b.createdAt)
    this.revisionsByFile.set(rev.fileId, list)
  }

  getRevisions(fileId: string): BinaryRevision[] {
    return this.revisionsByFile.get(fileId) ?? []
  }

  getHeadRevision(fileId: string): BinaryRevision | null {
    const list = this.getRevisions(fileId)
    return list.length > 0 ? list[list.length - 1] : null
  }

  /**
   * Section 11.3: Detect concurrent binary updates sharing the same base revision.
   */
  detectConcurrentRevisions(fileId: string): BinaryConflict | null {
    const list = this.getRevisions(fileId)
    if (list.length < 2) return null

    const byBase = new Map<string, BinaryRevision[]>()
    for (const rev of list) {
      const baseKey = rev.baseRevisionId ?? "root"
      const group = byBase.get(baseKey) ?? []
      group.push(rev)
      byBase.set(baseKey, group)
    }

    for (const [baseKey, group] of byBase.entries()) {
      if (group.length > 1) {
        // Distinct revisions branched off the same base
        const distinctHashes = new Set(group.map((r) => r.contentHash))
        if (distinctHashes.size > 1) {
          return {
            kind: "binary_concurrent_revision",
            fileId,
            baseRevisionId: baseKey === "root" ? null : baseKey,
            conflictingRevisions: group,
          }
        }
      }
    }

    return null
  }
}
