/**
 * Session CRDT replica coordinating tree, text, and binary collaboration.
 *
 * Master Specification: Section 2.10, 10.2 - 10.10, 13.4
 */

import * as Y from "yjs"

import { TreeDoc, type ChangeActor, type EntryKind, type ProjectEntryRecord } from "./TreeDoc"
import { TextDocRegistry } from "./TextDocRegistry"
import { BinaryStore, type BinaryRevision, type BinaryConflict } from "./BinaryStore"
import {
  ConflictEngine,
  type ConcurrentRenameConflict,
  type DeleteModifyConflict,
  type PathCollision,
} from "./ConflictEngine"

export type BatchOperation =
  | { type: "tree-yjs"; update: Uint8Array }
  | { type: "text-yjs"; docId: string; update: Uint8Array }
  | { type: "binary-revision"; revision: BinaryRevision }

export interface CollaborationBatch {
  batchId: string
  sessionId: string
  clientId: string
  operations: BatchOperation[]
  createdAt: number
}

export interface ReplicaSnapshot {
  sessionId: string
  treeUpdate: Uint8Array
  textUpdates: Record<string, Uint8Array>
  timestamp: number
}

export class SessionReplica {
  readonly sessionId: string
  readonly clientId: string
  readonly tree: TreeDoc
  readonly textDocs: TextDocRegistry
  readonly binaryStore: BinaryStore

  private lastTreeStateVector: Uint8Array
  private lastTextStateVectors = new Map<string, Uint8Array>()

  constructor(sessionId: string, clientId?: string) {
    this.sessionId = sessionId
    this.clientId = clientId ?? `client_${crypto.randomUUID().slice(0, 8)}`
    this.tree = new TreeDoc(sessionId)
    this.textDocs = new TextDocRegistry()
    this.binaryStore = new BinaryStore()

    this.lastTreeStateVector = Y.encodeStateVector(this.tree.doc)
  }

  createFile(params: {
    path: string
    kind: EntryKind
    content?: string | Buffer
    mode?: number
    actor: ChangeActor
  }): ProjectEntryRecord {
    const record = this.tree.createEntry({
      path: params.path,
      kind: params.kind,
      mode: params.mode,
      actor: params.actor,
    })

    if (params.kind === "text") {
      const textContent = typeof params.content === "string" ? params.content : params.content?.toString("utf8") ?? ""
      this.textDocs.setTextContent(record.fileId, textContent)
    }

    return record
  }

  renameFile(fileId: string, newPath: string, actor: ChangeActor): ProjectEntryRecord {
    return this.tree.renameEntry(fileId, newPath, actor)
  }

  deleteFile(fileId: string, actor: ChangeActor): ProjectEntryRecord {
    return this.tree.deleteEntry(fileId, actor)
  }

  updateTextContent(fileId: string, content: string): void {
    this.textDocs.setTextContent(fileId, content)
  }

  /**
   * Captures any local uncommitted updates across tree and text docs into an outbound CollaborationBatch.
   */
  exportBatch(): CollaborationBatch | null {
    const operations: BatchOperation[] = []

    // 1. Export TreeDoc delta
    const treeDelta = Y.encodeStateAsUpdate(this.tree.doc, this.lastTreeStateVector)
    if (treeDelta.length > 2) {
      operations.push({
        type: "tree-yjs",
        update: treeDelta,
      })
      this.lastTreeStateVector = Y.encodeStateVector(this.tree.doc)
    }

    // 2. Export TextDoc deltas
    for (const fileId of this.textDocs.listFileIds()) {
      const lastVector = this.lastTextStateVectors.get(fileId)
      const textDelta = this.textDocs.encodeStateAsUpdate(fileId, lastVector)
      if (textDelta.length > 2) {
        operations.push({
          type: "text-yjs",
          docId: fileId,
          update: textDelta,
        })
        this.lastTextStateVectors.set(fileId, this.textDocs.getStateVector(fileId))
      }
    }

    if (operations.length === 0) {
      return null
    }

    return {
      batchId: `batch_${crypto.randomUUID()}`,
      sessionId: this.sessionId,
      clientId: this.clientId,
      operations,
      createdAt: Date.now(),
    }
  }

  /**
   * Applies an inbound remote collaboration batch to this replica.
   */
  applyBatch(batch: CollaborationBatch | null | undefined): void {
    if (!batch || !Array.isArray(batch.operations)) return

    for (const op of batch.operations) {
      switch (op.type) {
        case "tree-yjs":
          Y.applyUpdate(this.tree.doc, op.update)
          break
        case "text-yjs":
          this.textDocs.applyUpdate(op.docId, op.update)
          break
        case "binary-revision":
          this.binaryStore.addRevision(op.revision)
          break
      }
    }

    // Update state vectors
    this.lastTreeStateVector = Y.encodeStateVector(this.tree.doc)
    for (const fileId of this.textDocs.listFileIds()) {
      this.lastTextStateVectors.set(fileId, this.textDocs.getStateVector(fileId))
    }
  }

  captureSnapshot(): ReplicaSnapshot {
    const textUpdates: Record<string, Uint8Array> = {}
    for (const fileId of this.textDocs.listFileIds()) {
      textUpdates[fileId] = this.textDocs.encodeStateAsUpdate(fileId)
    }

    return {
      sessionId: this.sessionId,
      treeUpdate: Y.encodeStateAsUpdate(this.tree.doc),
      textUpdates,
      timestamp: Date.now(),
    }
  }

  restoreSnapshot(snapshot: ReplicaSnapshot): void {
    Y.applyUpdate(this.tree.doc, snapshot.treeUpdate)
    for (const [fileId, update] of Object.entries(snapshot.textUpdates)) {
      this.textDocs.applyUpdate(fileId, update)
    }

    this.lastTreeStateVector = Y.encodeStateVector(this.tree.doc)
    for (const fileId of this.textDocs.listFileIds()) {
      this.lastTextStateVectors.set(fileId, this.textDocs.getStateVector(fileId))
    }
  }

  /**
   * Evaluates all structural conflicts across the current state.
   */
  detectConflicts(): {
    pathCollisions: PathCollision[]
    concurrentRenames: ConcurrentRenameConflict[]
    deleteModifyConflicts: DeleteModifyConflict[]
    binaryConflicts: BinaryConflict[]
  } {
    const liveEntries = this.tree.listLiveEntries()
    const allEntries = this.tree.listAllEntries()
    const structuralOps = this.tree.listStructuralOps()

    const pathCollisions = ConflictEngine.reducePathCollisions(liveEntries)
    const concurrentRenames = ConflictEngine.detectConcurrentRenames(structuralOps)
    const deleteModifyConflicts = ConflictEngine.detectDeleteModifyConflicts(
      allEntries,
      structuralOps,
      (fileId) => {
        // Has text edits if doc exists and text length > 0
        return this.textDocs.has(fileId) && this.textDocs.getTextContent(fileId).length > 0
      },
    )

    const binaryConflicts: BinaryConflict[] = []
    for (const entry of liveEntries) {
      if (entry.kind === "binary") {
        const conf = this.binaryStore.detectConcurrentRevisions(entry.fileId)
        if (conf) {
          binaryConflicts.push(conf)
        }
      }
    }

    return {
      pathCollisions,
      concurrentRenames,
      deleteModifyConflicts,
      binaryConflicts,
    }
  }
}
