/**
 * Snapshot-anchored filesystem -> CRDT adapter.
 *
 * Master Specification: Section 10.11 - 10.13
 * Translates external disk file changes (D) into micro-granular Yjs updates
 * anchored on the last materialized baseline snapshot (B/SB), merging cleanly
 * with concurrent remote live CRDT edits (C).
 */

import * as Y from "yjs"

import { BoundedDiff, type BoundedDiffOptions } from "./BoundedDiff"
import type { BaselineStore, TextBaseline } from "./BaselineStore"
import type { SessionReplica } from "./SessionReplica"
import type { ChangeActor } from "./TreeDoc"

export interface ExternalChangeResult {
  readonly fileId: string
  readonly update: Uint8Array
  readonly convergedText: string
  readonly isNoop: boolean
}

export class ExternalSnapshotAdapter {
  readonly replica: SessionReplica
  readonly baselineStore: BaselineStore
  readonly diffEngine: BoundedDiff

  constructor(options: {
    replica: SessionReplica
    baselineStore: BaselineStore
    diffOptions?: BoundedDiffOptions
  }) {
    this.replica = options.replica
    this.baselineStore = options.baselineStore
    this.diffEngine = new BoundedDiff(options.diffOptions)
  }

  /**
   * Initializes or updates a baseline when a file is first materialized to disk or created.
   * Derives exact snapshot update and state vector from the replica's live Y.Doc.
   */
  initializeBaseline(fileId: string, text?: string): TextBaseline {
    const content = text ?? this.replica.textDocs.getTextContent(fileId)

    // Ensure live doc has content if text provided
    if (text !== undefined && !this.replica.textDocs.has(fileId)) {
      this.replica.updateTextContent(fileId, text)
    }

    const snapshotUpdate = this.replica.textDocs.encodeStateAsUpdate(fileId)
    const stateVector = this.replica.textDocs.getStateVector(fileId)

    return this.baselineStore.setBaseline({
      fileId,
      text: content,
      stateVector,
      snapshotUpdate,
    })
  }

  /**
   * Section 10.11: Snapshot-anchored ingress algorithm.
   */
  applyExternalDiskChange(params: {
    fileId: string
    diskText: string
    actor: ChangeActor
  }): ExternalChangeResult {
    const { fileId, diskText, actor } = params
    const baseline = this.baselineStore.getBaseline(fileId)

    // Case 1: No previous baseline recorded (first ingress of this file)
    if (!baseline) {
      this.replica.updateTextContent(fileId, diskText)
      this.initializeBaseline(fileId, diskText)
      const update = this.replica.textDocs.encodeStateAsUpdate(fileId)
      return {
        fileId,
        update,
        convergedText: diskText,
        isNoop: false,
      }
    }

    // Case 2: Disk content matches baseline text exactly -> noop
    if (diskText === baseline.text) {
      return {
        fileId,
        update: new Uint8Array(0),
        convergedText: this.replica.textDocs.getTextContent(fileId),
        isNoop: true,
      }
    }

    // Step 2 & 3: Instantiate shadow Y.Doc and apply baseline snapshot SB
    const shadowDoc = new Y.Doc({ guid: `shadow:${fileId}` })
    Y.applyUpdate(shadowDoc, baseline.snapshotUpdate)
    const shadowText = shadowDoc.getText("content")

    // Step 4: Verify shadow text equals stored baseline B
    const shadowInitial = shadowText.toString()
    if (shadowInitial !== baseline.text) {
      // Lengths only: file contents never go to logs.
      console.warn(
        `[ExternalSnapshotAdapter] Baseline mismatch for ${fileId} (shadow ${shadowInitial.length} chars, baseline ${baseline.text.length} chars). Resetting shadow.`,
      )
      shadowDoc.transact(() => {
        shadowText.delete(0, shadowText.length)
        shadowText.insert(0, baseline.text)
      })
    }

    // Step 5: Compute minimal text diff B -> D using BoundedDiff
    const diffs = this.diffEngine.computeDiff(baseline.text, diskText)

    // Step 6: Apply diff operations to shadow Y.Text in one local transaction
    shadowDoc.transact(() => {
      let index = 0
      for (const op of diffs) {
        if (op.op === "equal") {
          index += op.text.length
        } else if (op.op === "delete") {
          shadowText.delete(index, op.text.length)
        } else if (op.op === "insert") {
          shadowText.insert(index, op.text)
          index += op.text.length
        }
      }
    }, actor)

    // Step 7: Encode only Yjs update generated after baseline state vector
    const deltaUpdate = Y.encodeStateAsUpdate(shadowDoc, baseline.stateVector)

    // Step 8: Apply generated delta to live text doc C
    this.replica.textDocs.applyUpdate(fileId, deltaUpdate)

    // Step 9: Update baseline store to newly stable D
    this.baselineStore.setBaseline({
      fileId,
      text: diskText,
      stateVector: Y.encodeStateVector(shadowDoc),
      snapshotUpdate: Y.encodeStateAsUpdate(shadowDoc),
    })

    shadowDoc.destroy()

    return {
      fileId,
      update: deltaUpdate,
      convergedText: this.replica.textDocs.getTextContent(fileId),
      isNoop: false,
    }
  }
}
