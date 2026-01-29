import * as Y from 'yjs'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * YConvexProvider - Syncs Y.Doc updates via Convex real-time subscriptions.
 *
 * When the local doc changes, broadcasts the update to Convex.
 * When Convex query returns new updates, applies them to the local doc.
 */
export class YConvexProvider {
  private doc: Y.Doc
  private projectId: Id<"projects">
  private clientId: string
  private convex: ConvexReactClient
  private connected = false

  constructor(doc: Y.Doc, projectId: Id<"projects">, convex: ConvexReactClient) {
    this.doc = doc
    this.projectId = projectId
    this.clientId = doc.clientID.toString()
    this.convex = convex
    this.connected = true

    // Listen for local updates and broadcast them
    doc.on('update', this.handleLocalUpdate)
  }

  /**
   * Handle local document updates and broadcast to Convex.
   * Skip updates that came from remote sources to avoid loops.
   */
  private handleLocalUpdate = (update: Uint8Array, origin: unknown) => {
    // Don't re-broadcast updates we received from remote
    if (origin === 'remote' || !this.connected) return

    // Convert Uint8Array to a clean ArrayBuffer for Convex v.bytes()
    // (avoid `SharedArrayBuffer` typing issues).
    const arrayBuffer = new ArrayBuffer(update.byteLength)
    new Uint8Array(arrayBuffer).set(update)

    // Broadcast the update to Convex
    this.convex.mutation(api.yjs.broadcastUpdate, {
      projectId: this.projectId,
      update: arrayBuffer,
      clientId: this.clientId,
      origin: typeof origin === 'string' ? origin : 'user',
    })
  }

  /**
   * Apply updates received from Convex subscription.
   * Called by the React context when new updates arrive.
   */
  applyRemoteUpdates(updates: Array<{ update: ArrayBuffer; clientId: string }>) {
    for (const u of updates) {
      // Skip our own updates to avoid duplicate application
      if (u.clientId !== this.clientId) {
        Y.applyUpdate(this.doc, new Uint8Array(u.update), 'remote')
      }
    }
  }

  /**
   * Apply a snapshot to initialize the document.
   * Used when joining an existing collaborative session.
   */
  applySnapshot(snapshot: ArrayBuffer) {
    Y.applyUpdate(this.doc, new Uint8Array(snapshot), 'remote')
  }

  /**
   * Get the current document state as a snapshot for persistence.
   */
  getSnapshot(): Uint8Array {
    return Y.encodeStateAsUpdate(this.doc)
  }

  /**
   * Clean up event listeners when done.
   */
  destroy() {
    this.connected = false
    this.doc.off('update', this.handleLocalUpdate)
  }
}
