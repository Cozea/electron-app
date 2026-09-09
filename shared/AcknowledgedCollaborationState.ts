import * as Y from "yjs"

/** The server-ordered document, independent of the editor's optimistic state. */
export class AcknowledgedCollaborationState {
  private readonly document = new Y.Doc({ gc: false })
  private checkpoint: Uint8Array
  private checkpointSequence: number
  private sequence: number
  private readonly pins = new Map<symbol, number>()
  private requestedCompaction: number
  private readonly updates: Array<{ sequence: number; bytes: Uint8Array }> = []

  constructor(checkpoint: Uint8Array, sequence: number) {
    this.checkpoint = checkpoint.slice()
    this.checkpointSequence = sequence
    this.sequence = sequence
    this.requestedCompaction = sequence
    Y.applyUpdate(this.document, checkpoint)
  }

  apply(sequence: number, bytes: Uint8Array): void {
    if (sequence <= this.sequence) return
    if (sequence !== this.sequence + 1) throw new Error("Missing acknowledged collaboration update")
    Y.applyUpdate(this.document, bytes)
    this.updates.push({ sequence, bytes: bytes.slice() })
    this.sequence = sequence
  }

  capture(sequence: number): Uint8Array {
    if (sequence < this.checkpointSequence || sequence > this.sequence) {
      throw new Error("The requested collaboration snapshot is not available")
    }
    if (sequence === this.sequence) return Y.encodeStateAsUpdate(this.document)
    const snapshot = new Y.Doc({ gc: false })
    try {
      Y.applyUpdate(snapshot, this.checkpoint)
      for (const update of this.updates) {
        if (update.sequence > sequence) break
        Y.applyUpdate(snapshot, update.bytes)
      }
      return Y.encodeStateAsUpdate(snapshot)
    } finally {
      snapshot.destroy()
    }
  }

  /** Preserve the earliest state an asynchronous barrier/capture may need. */
  pin(sequence = this.sequence): () => void {
    if (sequence < this.checkpointSequence || sequence > this.sequence) throw new Error("The requested collaboration snapshot is not available")
    const token = Symbol("snapshot-pin")
    this.pins.set(token, sequence)
    return () => {
      if (!this.pins.delete(token)) return
      this.compact(this.requestedCompaction)
    }
  }

  compact(sequence: number): void {
    if (!Number.isSafeInteger(sequence) || sequence < 0 || sequence > this.sequence) throw new Error("Invalid acknowledged compaction sequence")
    this.requestedCompaction = Math.max(this.requestedCompaction, sequence)
    sequence = Math.min(this.requestedCompaction, ...this.pins.values())
    if (sequence <= this.checkpointSequence) return
    this.checkpoint = this.capture(sequence)
    this.checkpointSequence = sequence
    const firstRetained = this.updates.findIndex((entry) => entry.sequence > sequence)
    this.updates.splice(0, firstRetained < 0 ? this.updates.length : firstRetained)
  }

  destroy(): void {
    this.document.destroy()
    this.updates.length = 0
    this.pins.clear()
  }
}
