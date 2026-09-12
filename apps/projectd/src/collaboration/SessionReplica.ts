/**
 * Session CRDT replica coordinating tree, text, and binary collaboration.
 *
 * Master Specification: Section 2.10, 10.2 - 10.10, 13.4
 */

import * as Y from "yjs"

import {
  TreeDoc,
  type ChangeActor,
  type EntryKind,
  type ProjectEntryRecord,
  type StructuralOp,
} from "./TreeDoc"
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
  binaryRevisions?: BinaryRevision[]
  timestamp: number
}

/** File IDs whose tree entry, text or binary revision a peer batch changed. */
export type RemoteChangeListener = (fileIds: ReadonlySet<string>) => void

// Marks transactions that apply peer or restored state, as opposed to local edits.
const PEER_ORIGIN = Symbol("cozea-peer-update")

export class SessionReplica {
  readonly sessionId: string
  readonly clientId: string
  readonly tree: TreeDoc
  readonly textDocs: TextDocRegistry
  readonly binaryStore: BinaryStore

  // Export watermarks: per doc, the structs this replica already sent or received
  // from a peer. exportBatch sends what lies beyond them, so they must never cover
  // local edits that have not been exported yet.
  private lastTreeStateVector: Uint8Array
  private lastTextStateVectors = new Map<string, Uint8Array>()
  // Docs with local edits since the last export. A Yjs delta always carries the
  // doc's whole delete set, so a non-empty delta does not mean anything changed.
  private treeDirty = false
  private readonly dirtyTextDocs = new Set<string>()
  private readonly dirtyBinaryRevisions: BinaryRevision[] = []
  private readonly remoteChangeListeners = new Set<RemoteChangeListener>()

  constructor(sessionId: string, clientId?: string) {
    this.sessionId = sessionId
    this.clientId = clientId ?? `client_${crypto.randomUUID().slice(0, 8)}`
    this.tree = new TreeDoc(sessionId)
    this.textDocs = new TextDocRegistry()
    this.binaryStore = new BinaryStore()

    this.lastTreeStateVector = Y.encodeStateVector(this.tree.doc)
    this.tree.doc.on("update", (_update: Uint8Array, origin: unknown) => {
      if (origin !== PEER_ORIGIN) this.treeDirty = true
    })
    this.textDocs.onUpdate((fileId, origin) => {
      if (origin !== PEER_ORIGIN) this.dirtyTextDocs.add(fileId)
    })
  }

  /** Subscribes to changes that peer batches make; returns the unsubscribe function. */
  onRemoteChange(listener: RemoteChangeListener): () => void {
    this.remoteChangeListeners.add(listener)
    return () => {
      this.remoteChangeListeners.delete(listener)
    }
  }

