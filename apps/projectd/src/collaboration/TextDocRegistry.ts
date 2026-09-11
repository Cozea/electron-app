/**
 * Text document registry and sticky classification.
 *
 * Master Specification: Section 10.8 - 10.10
 * - Multiplexed per-file Y.Doc: docId = "text:<fileId>"
 * - Classification: under 8 MiB, valid UTF-8, no NUL bytes.
 * - Sticky classification: text remains text unless explicitly reclassified.
 */

import * as Y from "yjs"

export const MAX_TEXT_CRDT_BYTES = 8 * 1024 * 1024 // 8 MiB initial safety limit

/** Called after every change to a text doc, with the transaction origin. */
export type TextDocUpdateListener = (fileId: string, origin: unknown) => void

export class TextDocRegistry {
  private readonly docs = new Map<string, Y.Doc>()
  private readonly updateListeners = new Set<TextDocUpdateListener>()

  onUpdate(listener: TextDocUpdateListener): () => void {
    this.updateListeners.add(listener)
    return () => {
      this.updateListeners.delete(listener)
    }
  }

  getOrCreate(fileId: string): { doc: Y.Doc; text: Y.Text } {
    let doc = this.docs.get(fileId)
    if (!doc) {
      doc = new Y.Doc({ guid: `text:${fileId}` })
      doc.on("update", (_update: Uint8Array, origin: unknown) => {
        for (const listener of this.updateListeners) listener(fileId, origin)
      })
      this.docs.set(fileId, doc)
    }
    const text = doc.getText("content")
    return { doc, text }
  }

  get(fileId: string): Y.Doc | null {
    return this.docs.get(fileId) ?? null
  }

  has(fileId: string): boolean {
    return this.docs.has(fileId)
  }

  getTextContent(fileId: string): string {
    const entry = this.getOrCreate(fileId)
    return entry.text.toString()
  }

  setTextContent(fileId: string, content: string): void {
    const { doc, text } = this.getOrCreate(fileId)
    doc.transact(() => {
      text.delete(0, text.length)
      text.insert(0, content)
    })
  }

  applyUpdate(fileId: string, update: Uint8Array, origin?: unknown): void {
    const { doc } = this.getOrCreate(fileId)
    Y.applyUpdate(doc, update, origin)
  }

  encodeStateAsUpdate(fileId: string, targetStateVector?: Uint8Array): Uint8Array {
    const { doc } = this.getOrCreate(fileId)
    return Y.encodeStateAsUpdate(doc, targetStateVector)
  }

  getStateVector(fileId: string): Uint8Array {
    const { doc } = this.getOrCreate(fileId)
    return Y.encodeStateVector(doc)
  }

  listFileIds(): string[] {
    return Array.from(this.docs.keys())
  }

  delete(fileId: string): boolean {
    const doc = this.docs.get(fileId)
    if (doc) {
      doc.destroy()
      return this.docs.delete(fileId)
    }
    return false
  }

  /**
   * Section 10.9: Text classification rules.
   * Classify as text if under 8 MiB, valid UTF-8, and contains no NUL byte.
   */
  static classifyContent(
    buffer: Buffer | Uint8Array,
    isGitAttrBinary = false,
  ): "text" | "binary" {
    if (isGitAttrBinary) {
      return "binary"
    }

    if (buffer.length > MAX_TEXT_CRDT_BYTES) {
      return "binary"
    }

    // Check for NUL byte
    for (let i = 0; i < buffer.length; i++) {
      if (buffer[i] === 0) {
        return "binary"
      }
    }

    // Check for valid UTF-8
    try {
      const decoder = new TextDecoder("utf-8", { fatal: true })
      decoder.decode(buffer)
      return "text"
    } catch {
      return "binary"
    }
  }
}
