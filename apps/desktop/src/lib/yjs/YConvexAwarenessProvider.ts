import type { ConvexReactClient } from 'convex/react'
import { applyAwarenessUpdate, encodeAwarenessUpdate, removeAwarenessStates } from 'y-protocols/awareness'
import type { Awareness } from 'y-protocols/awareness'
import type * as Y from 'yjs'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

export interface ConvexAwarenessEntry {
  clientId: string
  update: ArrayBuffer
  updatedAt: number
}

const PUBLISH_THROTTLE_MS = 200
const HEARTBEAT_INTERVAL_MS = 15_000

/**
 * YConvexAwarenessProvider - Syncs Yjs Awareness (cursors/selection) via Convex.
 *
 * Awareness updates are NOT part of Y.Doc updates, so they must be synced separately.
 * This provider:
 * - Publishes the local client awareness state (throttled + heartbeat)
 * - Applies remote awareness updates from Convex query results
 * - Removes stale remote states when they disappear from the active set
 */
export class YConvexAwarenessProvider {
  private doc: Y.Doc
  private awareness: Awareness
  private projectId: Id<'projects'>
  private clientId: string
  private convex: ConvexReactClient

  private connected = false
  private publishTimer: ReturnType<typeof setTimeout> | null = null
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null
  private isPublishing = false
  private pendingPublish = false

  private lastAppliedUpdatedAtByClient = new Map<string, number>()
  private remoteClientIds = new Set<number>()

  constructor(doc: Y.Doc, awareness: Awareness, projectId: Id<'projects'>, convex: ConvexReactClient) {
    this.doc = doc
    this.awareness = awareness
    this.projectId = projectId
    this.clientId = doc.clientID.toString()
    this.convex = convex
    this.connected = true

    this.awareness.on('update', this.handleAwarenessUpdate)

    // Publish immediately so others can see us even if the initial `setLocalStateField`
    // happened before this provider was constructed.
    void this.publishAwareness()

    this.heartbeatTimer = setInterval(() => {
      this.schedulePublish()
    }, HEARTBEAT_INTERVAL_MS)
  }

  private handleAwarenessUpdate = (_change: unknown, origin: unknown) => {
    if (!this.connected) return
    // Avoid rebroadcasting what we just applied from remote.
    if (origin === 'remote') return
    this.schedulePublish()
  }

  private schedulePublish() {
    if (!this.connected) return
    if (this.publishTimer) return

    this.publishTimer = setTimeout(() => {
      this.publishTimer = null
      void this.publishAwareness()
    }, PUBLISH_THROTTLE_MS)
  }

  private async publishAwareness() {
    if (!this.connected) return

    if (this.isPublishing) {
      this.pendingPublish = true
      return
    }

    this.isPublishing = true
    this.pendingPublish = false

    // A publish queued before teardown can run after the local awareness
    // state was removed; encodeAwarenessUpdate throws on missing states.
    if (!this.awareness.getStates().has(this.doc.clientID)) {
      this.isPublishing = false
      return
    }

    try {
      const update = encodeAwarenessUpdate(this.awareness, [this.doc.clientID])

      const updateBuffer = new ArrayBuffer(update.byteLength)
      new Uint8Array(updateBuffer).set(update)

      await this.convex.mutation(api.yjsAwareness.upsertAwareness, {
        projectId: this.projectId,
        clientId: this.clientId,
        update: updateBuffer,
      })
    } catch (err) {
      console.warn('[YConvexAwarenessProvider] Failed to publish awareness:', err)
    } finally {
      this.isPublishing = false
      if (this.pendingPublish) {
        this.pendingPublish = false
        this.schedulePublish()
      }
    }
  }

  applyRemoteAwareness(entries: ConvexAwarenessEntry[]) {
    if (!this.connected) return

    const activeRemoteClientIds = new Set<number>()

    for (const entry of entries) {
      if (entry.clientId === this.clientId) continue

      const numericClientId = Number.parseInt(entry.clientId, 10)
      if (!Number.isFinite(numericClientId)) continue

      activeRemoteClientIds.add(numericClientId)

      const lastApplied = this.lastAppliedUpdatedAtByClient.get(entry.clientId) ?? 0
      if (entry.updatedAt <= lastApplied) continue

      try {
        applyAwarenessUpdate(this.awareness, new Uint8Array(entry.update), 'remote')
        this.lastAppliedUpdatedAtByClient.set(entry.clientId, entry.updatedAt)
      } catch (err) {
        console.warn('[YConvexAwarenessProvider] Failed to apply remote awareness:', err)
      }
    }

    // Remove clients that disappeared from the active set to prevent ghost cursors.
    const toRemove: number[] = []
    for (const existingId of this.remoteClientIds) {
      if (!activeRemoteClientIds.has(existingId)) {
        toRemove.push(existingId)
      }
    }

    if (toRemove.length > 0) {
      try {
        removeAwarenessStates(this.awareness, toRemove, 'remote')
      } catch (err) {
        console.warn('[YConvexAwarenessProvider] Failed to remove stale awareness:', err)
      }
      for (const id of toRemove) {
        this.remoteClientIds.delete(id)
        this.lastAppliedUpdatedAtByClient.delete(String(id))
      }
    }

    for (const id of activeRemoteClientIds) {
      this.remoteClientIds.add(id)
    }
  }

  destroy() {
    if (!this.connected) return

    try {
      // Broadcast removal update so others can clear our cursors quickly.
      this.awareness.setLocalState(null)
      void this.publishAwareness()
    } catch {
      // ignore
    }

    this.connected = false
    this.awareness.off('update', this.handleAwarenessUpdate)
    if (this.publishTimer) clearTimeout(this.publishTimer)
    if (this.heartbeatTimer) clearInterval(this.heartbeatTimer)
    this.publishTimer = null
    this.heartbeatTimer = null
  }
}

