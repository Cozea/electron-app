import { useEffect, useRef } from 'react'
import type { Id } from '../../../../convex/_generated/dataModel'
import type { FileChangeAttribution } from '../../../../shared/electronApiTypes'
import { SyncCoordinator } from '@/lib/sync/SyncCoordinator'
import type { YjsProjectDoc } from '@/lib/yjs/YjsProjectDoc'

function relativePathFromExternalEvent(data: {
  filePath: string
  workspaceId?: string
  relativePath?: string
}, workspaceId: string): string | null {
  if (data.workspaceId) {
    if (data.workspaceId !== workspaceId) return null
    return data.relativePath?.replace(/\\/g, '/').replace(/^\/+/, '') ?? null
  }

  if (!data.filePath.startsWith(workspaceId)) return null
  return data.filePath
    .slice(workspaceId.length)
    .replace(/^[/\\]+/, '')
    .replace(/\\/g, '/')
}

/**
 * useAgentFileSync - Bridges external file changes (from AI agents) to Yjs.
 *
 * When an AI agent writes to a file via Electron IPC, this hook receives
 * the notification and applies the change to the Y.Doc, which then
 * propagates to all connected editors via Yjs CRDT.
 */
export function useAgentFileSync(
  yjsDoc: YjsProjectDoc | null,
  workspaceId: string | null,
  projectId: Id<'projects'> | null,
  userId: Id<'devicePrincipals'> | null
): void {
  const coordinatorRef = useRef<SyncCoordinator | null>(null)

  useEffect(() => {
    if (!projectId) {
      coordinatorRef.current = null
      return
    }

    coordinatorRef.current = new SyncCoordinator({
      projectId,
      actorId: userId ? String(userId) : 'watcher',
      actorType: 'user',
      source: 'watcher',
    })
  }, [projectId, userId])

  useEffect(() => {
    if (!yjsDoc || !workspaceId) return

    const cleanups: Array<() => void> = []

    const mapOrigin = (origin?: string | FileChangeAttribution): {
      source: 'agent' | 'watcher' | 'remote'
      actorType: 'agent' | 'user' | 'system'
      actorId: string
    } => {
      if (origin && typeof origin === 'object') {
        return {
          source:
            origin.sourceOrigin === 'agent' || origin.origin === 'agent'
              ? 'agent'
              : origin.origin === 'remote'
                ? 'remote'
                : 'watcher',
          actorType:
            origin.actorType === 'agent' || origin.actorType === 'system'
              ? origin.actorType
              : origin.origin === 'remote'
                ? 'system'
                : 'user',
          actorId:
            origin.actorId?.trim() ||
            origin.terminalId?.trim() ||
            origin.runId?.trim() ||
            (userId ? String(userId) : 'watcher'),
        }
      }

      if (origin === 'agent') {
        return { source: 'agent', actorType: 'agent', actorId: 'agent' }
      }
      if (origin === 'sync' || origin === 'remote') {
        return { source: 'remote', actorType: 'system', actorId: 'remote' }
      }
      return {
        source: 'watcher',
        actorType: 'user',
        actorId: userId ? String(userId) : 'watcher',
      }
    }

    const enqueueUpsertOp = async (
      path: string,
      content: string,
      origin?: string | FileChangeAttribution,
    ) => {
      const coordinator = coordinatorRef.current
      if (!coordinator) return
      const meta = mapOrigin(origin)
      const bytes = new TextEncoder().encode(content)
      const hash = await crypto.subtle.digest('SHA-256', bytes)
      const newHash = Array.from(
        new Uint8Array(hash),
        (byte) => byte.toString(16).padStart(2, '0')
      ).join('')

      await coordinator.enqueueOp({
        kind: 'upsert',
        path,
        source: meta.source,
        actorType: meta.actorType,
        actorId: meta.actorId,
        newHash,
        isBinary: false,
        size: bytes.byteLength,
      })
    }

    const enqueueDeleteOp = async (path: string, origin?: string | FileChangeAttribution) => {
      const coordinator = coordinatorRef.current
      if (!coordinator) return
      const meta = mapOrigin(origin)
      await coordinator.enqueueOp({
        kind: 'delete',
        path,
        source: meta.source,
        actorType: meta.actorType,
        actorId: meta.actorId,
        isBinary: false,
        size: 0,
      })
    }

    // Subscribe to external file changes from Electron main process
    const cleanupChange = window.electronAPI.yjs?.onExternalFileChange?.(
      ({ filePath, workspaceId: eventWorkspaceId, relativePath, content, origin }) => {
        const normalizedPath = relativePathFromExternalEvent({
          filePath,
          workspaceId: eventWorkspaceId,
          relativePath,
        }, workspaceId)
        if (!normalizedPath) return

        // console.log(`[AgentSync] External file change: ${normalizedPath}`)

        // Apply the change to Yjs document
        yjsDoc.applyExternalChange(normalizedPath, content, origin ?? 'agent')
        // Only enqueue directly for remote/sync origins because local/agent/external
        // writes are persisted (and enqueued) by ProjectFilesPersistence.
        if (origin === 'sync' || origin === 'remote' || (origin && typeof origin === 'object' && origin.origin === 'remote')) {
          void enqueueUpsertOp(normalizedPath, content, origin).catch((error) => {
            console.warn(`[AgentSync] Failed to enqueue upsert op for ${normalizedPath}:`, error)
          })
        }
      }
    )

    if (cleanupChange) cleanups.push(cleanupChange)

    const cleanupDelete = window.electronAPI.yjs?.onExternalFileDelete?.(
      ({ filePath, workspaceId: eventWorkspaceId, relativePath, origin }) => {
        const normalizedPath = relativePathFromExternalEvent({
          filePath,
          workspaceId: eventWorkspaceId,
          relativePath,
        }, workspaceId)
        if (!normalizedPath) return

        // console.log(`[AgentSync] External file delete: ${normalizedPath}`)
        yjsDoc.deletePath(normalizedPath, origin ?? 'agent')
        if (origin === 'sync' || origin === 'remote' || (origin && typeof origin === 'object' && origin.origin === 'remote')) {
          void enqueueDeleteOp(normalizedPath, origin).catch((error) => {
            console.warn(`[AgentSync] Failed to enqueue delete op for ${normalizedPath}:`, error)
          })
        }
      }
    )

    if (cleanupDelete) cleanups.push(cleanupDelete)

    return () => {
      for (const cleanup of cleanups) cleanup()
    }
  }, [yjsDoc, workspaceId, userId])
}
