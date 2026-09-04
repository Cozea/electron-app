import * as Y from 'yjs'
import type { ConvexReactClient } from 'convex/react'
import { api } from '../../../../../convex/_generated/api'
import type { Id } from '../../../../../convex/_generated/dataModel'

/**
 * A delete-vs-edit conflict detected while a collaboration client is
 * reconnecting. Conflict discovery remains here temporarily while the v2
 * runtime takes ownership of deletion semantics.
 */
export interface DeleteConflict {
  filePath: string
  deletedBy: string | null
  deletedAt: number
  localContent: string
}

export interface ReconnectionResult {
  success: boolean
  sentUpdates: number
  receivedUpdates: number
  deleteConflicts: DeleteConflict[]
  error?: string
}

/**
 * Compatibility conflict detector for the encrypted websocket runtime.
 *
 * The former implementation encoded the complete Y.Doc as plaintext and sent
 * it to `yjs.syncWithServer`. Encrypted rooms reject that payload, and the
 * response contains encrypted envelopes that cannot be passed directly to
 * `Y.applyUpdate`. Keeping that path active risked both failed reconnects and
 * accidental plaintext persistence attempts.
 *
 * Websocket reconnect/catch-up is now the only transport responsibility. This
 * class intentionally performs no document upload or server-state application;
 * it only preserves the existing delete-conflict UI until deletion metadata is
 * moved into the collaboration v2 session tree.
 */
export class ReconnectionProtocol {
  private readonly projectId: Id<'projects'>
  private readonly convex: ConvexReactClient
  private readonly filesMap: Y.Map<Y.Text>

  constructor(
    doc: Y.Doc,
    projectId: Id<'projects'>,
    convex: ConvexReactClient,
  ) {
    this.projectId = projectId
    this.convex = convex
    this.filesMap = doc.getMap<Y.Text>('files')
  }

  async performSync(): Promise<ReconnectionResult> {
    try {
      return {
        success: true,
        sentUpdates: 0,
        receivedUpdates: 0,
        deleteConflicts: await this.detectDeleteConflicts(),
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error('[ReconnectionProtocol] Conflict discovery failed:', error)
      return {
        success: false,
        sentUpdates: 0,
        receivedUpdates: 0,
        deleteConflicts: [],
        error: message,
      }
    }
  }

  private async detectDeleteConflicts(): Promise<DeleteConflict[]> {
    const conflicts: DeleteConflict[] = []

    try {
      const tombstones = await this.convex.query(
        api.fileTombstones.getProjectTombstones,
        { projectId: this.projectId },
      )

      for (const tombstone of tombstones) {
        const localFile = this.filesMap.get(tombstone.filePath)
        if (!localFile) continue

        const localContent = localFile.toString()
        if (localContent.length === 0) continue

        let deletedBy: string | null = null
        if (tombstone.deletedBy) {
          const user = await this.convex.query(api.users.getById, {
            userId: tombstone.deletedBy,
          })
          if (user) {
            deletedBy =
              `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() ||
              user.email
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
    } catch (error) {
      console.warn('[ReconnectionProtocol] Failed to inspect delete conflicts:', error)
    }

    return conflicts
  }
}
