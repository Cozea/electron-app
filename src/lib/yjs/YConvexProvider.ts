import * as Y from 'yjs'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import { YjsOfflineQueue } from './OfflineQueue'

/**
 * YConvexProvider - Syncs Y.Doc updates via Convex real-time subscriptions.
 *
 * When the local doc changes, broadcasts the update to Convex.
 * When Convex query returns new updates, applies them to the local doc.
 *
 * Handles offline scenarios by:
 * 1. Detecting network status via browser events
 * 2. Queuing failed mutations to localStorage
 * 3. Retrying queued updates when connection returns
 */
export class YConvexProvider {
  private doc: Y.Doc
  private projectId: Id<"projects">
  private clientId: string
  private convex: ConvexReactClient
  private connected = false
  private offlineQueue: YjsOfflineQueue
  private _isOnline = typeof navigator !== 'undefined' ? navigator.onLine : true

  constructor(doc: Y.Doc, projectId: Id<"projects">, convex: ConvexReactClient) {
    this.doc = doc
    this.projectId = projectId
    this.clientId = doc.clientID.toString()
    this.convex = convex
    this.connected = true
    this.offlineQueue = new YjsOfflineQueue(convex, projectId)

    // Listen for local updates and broadcast them
    doc.on('update', this.handleLocalUpdate)

    // Track online/offline status
    if (typeof window !== 'undefined') {
      window.addEventListener('online', this.handleOnline)
      window.addEventListener('offline', this.handleOffline)
    }

    // Process any pending updates from previous session
    if (this._isOnline) {
      this.offlineQueue.processQueue()
    }
  }

  private handleOnline = () => {
    console.log('[YConvexProvider] Network online, processing queue...')
    this._isOnline = true
    this.offlineQueue.processQueue()
  }

  private handleOffline = () => {
    console.log('[YConvexProvider] Network offline')
    this._isOnline = false
  }

  /**
   * Handle local document updates and broadcast to Convex.
   * Skip updates that came from remote sources to avoid loops.
   * Queue updates if network is down or mutation fails.
   */
  private handleLocalUpdate = async (update: Uint8Array, origin: unknown) => {
    // Don't re-broadcast updates we received from remote
    if (
      origin === 'remote' ||
      origin === 'sync' ||
      origin === 'snapshot' ||
      origin === 'state-vector' ||
      !this.connected
    ) {
      return
    }

    const originStr = typeof origin === 'string' ? origin : 'user'

    // If offline, queue immediately
    if (!this._isOnline) {
      this.offlineQueue.enqueue(update, this.clientId, originStr)
      return
    }

    // Convert Uint8Array to a clean ArrayBuffer for Convex v.bytes()
    // (avoid `SharedArrayBuffer` typing issues).
    const arrayBuffer = new ArrayBuffer(update.byteLength)
    new Uint8Array(arrayBuffer).set(update)

    try {
      // Broadcast the update to Convex
      await this.convex.mutation(api.yjs.broadcastUpdate, {
        projectId: this.projectId,
        update: arrayBuffer,
        clientId: this.clientId,
        origin: originStr,
      })
    } catch (err) {
      // Network error or other failure - queue for retry
      console.warn('[YConvexProvider] Update failed, queueing:', err)
      this.offlineQueue.enqueue(update, this.clientId, originStr)
    }
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
   * Check if the provider is currently online.
   */
  get isOnline(): boolean {
    return this._isOnline
  }

  /**
   * Get the number of pending updates in the queue.
   */
  get pendingUpdates(): number {
    return this.offlineQueue.getPendingCount()
  }

  /**
   * Check if there are pending updates waiting to sync.
   */
  get hasPendingUpdates(): boolean {
    return this.offlineQueue.hasPending()
  }

  /**
   * Clean up event listeners when done.
   */
  destroy() {
    this.connected = false
    this.doc.off('update', this.handleLocalUpdate)

    if (typeof window !== 'undefined') {
      window.removeEventListener('online', this.handleOnline)
      window.removeEventListener('offline', this.handleOffline)
    }
  }
}