  createFile(params: {
    path: string
    kind: EntryKind
    content?: string | Buffer
    mode?: number
    symlinkTarget?: string
    actor: ChangeActor
  }): ProjectEntryRecord {
    const record = this.tree.createEntry({
      path: params.path,
      kind: params.kind,
      mode: params.mode,
      symlinkTarget: params.symlinkTarget,
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

  deleteFile(fileId: string, actor: ChangeActor, confirmDeleted = false): ProjectEntryRecord {
    const entry = this.tree.getEntry(fileId)
    // Record which text edits this delete had seen (Section 10.18).
    const textStateVector =
      entry?.kind === "text"
        ? this.textDocs.has(fileId)
          ? stateVectorToRecord(this.textDocs.getStateVector(fileId))
          : {}
        : undefined
    const binaryRevisionIds = entry?.kind === "binary" ? this.binaryStore.getRevisions(fileId).map((revision) => revision.revisionId) : undefined
    return this.tree.deleteEntry(fileId, actor, textStateVector, binaryRevisionIds, confirmDeleted)
  }

  updateTextContent(fileId: string, content: string): void {
    this.textDocs.setTextContent(fileId, content)
  }

  /** Adds a locally-created binary revision and marks only its metadata for export. */
  addBinaryRevision(revision: BinaryRevision): void {
    this.binaryStore.addRevision(revision)
    if (!this.dirtyBinaryRevisions.some((pending) => pending.revisionId === revision.revisionId)) {
      this.dirtyBinaryRevisions.push(revision)
    }
  }

  /** Journals resolution metadata through the same batch path as ordinary binary edits. */
  resolveBinaryConflict(fileId: string, chosenRevisionId: string, reviewedRevisionIds: string[], actor: ChangeActor): BinaryRevision {
    const revision = this.binaryStore.resolveConflict(fileId, chosenRevisionId, actor, reviewedRevisionIds)
    this.addBinaryRevision(revision)
    return revision
  }

  /** True while local edits wait for exportBatch. */
  hasUnexportedChanges(): boolean {
    return this.treeDirty || this.dirtyTextDocs.size > 0 || this.dirtyBinaryRevisions.length > 0
  }

  /**
   * Captures any local uncommitted updates across tree and text docs into an outbound CollaborationBatch.
   */
  exportBatch(persist?: (batch: CollaborationBatch) => void): CollaborationBatch | null {
    const operations: BatchOperation[] = []
    let treeVector: Uint8Array | null = null
    const textVectors = new Map<string, Uint8Array>()

    // 1. Export TreeDoc delta
    if (this.treeDirty) {
      operations.push({
        type: "tree-yjs",
        update: Y.encodeStateAsUpdate(this.tree.doc, this.lastTreeStateVector),
      })
      treeVector = Y.encodeStateVector(this.tree.doc)
    }

    // 2. Export TextDoc deltas
    for (const fileId of this.dirtyTextDocs) {
      if (!this.textDocs.has(fileId)) continue
      operations.push({
        type: "text-yjs",
        docId: fileId,
        update: this.textDocs.encodeStateAsUpdate(fileId, this.lastTextStateVectors.get(fileId)),
      })
      textVectors.set(fileId, this.textDocs.getStateVector(fileId))
    }

    // 3. Export binary revision metadata. Payload bytes stay in the encrypted
    // object store and never enter the room's small collaboration batches.
    for (const revision of this.dirtyBinaryRevisions) {
      operations.push({ type: "binary-revision", revision })
    }

    if (operations.length === 0) {
      this.dirtyTextDocs.clear()
      return null
    }

    const batch: CollaborationBatch = {
      batchId: `batch_${crypto.randomUUID()}`,
      sessionId: this.sessionId,
      clientId: this.clientId,
      operations,
      createdAt: Date.now(),
    }
    // The synchronous journal must accept the exact bytes before advancing any
    // export watermark. A failed disk write leaves every delta available again.
    persist?.(batch)
    if (treeVector) {
      this.lastTreeStateVector = treeVector
      this.treeDirty = false
    }
    for (const [fileId, vector] of textVectors) this.lastTextStateVectors.set(fileId, vector)
    this.dirtyTextDocs.clear()
    this.dirtyBinaryRevisions.length = 0
    return batch
  }

  /**
   * Applies an inbound remote collaboration batch to this replica and returns the
   * IDs of the files it changed.
   */
  applyBatch(batch: CollaborationBatch | null | undefined): ReadonlySet<string> {
    const changed = new Set<string>()
    if (!batch || !Array.isArray(batch.operations)) return changed

    const recordEntryChanges: Parameters<Y.Map<ProjectEntryRecord>["observe"]>[0] = (event) => {
      for (const fileId of event.keysChanged) changed.add(fileId)
    }
    this.tree.entries.observe(recordEntryChanges)
    try {
      for (const op of batch.operations) {
        switch (op.type) {
          case "tree-yjs":
            this.lastTreeStateVector = applyPeerUpdate(this.tree.doc, op.update, this.lastTreeStateVector).watermark
            break
          case "text-yjs": {
            const { doc } = this.textDocs.getOrCreate(op.docId)
            const applied = applyPeerUpdate(doc, op.update, this.lastTextStateVectors.get(op.docId))
            this.lastTextStateVectors.set(op.docId, applied.watermark)
            if (applied.changed) changed.add(op.docId)
            break
          }
          case "binary-revision":
            this.binaryStore.addRevision(op.revision)
            changed.add(op.revision.fileId)
            break
        }
      }
    } finally {
      this.tree.entries.unobserve(recordEntryChanges)
    }

    if (changed.size > 0) {
      for (const listener of this.remoteChangeListeners) listener(changed)
    }
    return changed
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
      binaryRevisions: this.tree.listAllEntries().flatMap((entry) => this.binaryStore.getRevisions(entry.fileId)),
      timestamp: Date.now(),
    }
  }

  restoreSnapshot(snapshot: ReplicaSnapshot): void {
    if (snapshot.sessionId !== this.sessionId) throw new Error("Replica snapshot session mismatch")
    Y.applyUpdate(this.tree.doc, snapshot.treeUpdate, PEER_ORIGIN)
    for (const [fileId, update] of Object.entries(snapshot.textUpdates)) {
      this.textDocs.applyUpdate(fileId, update, PEER_ORIGIN)
    }
    for (const revision of snapshot.binaryRevisions ?? []) this.binaryStore.addRevision(revision)

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
      (fileId, deleteOp) => this.hasContentEditsUnseenBy(fileId, deleteOp),
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

  /**
   * True when binary revisions or text clocks include edits the delete had not
   * seen. Older deletes without either basis cannot prove a content conflict.
   */
  private hasContentEditsUnseenBy(fileId: string, deleteOp: StructuralOp): boolean {
    if (deleteOp.binaryRevisionIds) {
      const seen = new Set(deleteOp.binaryRevisionIds)
      return this.binaryStore.getRevisions(fileId).some((revision) => !seen.has(revision.revisionId))
    }
    const seen = deleteOp.textStateVector
    if (!seen || !this.textDocs.has(fileId)) return false

    for (const [client, clock] of Y.decodeStateVector(this.textDocs.getStateVector(fileId))) {
      if (clock > (seen[String(client)] ?? 0)) return true
    }
    return false
  }
}

function stateVectorToRecord(stateVector: Uint8Array): Record<string, number> {
  const record: Record<string, number> = {}
  for (const [client, clock] of Y.decodeStateVector(stateVector)) {
    record[String(client)] = clock
  }
  return record
}

/**
 * Applies a peer update and returns the export watermark advanced by exactly the
 * structs the update integrated. Advancing it to the doc's full state instead would
 * mark local edits that were never exported as sent, and they would never leave.
 * `changed` is true when the update altered the doc, deletions included.
 */
function applyPeerUpdate(
  doc: Y.Doc,
  update: Uint8Array,
  watermark: Uint8Array | undefined,
): { watermark: Uint8Array; changed: boolean } {
  const before = Y.decodeStateVector(Y.encodeStateVector(doc))
  let changed = false
  const markChanged = () => {
    changed = true
  }
  doc.on("update", markChanged)
  try {
    Y.applyUpdate(doc, update, PEER_ORIGIN)
  } finally {
    doc.off("update", markChanged)
  }

  const advanced = watermark ? Y.decodeStateVector(watermark) : new Map<number, number>()
  for (const [client, clock] of Y.decodeStateVector(Y.encodeStateVector(doc))) {
    if (clock > (before.get(client) ?? 0) && clock > (advanced.get(client) ?? 0)) {
      advanced.set(client, clock)
    }
  }
  return { watermark: Y.encodeStateVector(advanced), changed }
}
