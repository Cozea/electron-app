/**
 * Binary revision ledger and concurrent conflict detection.
 *
 * Master Specification: Section 11.2 - 11.3
 * Invariants:
 * - Append-only revisions (no single LWW pointer erasing alternatives).
 * - Concurrent binary updates create explicit conflict state while preserving both alternatives.
 */

import type { ChangeActor } from "./TreeDoc"
import type { BinaryManifest } from "./BinaryContentCache"

export interface BinaryRevision {
  revisionId: string
  fileId: string
  baseRevisionId: string | null
  /** Reviewed alternatives superseded together by an explicit resolution. */
  resolvedRevisionIds?: string[]
  contentHash: string
  /**
   * Immutable chunk metadata. The collaboration batch containing this revision is
   * already E2EE; chunk payloads themselves live in the encrypted object store.
   * Older fixture revisions may omit it because they never materialize bytes.
   */
  manifest?: BinaryManifest
  /** Legacy metadata field kept for persisted/test revisions created before manifests were inline. */
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
    if (list.some((existing) => existing.revisionId === rev.revisionId)) return
    list.push(rev)
    // Sort by createdAt
    list.sort((a, b) => a.createdAt - b.createdAt)
    this.revisionsByFile.set(rev.fileId, list)
  }

  getRevisions(fileId: string): BinaryRevision[] {
    return this.revisionsByFile.get(fileId) ?? []
  }

  getHeadRevision(fileId: string): BinaryRevision | null {
    const list = this.getFrontier(fileId)
    return list.length > 0 ? list[list.length - 1] : null
  }

  /** Causal tips, independent of clock ordering and delivery order. */
  getFrontier(fileId: string): BinaryRevision[] {
    const revisions = this.getRevisions(fileId)
    const superseded = new Set<string>()
    for (const revision of revisions) {
      if (revision.baseRevisionId) superseded.add(revision.baseRevisionId)
      for (const parent of revision.resolvedRevisionIds ?? []) superseded.add(parent)
    }
    return revisions.filter((revision) => !superseded.has(revision.revisionId))
      .sort((a, b) => a.revisionId.localeCompare(b.revisionId))
  }

  getRevision(fileId: string, revisionId: string): BinaryRevision | null {
    return this.getRevisions(fileId).find((revision) => revision.revisionId === revisionId) ?? null
  }

  /**
   * Section 11.3: Detect concurrent binary updates sharing the same base revision.
   */
  detectConcurrentRevisions(fileId: string): BinaryConflict | null {
    const list = this.getFrontier(fileId)
    if (list.length < 2) return null
    if (new Set(list.map((revision) => revision.contentHash)).size < 2) return null
    const bases = new Set(list.map((revision) => revision.baseRevisionId))
    return { kind: "binary_concurrent_revision", fileId,
      baseRevisionId: bases.size === 1 ? list[0]!.baseRevisionId : null,
      conflictingRevisions: list }
  }

  /**
   * Resolves a concurrent binary revision conflict by creating a new revision
   * adopting the chosen content while preserving history.
   */
  resolveConflict(
    fileId: string,
    chosenRevisionId: string,
    actor: ChangeActor,
    reviewedRevisionIds: string[] = this.getFrontier(fileId).map((revision) => revision.revisionId),
  ): BinaryRevision {
    const list = this.getRevisions(fileId)
    const chosen = list.find((r) => r.revisionId === chosenRevisionId)
    if (!chosen) {
      throw new Error(`Revision '${chosenRevisionId}' not found for file '${fileId}'`)
    }
    const frontier = this.getFrontier(fileId).map((revision) => revision.revisionId)
    if (!reviewedRevisionIds.includes(chosenRevisionId) || reviewedRevisionIds.length !== frontier.length ||
      new Set(reviewedRevisionIds).size !== frontier.length || reviewedRevisionIds.some((id) => !frontier.includes(id))) {
      throw new Error("The binary conflict changed. Review its current versions before resolving.")
    }

    const resolved: BinaryRevision = {
      revisionId: `rev_res_${crypto.randomUUID().slice(0, 8)}`,
      fileId,
      baseRevisionId: chosen.revisionId,
      resolvedRevisionIds: [...reviewedRevisionIds].sort(),
      contentHash: chosen.contentHash,
      manifest: chosen.manifest,
      encryptedManifestRef: chosen.encryptedManifestRef,
      size: chosen.size,
      actor,
      createdAt: Date.now(),
    }

    this.addRevision(resolved)
    return resolved
  }
}
