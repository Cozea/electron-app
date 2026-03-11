import { type IpcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import { getGitRuntimeHealth, mergeTextWithGit, mergeTreeWithGit } from '../gitRuntime'
import { resolvePathWithinDirectory } from '../pathUtils'
import { markInternalFsChange } from '../projectWatcher'
import {
  acknowledgeSyncOps,
  enqueueSyncOps,
  getSyncJournalStateSnapshot,
  normalizeSyncPath,
  type SyncOpRecord,
} from '../services/syncReplicaStore'
import { GitSyncService } from '../services/gitSyncService'
import { notifyFileChanged, notifyFileDeleted, notifyFileMetaChanged } from '../yjsNotify'

function sha256Hex(content: Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

export function registerSyncHandlers(ipcMain: IpcMain): void {
  const gitSyncService = GitSyncService.getInstance()

  ipcMain.handle(
    'sync:hashFile',
    async (_event, { filePath }: { filePath: string }): Promise<{ hash: string; size: number }> => {
      const content = fs.readFileSync(filePath)
      const hash = sha256Hex(content)

      return { hash, size: content.length }
    }
  )

  ipcMain.handle(
    'sync:writeFiles',
    async (
      _event,
      {
        projectPath,
        files,
        opMeta,
      }: {
        projectPath: string
        files: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>
        opMeta?: {
          projectId: string
          actorId?: string
          actorType?: 'user' | 'agent' | 'system'
          source?: 'monaco' | 'agent' | 'watcher' | 'remote'
        }
      }
    ): Promise<{
      results: Array<{ path: string; success: boolean; error?: string }>
      successCount: number
    }> => {
      const results: Array<{ path: string; success: boolean; error?: string }> = []
      const opsToEnqueue: SyncOpRecord[] = []
      const opProjectId = opMeta?.projectId ? String(opMeta.projectId) : null
      const opActorId = opMeta?.actorId?.trim() ? opMeta.actorId.trim() : 'system'
      const opActorType = opMeta?.actorType ?? 'system'
      const opSource = opMeta?.source ?? 'remote'

      for (const file of files) {
        try {
          const fullPath = resolvePathWithinDirectory(projectPath, file.path)
          const dir = path.dirname(fullPath)

          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true })
          }

          // Prevent the project watcher from treating this as an external change.
          markInternalFsChange(fullPath)
          const bytes =
            file.encoding === 'base64'
              ? Buffer.from(file.content, 'base64')
              : Buffer.from(file.content, 'utf-8')
          if (file.encoding === 'base64') {
            fs.writeFileSync(fullPath, bytes)
          } else {
            fs.writeFileSync(fullPath, file.content, 'utf-8')
          }
          const stats = fs.statSync(fullPath)
          results.push({ path: file.path, success: true })
          console.log(`[Sync] Wrote file: ${file.path}`)

          if (opProjectId) {
            const normalizedPath = normalizeSyncPath(file.path)
            const timestamp = Date.now()
            const newHash = sha256Hex(bytes)
            opsToEnqueue.push({
              opId: randomUUID(),
              idempotencyKey: `${opProjectId}:${opSource}:upsert:${normalizedPath}:${newHash}`,
              projectId: opProjectId,
              actorId: opActorId,
              actorType: opActorType,
              source: opSource,
              kind: 'upsert',
              path: normalizedPath,
              newHash,
              isBinary: file.encoding === 'base64',
              size: stats.size,
              timestamp,
            })
          }

          if (file.encoding !== 'base64') {
            notifyFileChanged(fullPath, file.content, { origin: 'sync' })
          }
          notifyFileMetaChanged({
            filePath: fullPath,
            origin: 'sync',
            isBinary: file.encoding === 'base64',
            sizeBytes: stats.size,
            content: file.encoding === 'base64' ? undefined : file.content,
          })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          results.push({ path: file.path, success: false, error: errorMsg })
          console.error(`[Sync] Failed to write file: ${file.path}`, error)
        }
      }

      if (opProjectId && opsToEnqueue.length > 0) {
        enqueueSyncOps(opProjectId, opsToEnqueue)
      }

      return { results, successCount: results.filter((result) => result.success).length }
    }
  )

  ipcMain.handle(
    'sync:deleteFiles',
    async (
      _event,
      {
        projectPath,
        paths,
        opMeta,
      }: {
        projectPath: string
        paths: string[]
        opMeta?: {
          projectId: string
          actorId?: string
          actorType?: 'user' | 'agent' | 'system'
          source?: 'monaco' | 'agent' | 'watcher' | 'remote'
        }
      }
    ): Promise<{
      results: Array<{ path: string; success: boolean }>
    }> => {
      const results: Array<{ path: string; success: boolean }> = []
      const opsToEnqueue: SyncOpRecord[] = []
      const opProjectId = opMeta?.projectId ? String(opMeta.projectId) : null
      const opActorId = opMeta?.actorId?.trim() ? opMeta.actorId.trim() : 'system'
      const opActorType = opMeta?.actorType ?? 'system'
      const opSource = opMeta?.source ?? 'remote'

      for (const relPath of paths) {
        try {
          const fullPath = resolvePathWithinDirectory(projectPath, relPath)
          if (fs.existsSync(fullPath)) {
            // Prevent the project watcher from treating this as an external change.
            markInternalFsChange(fullPath)
            fs.unlinkSync(fullPath)
            console.log(`[Sync] Deleted file: ${relPath}`)
          }
          results.push({ path: relPath, success: true })

          if (opProjectId) {
            const normalizedPath = normalizeSyncPath(relPath)
            const timestamp = Date.now()
            opsToEnqueue.push({
              opId: randomUUID(),
              idempotencyKey: `${opProjectId}:${opSource}:delete:${normalizedPath}`,
              projectId: opProjectId,
              actorId: opActorId,
              actorType: opActorType,
              source: opSource,
              kind: 'delete',
              path: normalizedPath,
              isBinary: false,
              size: 0,
              timestamp,
            })
          }

          notifyFileDeleted(fullPath, { origin: 'sync' })
        } catch (error) {
          console.error(`[Sync] Failed to delete file: ${relPath}`, error)
          results.push({ path: relPath, success: false })
        }
      }

      if (opProjectId && opsToEnqueue.length > 0) {
        enqueueSyncOps(opProjectId, opsToEnqueue)
      }

      return { results }
    }
  )

  ipcMain.handle('sync:getGitRuntimeHealth', async (_event, { force = false }: { force?: boolean }) => {
    return getGitRuntimeHealth(Boolean(force))
  })

  ipcMain.handle(
    'sync:gitEnsureRepo',
    async (
      _event,
      options: {
        projectPath: string
        branch?: string
        repoUrl?: string
        debug?: boolean
      }
    ) => gitSyncService.ensureRepo(options)
  )

  ipcMain.handle(
    'sync:gitCloneIfMissing',
    async (
      _event,
      options: {
        projectPath: string
        repoUrl: string
        branch?: string
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
        debug?: boolean
      }
    ) => gitSyncService.cloneIfMissing(options)
  )

  ipcMain.handle(
    'sync:gitFetchMain',
    async (
      _event,
      options: {
        projectPath: string
        remote?: string
        branch?: string
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
        debug?: boolean
      }
    ) => gitSyncService.fetchMain(options)
  )

  ipcMain.handle(
    'sync:gitStatus',
    async (
      _event,
      options: {
        projectPath: string
        remote?: string
        branch?: string
        debug?: boolean
      }
    ) => gitSyncService.getStatus(options)
  )

  ipcMain.handle(
    'sync:gitPullMain',
    async (
      _event,
      options: {
        projectPath: string
        remote?: string
        branch?: string
        strategy?: 'merge' | 'ff-only'
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
        debug?: boolean
      }
    ) => gitSyncService.pullMain(options)
  )

  ipcMain.handle(
    'sync:gitRestoreMain',
    async (
      _event,
      options: {
        projectPath: string
        remote?: string
        branch?: string
        repoUrl?: string
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
        debug?: boolean
      }
    ) => gitSyncService.restoreMain(options)
  )

  ipcMain.handle(
    'sync:gitAdoptWorkspace',
    async (
      _event,
      options: {
        projectPath: string
        branch?: string
        repoUrl?: string
        debug?: boolean
      }
    ) => gitSyncService.adoptWorkspace(options)
  )

  ipcMain.handle(
    'sync:gitCommitAll',
    async (
      _event,
      options: {
        projectPath: string
        message: string
        addAll?: boolean
      }
    ) => gitSyncService.commitAll(options)
  )

  ipcMain.handle(
    'sync:gitPushMain',
    async (
      _event,
      options: {
        projectPath: string
        remote?: string
        branch?: string
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
      }
    ) => gitSyncService.pushMain(options)
  )

  ipcMain.handle(
    'sync:gitCommitAndPush',
    async (
      _event,
      options: {
        projectPath: string
        message: string
        remote?: string
        branch?: string
        addAll?: boolean
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
      }
    ) => gitSyncService.commitAndPush(options)
  )

  ipcMain.handle(
    'sync:mergePreview',
    async (
      _event,
      input: {
        baseContent: string
        localContent: string
        cloudContent: string
        strategy?: 'zdiff3' | 'diff3'
        labels?: {
          local?: string
          base?: string
          cloud?: string
        }
      }
    ) => {
      return mergeTextWithGit(input)
    }
  )

  ipcMain.handle(
    'sync:mergeTreePreview',
    async (
      _event,
      input: {
        baseFiles: Array<{ path: string; content: string }>
        localFiles: Array<{ path: string; content: string }>
        cloudFiles: Array<{ path: string; content: string }>
        maxPreviewFiles?: number
        maxPreviewBytes?: number
      }
    ) => {
      return mergeTreeWithGit(input)
    }
  )

  ipcMain.handle(
    'sync:enqueueOps',
    async (
      _event,
      { projectId, ops }: { projectId: string; ops: SyncOpRecord[] }
    ): Promise<{
      accepted: number
      acceptedOpIds: string[]
      rejected: number
      journalState: {
        projectId: string
        journalHead: number
        pendingOps: number
        lastAckedAt: number | null
        ackedOps: number
        pathHeads: Record<string, string>
        lastJournalCursor: number
        lastPersistedAt: number | null
      }
    }> => {
      const result = enqueueSyncOps(String(projectId), Array.isArray(ops) ? ops : [])
      return {
        accepted: result.accepted,
        acceptedOpIds: result.acceptedOpIds,
        rejected: result.rejected,
        journalState: getSyncJournalStateSnapshot(String(projectId)),
      }
    }
  )

  ipcMain.handle(
    'sync:ackOps',
    async (
      _event,
      { projectId, opIds }: { projectId: string; opIds: string[] }
    ): Promise<{
      acked: number
      journalState: {
        projectId: string
        journalHead: number
        pendingOps: number
        lastAckedAt: number | null
        ackedOps: number
        pathHeads: Record<string, string>
        lastJournalCursor: number
        lastPersistedAt: number | null
      }
    }> => {
      const result = acknowledgeSyncOps(String(projectId), Array.isArray(opIds) ? opIds : [])
      return {
        acked: result.acked,
        journalState: getSyncJournalStateSnapshot(String(projectId)),
      }
    }
  )

  ipcMain.handle(
    'sync:getJournalState',
    async (
      _event,
      { projectId }: { projectId: string }
    ): Promise<{
      projectId: string
      journalHead: number
      pendingOps: number
      lastAckedAt: number | null
      ackedOps: number
      pathHeads: Record<string, string>
      lastJournalCursor: number
      lastPersistedAt: number | null
    }> => {
      return getSyncJournalStateSnapshot(String(projectId))
    }
  )

}
