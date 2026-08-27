import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

/**
 * Queued Yjs update waiting to be sent to Convex.
 */
interface QueuedUpdate {
  id: string
  projectId: string
  update: string // base64-encoded Uint8Array
  clientId: string
  origin: string
  timestamp: number
  attempts: number
}

const UPDATE_STORAGE_KEY = 'cozea:yjs-update-queue'
const MAX_RETRIES = 5
const BASE_DELAY_MS = 1000

/**
 * YjsOfflineQueue - Queues Yjs updates when offline and retries on reconnection.
 *
 * When Convex mutations fail (network down, server error), updates are:
 * 1. Stored in localStorage (survives page refresh)
 * 2. Retried with exponential backoff when connection returns
 * 3. Dropped after MAX_RETRIES failures
 *
 * This ensures no user edits are lost due to temporary network issues.
 */
export class YjsOfflineQueue {
  private isProcessing = false
  private projectId: Id<'projects'>
  private convex: ConvexReactClient

  constructor(convex: ConvexReactClient, projectId: Id<'projects'>) {
    this.convex = convex
    this.projectId = projectId
  }

  /**
   * Add a Yjs update to the queue.
   * Called when a Convex mutation fails.
   */
  enqueue(update: Uint8Array, clientId: string, origin: string): void {
    const queue = this.loadUpdateQueue()
    queue.push({
      id: crypto.randomUUID(),
      projectId: this.projectId,
      update: this.encodeBase64(update),
      clientId,
      origin,
      timestamp: Date.now(),
      attempts: 0,
    })
    this.saveUpdateQueue(queue)
    console.log(`[OfflineQueue] Queued update, ${queue.length} pending`)
  }

  /**
   * Process all queued updates, retrying failed mutations.
   * Should be called when connection is restored.
   */
  async processQueue(): Promise<void> {
    if (this.isProcessing) return
    this.isProcessing = true

    try {
      await this.processUpdateQueue()
    } finally {
      this.isProcessing = false
    }
  }

  private async processUpdateQueue(): Promise<void> {
    const queue = this.loadUpdateQueue()
    const remaining: QueuedUpdate[] = []

    for (const item of queue) {
      // Only process updates for this project
      if (item.projectId !== this.projectId) {
        remaining.push(item)
        continue
      }

      try {
        const bytes = this.decodeBase64(item.update)
        // Create a clean ArrayBuffer (avoid SharedArrayBuffer type issues)
        const arrayBuffer = new ArrayBuffer(bytes.byteLength)
        new Uint8Array(arrayBuffer).set(bytes)

        await this.convex.mutation(api.yjs.broadcastUpdate, {
          projectId: item.projectId as Id<'projects'>,
          update: arrayBuffer,
          clientId: item.clientId,
          origin: item.origin,
        })

        console.log(`[OfflineQueue] Sent queued update ${item.id}`)
        // Success - don't re-add to queue
      } catch (err) {
        item.attempts++
        if (item.attempts < MAX_RETRIES) {
          remaining.push(item)
          console.warn(
            `[OfflineQueue] Retry ${item.attempts}/${MAX_RETRIES} for update ${item.id}:`,
            err
          )
          // Exponential backoff between retries
          await this.delay(BASE_DELAY_MS * Math.pow(2, item.attempts))
        } else {
          console.error(
            `[OfflineQueue] Dropping update ${item.id} after ${MAX_RETRIES} retries`
          )
        }
      }
    }

    this.saveUpdateQueue(remaining)
  }

  /**
   * Get the number of pending updates for this project.
   */
  getPendingCount(): number {
    const updateQueue = this.loadUpdateQueue()
    return updateQueue.filter((q) => q.projectId === this.projectId).length
  }

  /**
   * Check if there are any pending updates.
   */
  hasPending(): boolean {
    return this.getPendingCount() > 0
  }

  // --- Storage helpers ---

  private loadUpdateQueue(): QueuedUpdate[] {
    try {
      const raw = localStorage.getItem(UPDATE_STORAGE_KEY)
      return raw ? JSON.parse(raw) : []
    } catch {
      return []
    }
  }

  private saveUpdateQueue(queue: QueuedUpdate[]): void {
    try {
      localStorage.setItem(UPDATE_STORAGE_KEY, JSON.stringify(queue))
    } catch (err) {
      console.error('[OfflineQueue] Failed to save update queue:', err)
    }
  }

  // --- Encoding helpers ---

  private encodeBase64(bytes: Uint8Array): string {
    return btoa(String.fromCharCode(...bytes))
  }

  private decodeBase64(base64: string): Uint8Array {
    return Uint8Array.from(atob(base64), (c) => c.charCodeAt(0))
  }

  private delay(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms))
  }
}
