/**
 * Barrier capture and logical tree hash computation.
 *
 * Master Specification: Section 15.3 - 15.5
 * Invariants:
 * - C21: AutoGit uses immutable CRDT barriers, never commits live mutable disk directly.
 */

import { createHash } from "node:crypto"

import type { SessionReplica } from "../collaboration/SessionReplica"

export interface BarrierDescriptor {
  readonly barrierId: string
  readonly sessionSeq: number
  readonly serverTime: number
}

export interface FileSnapshotState {
  readonly fileId: string
  readonly path: string
  readonly kind: "text" | "binary" | "symlink"
  readonly mode: number
  readonly contentHash: string
  readonly textContent?: string
  readonly symlinkTarget?: string
}

export interface BarrierSnapshot {
  readonly barrierId: string
  readonly sessionSeq: number
  readonly serverTime: number
  readonly logicalTreeHash: string
  readonly files: FileSnapshotState[]
}

export class BarrierCapture {
  /**
   * Captures the exact immutable project state at barrier sequence N.
   */
  static captureSnapshot(
    barrier: BarrierDescriptor,
    replica: SessionReplica,
  ): BarrierSnapshot {
    const liveEntries = replica.tree.listLiveEntries()
    // Sort deterministically by path
    liveEntries.sort((a, b) => a.path.localeCompare(b.path))

    const files: FileSnapshotState[] = []
    const hashDigest = createHash("sha256")

    for (const entry of liveEntries) {
      let contentHash = ""
      let textContent: string | undefined
      let symlinkTarget: string | undefined

      if (entry.kind === "text") {
        textContent = replica.textDocs.getTextContent(entry.fileId)
        contentHash = createHash("sha256").update(textContent).digest("hex")
      } else if (entry.kind === "symlink") {
        symlinkTarget = entry.symlinkTarget ?? ""
        contentHash = createHash("sha256").update(symlinkTarget).digest("hex")
      } else if (entry.kind === "binary") {
        const headRev = replica.binaryStore.getHeadRevision(entry.fileId)
        contentHash = headRev?.contentHash ?? "empty_binary"
      }

      files.push({
        fileId: entry.fileId,
        path: entry.path,
        kind: entry.kind,
        mode: entry.mode,
        contentHash,
        textContent,
        symlinkTarget,
      })

      hashDigest.update(`${entry.path}:${entry.mode}:${contentHash}\n`)
    }

    const logicalTreeHash = hashDigest.digest("hex")

    return {
      barrierId: barrier.barrierId,
      sessionSeq: barrier.sessionSeq,
      serverTime: barrier.serverTime,
      logicalTreeHash,
      files,
    }
  }
}
