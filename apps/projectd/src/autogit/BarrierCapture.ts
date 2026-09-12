/**
 * Barrier capture and logical tree hash computation.
 *
 * Master Specification: Section 15.3 - 15.5
 * Invariants:
 * - C21: AutoGit uses immutable CRDT barriers, never commits live mutable disk directly.
 */

import { createHash } from "node:crypto"

import type { BinaryRevision } from "../collaboration/BinaryStore"
import type { SessionReplica, ReplicaSnapshot } from "../collaboration/SessionReplica"

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
  readonly snapshotUpdate?: Uint8Array
  readonly stateVector?: Uint8Array
  readonly binaryRevision?: BinaryRevision
}

export interface BarrierSnapshot {
  readonly replicaSnapshot?: ReplicaSnapshot
  readonly barrierId: string
  readonly sessionSeq: number
  readonly serverTime: number
  readonly logicalTreeHash: string
  readonly files: FileSnapshotState[]
  /** Paths the session deleted and nothing took over since; a checkpoint removes them. */
  readonly deletedPaths?: string[]
}

/** Orders by UTF-16 code unit, which is the same on every machine; localeCompare is not. */
function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0
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
    liveEntries.sort((a, b) => compareCodeUnits(a.path, b.path))

    const files: FileSnapshotState[] = []
    const hashDigest = createHash("sha256")

    for (const entry of liveEntries) {
      let contentHash = ""
      let textContent: string | undefined
      let symlinkTarget: string | undefined
      let snapshotUpdate: Uint8Array | undefined
      let stateVector: Uint8Array | undefined
      let binaryRevision: BinaryRevision | undefined

      if (entry.kind === "text") {
        textContent = replica.textDocs.getTextContent(entry.fileId)
        contentHash = createHash("sha256").update(textContent).digest("hex")
        snapshotUpdate = replica.textDocs.encodeStateAsUpdate(entry.fileId)
        stateVector = replica.textDocs.getStateVector(entry.fileId)
      } else if (entry.kind === "symlink") {
        symlinkTarget = entry.symlinkTarget ?? ""
        contentHash = createHash("sha256").update(symlinkTarget).digest("hex")
      } else if (entry.kind === "binary") {
        const headRev = replica.binaryStore.getHeadRevision(entry.fileId)
        binaryRevision = headRev ?? undefined
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
        snapshotUpdate,
        stateVector,
        binaryRevision,
      })

      hashDigest.update(`${entry.path}:${entry.mode}:${contentHash}\n`)
    }

    const livePaths = new Set(liveEntries.map((entry) => entry.path))
    const deletedPaths = [
      ...new Set(
        replica.tree
          .listAllEntries()
          .filter((entry) => entry.deleted && !livePaths.has(entry.path))
          .map((entry) => entry.path),
      ),
    ].sort(compareCodeUnits)

    const logicalTreeHash = hashDigest.digest("hex")

    return {
      barrierId: barrier.barrierId,
      sessionSeq: barrier.sessionSeq,
      serverTime: barrier.serverTime,
      logicalTreeHash,
      files,
      deletedPaths,
    }
  }
}
