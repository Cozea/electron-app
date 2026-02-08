import * as Y from 'yjs'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

/**
 * A delete-vs-edit conflict detected during reconnection.
 * Occurs when one user deleted a file while another was editing it offline.
 */
export interface DeleteConflict {
  /** The file path that was deleted */
  filePath: string
  /** Who deleted the file */
  deletedBy: string | null
  /** When the file was deleted */
  deletedAt: number
  /** The local content that conflicts with the deletion */
  localContent: string
}

/**
 * Result of a reconnection sync operation.
 */
export interface ReconnectionResult {
  /** Whether the sync completed successfully */
  success: boolean
  /** Number of updates sent from client to server */
  sentUpdates: number
  /** Number of updates received from server */
  receivedUpdates: number
  /** Delete-vs-edit conflicts that need user resolution */
  deleteConflicts: DeleteConflict[]
  /** Error message if sync failed */
  error?: string
}

interface SyncWithServerResponse {
  serverSnapshot: ArrayBuffer | null
  snapshotVersion: number
  snapshotCreatedAt: number
  recentUpdates: Array<{ update: ArrayBuffer; clientId: string; timestamp: number }>
  deltaUpdate?: ArrayBuffer
  deltaByteLength?: number
  serverStateVector?: ArrayBuffer
  serverTimestamp?: number
}

/**
 * ReconnectionProtocol - Handles efficient sync after offline periods.
 *
 * When a client reconnects after being offline, this protocol:
 * 1. Sends any local changes made while offline to the server
 * 2. Receives any remote changes made by others
 * 3. Uses Yjs CRDT to automatically merge changes
 *
 * This ensures no edits are lost and all clients converge to the same state.
 */
export class ReconnectionProtocol {
  private doc: Y.Doc
  private projectId: Id<'projects'>
  private convex: ConvexReactClient
  private clientId: string
  private filesMap: Y.Map<Y.Text>

  constructor(
    doc: Y.Doc,
    projectId: Id<'projects'>,
    convex: ConvexReactClient
  ) {
    this.doc = doc
    this.projectId = projectId
    this.convex = convex
    this.clientId = doc.clientID.toString()
    this.filesMap = doc.getMap<Y.Text>('files')
  }

  /**
   * Perform a full sync with the server.
   * Should be called when connection is restored after being offline.
   */
  async performSync(): Promise<ReconnectionResult> {
    try {
      // 1. Check for delete-vs-edit conflicts before syncing
      const deleteConflicts = await this.detectDeleteConflicts()

      // 2. Encode our current state as an update
      // This captures all local changes, including those made offline
      const localUpdate = Y.encodeStateAsUpdate(this.doc)

      // Create clean ArrayBuffer for Convex
      const updateBuffer = new ArrayBuffer(localUpdate.byteLength)
      new Uint8Array(updateBuffer).set(localUpdate)

      // 3. Send to server and get server's state
      const result = (await this.convex.mutation(api.yjs.syncWithServer, {
        projectId: this.projectId,
        clientUpdate: updateBuffer,
        clientId: this.clientId,
      })) as SyncWithServerResponse

      let receivedUpdates = 0

      // 4. Prefer state-vector delta updates for efficient reconciliation.
      if (result.deltaUpdate && result.deltaUpdate.byteLength > 0) {
        Y.applyUpdate(this.doc, new Uint8Array(result.deltaUpdate), 'sync')
        receivedUpdates = 1
      } else {
        // Legacy fallback for older server payloads.
        if (result.serverSnapshot) {
          const serverBytes = new Uint8Array(result.serverSnapshot)
          Y.applyUpdate(this.doc, serverBytes, 'sync')
          receivedUpdates++
        }

        for (const update of result.recentUpdates) {
          if (update.clientId !== this.clientId) {
            const updateBytes = new Uint8Array(update.update)
            Y.applyUpdate(this.doc, updateBytes, 'sync')
            receivedUpdates++
          }
        }
      }

      console.log(
        `[ReconnectionProtocol] Sync complete: sent 1 update, received ${receivedUpdates} updates, ${deleteConflicts.length} conflicts`
      )

      return {
        success: true,
        sentUpdates: 1,
        receivedUpdates,
        deleteConflicts,
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : String(err)
      console.error('[ReconnectionProtocol] Sync failed:', err)

      return {
        success: false,
        sentUpdates: 0,
        receivedUpdates: 0,
        deleteConflicts: [],
        error: errorMessage,
      }
    }
  }

  /**
   * Detect files that were deleted on the server while we have local edits.
   */
  private async detectDeleteConflicts(): Promise<DeleteConflict[]> {
    const conflicts: DeleteConflict[] = []

    try {
      // Get all tombstones for this project
      const tombstones = await this.convex.query(
        api.fileTombstones.getProjectTombstones,
        { projectId: this.projectId }
      )

      // Check each tombstone against our local files
      for (const tombstone of tombstones) {
        const localFile = this.filesMap.get(tombstone.filePath)
        if (localFile) {
          const localContent = localFile.toString()
          // Only report as conflict if local file has content
          if (localContent.length > 0) {
            // Get who deleted it
            let deletedBy: string | null = null
            if (tombstone.deletedBy) {
              const user = await this.convex.query(api.users.getById, {
                userId: tombstone.deletedBy,
              })
              if (user) {
                deletedBy = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || user.email
              }
            } else if (tombstone.deletedByAgent) {
              deletedBy = tombstone.deletedByAgent
            }

            conflicts.push({
              filePath: tombstone.filePath,
              deletedBy,
              deletedAt: tombstone.deletedAt,
              localContent,
            })
          }
        }
      }
    } catch (err) {
      console.warn('[ReconnectionProtocol] Failed to check delete conflicts:', err)
      // Non-fatal - continue with sync
    }

    return conflicts
  }
}
