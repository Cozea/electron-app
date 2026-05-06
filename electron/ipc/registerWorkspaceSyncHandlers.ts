import { type IpcMain } from 'electron'
import * as Effect from "effect/Effect"
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization'

import { createHash, randomUUID } from 'node:crypto'
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises'
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
} from '../services/syncJournalStore'
import { GitChangesBroadcaster } from '../services/GitChangesBroadcaster'
import { GitSyncService } from '../services/gitSyncService'
import { CheckpointWorkerClient } from '../services/CheckpointWorkerClient'
import { notifyFileChanged, notifyFileDeleted, notifyFileMetaChanged } from '../yjsNotify'
import type { GitChangesScope } from '../../shared/electronApiTypes'

function sha256Hex(content: Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}




export function registerWorkspaceSyncHandlers(ipcMain: IpcMain): void {
  const gitSyncService = GitSyncService.getInstance()
  const gitDirtyStateService = GitChangesBroadcaster.getInstance()
  const checkpointWorkerClient = CheckpointWorkerClient.getInstance()

  ipcMain.handle(
    'workspaceSync:hashFile',
    async (_event, { workspaceId, laneId, path }: { workspaceId: string; laneId?: string; path: string }): Promise<{ hash: string; size: number } | { success: false; error: string }> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, laneId, operation: 'read-file', relativePath: path })
        const content = await readFile(access.fullPath!)
        const hash = sha256Hex(content)
        return { hash, size: content.length }
      } catch (e) {
        return { success: false, error: e instanceof Error ? e.message : String(e) }
      }
    }
  )

  ipcMain.handle(
    'workspaceSync:writeFiles',
    async (
      _event,
      {
        workspaceId,
        files,
        opMeta,
      }: {
        workspaceId: string
        files: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>
        opMeta?: {
          projectId: string
          actorId?: string
          actorType?: 'user' | 'agent' | 'system'
          source?: 'editor' | 'agent' | 'watcher' | 'remote'
        }
      }
    ): Promise<{
      results: Array<{ path: string; success: boolean; error?: string }>
      successCount: number
    }> => {
      let projectRootPath: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: workspaceId, operation: 'write-file' })
        projectRootPath = access.projectRootPath
      } catch (e) {
        return { results: [], successCount: 0 }
      }
      const results: Array<{ path: string; success: boolean; error?: string }> = []
      const opsToEnqueue: SyncOpRecord[] = []
      const opProjectId = opMeta?.projectId ? String(opMeta.projectId) : null
      const opActorId = opMeta?.actorId?.trim() ? opMeta.actorId.trim() : 'system'
      const opActorType = opMeta?.actorType ?? 'system'
      const opSource = opMeta?.source ?? 'remote'

      for (const file of files) {
        try {
          const fullPath = resolvePathWithinDirectory(projectRootPath, file.path)
          const dir = path.dirname(fullPath)

          await mkdir(dir, { recursive: true })

          // Prevent the project watcher from treating this as an external change.
          markInternalFsChange(fullPath)
          const bytes =
            file.encoding === 'base64'
              ? Buffer.from(file.content, 'base64')
              : Buffer.from(file.content, 'utf-8')
          if (file.encoding === 'base64') {
            await writeFile(fullPath, bytes)
          } else {
            await writeFile(fullPath, file.content, 'utf-8')
          }
          const stats = await stat(fullPath)
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
            notifyFileChanged(fullPath, file.content, {
              origin: 'sync',
              workspaceId,
              projectRootPath,
              relativePath: file.path,
            })
          }
          notifyFileMetaChanged({
            filePath: fullPath,
            workspaceId,
            projectRootPath,
            relativePath: file.path,
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
    'workspaceSync:deleteFiles',
    async (
      _event,
      {
        workspaceId,
        paths,
        opMeta,
      }: {
        workspaceId: string
        paths: string[]
        opMeta?: {
          projectId: string
          actorId?: string
          actorType?: 'user' | 'agent' | 'system'
          source?: 'editor' | 'agent' | 'watcher' | 'remote'
        }
      }
    ): Promise<{
      results: Array<{ path: string; success: boolean }>
    }> => {
      let projectRootPath: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: workspaceId, operation: 'delete-file' })
        projectRootPath = access.projectRootPath
      } catch (e) {
        return { results: [] }
      }
      const results: Array<{ path: string; success: boolean }> = []
      const opsToEnqueue: SyncOpRecord[] = []
      const opProjectId = opMeta?.projectId ? String(opMeta.projectId) : null
      const opActorId = opMeta?.actorId?.trim() ? opMeta.actorId.trim() : 'system'
      const opActorType = opMeta?.actorType ?? 'system'
      const opSource = opMeta?.source ?? 'remote'

      for (const relPath of paths) {
        try {
          const fullPath = resolvePathWithinDirectory(projectRootPath, relPath)
          try {
            // Prevent the project watcher from treating this as an external change.
            markInternalFsChange(fullPath)
            await unlink(fullPath)
            console.log(`[Sync] Deleted file: ${relPath}`)
          } catch (unlinkErr) {
            const code = (unlinkErr as NodeJS.ErrnoException)?.code
            if (code !== 'ENOENT') {
              throw unlinkErr
            }
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

          notifyFileDeleted(fullPath, {
            origin: 'sync',
            workspaceId,
            projectRootPath,
            relativePath: relPath,
          })
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

  ipcMain.handle('workspaceSync:getGitRuntimeHealth', async (_event, { force = false }: { force?: boolean }) => {
    return getGitRuntimeHealth(Boolean(force))
  })

  ipcMain.handle(
    'workspaceSync:gitEnsureRepo',
    async (
      _event,
      options: {
        workspaceId: string
        branch?: string
        repoUrl?: string
        debug?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return gitSyncService.ensureRepo({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitCloneIfMissing',
    async (
      _event,
      options: {
        workspaceId: string
        repoUrl: string
        branch?: string
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
        debug?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return gitSyncService.cloneIfMissing({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitFetchMain',
    async (
      _event,
      options: {
        workspaceId: string
        remote?: string
        branch?: string
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
        debug?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return gitSyncService.fetchMain({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitStatus',
    async (
      _event,
      options: {
        workspaceId: string
        remote?: string
        branch?: string
        debug?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, isRepo: false, error: String(e) }
      }
      return gitSyncService.getStatus({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitPullMain',
    async (
      _event,
      options: {
        workspaceId: string
        remote?: string
        branch?: string
        strategy?: 'merge' | 'ff-only'
        allowUnrelatedHistories?: boolean
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
        debug?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      try {
        return await gitSyncService.pullMain({ ...options, projectPath })
      } finally {
        gitDirtyStateService.invalidateProjectPath(projectPath)
      }
    }
  )

  ipcMain.handle(
    'workspaceSync:gitReplayLocalCommits',
    async (
      _event,
      options: {
        workspaceId: string
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
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      try {
        return await gitSyncService.replayLocalCommits({ ...options, projectPath })
      } finally {
        gitDirtyStateService.invalidateProjectPath(projectPath)
      }
    }
  )

  ipcMain.handle(
    'workspaceSync:gitClassifyRepoHealth',
    async (
      _event,
      options: {
        workspaceId: string
        remote?: string
        branch?: string
        debug?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return gitSyncService.classifyRepoHealth({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitSalvageReclone',
    async (
      _event,
      options: {
        workspaceId: string
        repoUrl: string
        branch?: string
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
        debug?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return gitSyncService.salvageReclone({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitReadConflictFile',
    async (
      _event,
      options: {
        workspaceId: string
        filePath: string
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return gitSyncService.readConflictFile({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitResolveConflictFile',
    async (
      _event,
      options: {
        workspaceId: string
        filePath: string
        resolvedContent: string
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return gitSyncService.resolveConflictFile({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitRestoreMain',
    async (
      _event,
      options: {
        workspaceId: string
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
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      try {
        return await gitSyncService.restoreMain({ ...options, projectPath })
      } finally {
        gitDirtyStateService.invalidateProjectPath(projectPath)
      }
    }
  )

  ipcMain.handle(
    'workspaceSync:gitAdoptWorkspace',
    async (
      _event,
      options: {
        workspaceId: string
        branch?: string
        repoUrl?: string
        debug?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      try {
        return await gitSyncService.adoptWorkspace({ ...options, projectPath })
      } finally {
        gitDirtyStateService.invalidateProjectPath(projectPath)
      }
    }
  )

  ipcMain.handle(
    'workspaceSync:gitCommitAll',
    async (
      _event,
      options: {
        workspaceId: string
        message: string
        addAll?: boolean
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      try {
        return await gitSyncService.commitAll({ ...options, projectPath })
      } finally {
        gitDirtyStateService.invalidateProjectPath(projectPath)
      }
    }
  )

  ipcMain.handle(
    'workspaceSync:gitPushMain',
    async (
      _event,
      options: {
        workspaceId: string
        remote?: string
        branch?: string
        extraHeader?: string
        provider?: string
        accessToken?: string
        encryptedCredentials?: string
        keyId?: string
      }
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return gitSyncService.pushMain({ ...options, projectPath })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitCommitAndPush',
    async (
      _event,
      options: {
        workspaceId: string
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
    ) => {
      let projectPath: string
      let gitRootPath: string | null = null
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        gitRootPath = access.gitRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      try {
        return await gitSyncService.commitAndPush({ ...options, projectPath })
      } finally {
        gitDirtyStateService.invalidateProjectPath(projectPath)
      }
    }
  )

  ipcMain.handle(
    'workspaceSync:gitCaptureCheckpoint',
    async (
      _event,
      options: {
        workspaceId: string
        checkpointId: string
        authorName: string
        authorEmail?: string
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.captureCheckpoint({
        cwd,
        checkpointId: options.checkpointId,
        authorName: options.authorName,
        authorEmail: options.authorEmail,
      })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitDiffCheckpoints',
    async (
      _event,
      options: {
        workspaceId: string
        fromCheckpointId?: string | null
        toCheckpointId: string
        filePath?: string
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.diffCheckpoints({
        cwd,
        fromCheckpointId: options.fromCheckpointId,
        toCheckpointId: options.toCheckpointId,
        filePath: options.filePath,
      })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitReadCheckpointFilePair',
    async (
      _event,
      options: {
        workspaceId: string
        fromCheckpointId?: string | null
        toCheckpointId: string
        filePath: string
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.readCheckpointFilePair({
        cwd,
        fromCheckpointId: options.fromCheckpointId,
        toCheckpointId: options.toCheckpointId,
        filePath: options.filePath,
      })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitDeleteCheckpointRefs',
    async (
      _event,
      options: {
        workspaceId: string
        checkpointIds: string[]
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.deleteCheckpointRefs({
        cwd,
        checkpointIds: options.checkpointIds,
      })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitDeleteAllCheckpointRefs',
    async (
      _event,
      options: {
        workspaceId: string
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.deleteAllCheckpointRefs({ cwd })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitGetHeadDiffStats',
    async (
      _event,
      options: {
        workspaceId: string
        authorName?: string
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.getHeadDiffStats({
        cwd,
        authorName: options.authorName,
      })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitListChanges',
    async (
      _event,
      options: {
        workspaceId: string
        scope: 'current' | 'branch'
        authorName?: string
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.listChanges({
        cwd,
        scope: options.scope,
        authorName: options.authorName,
      })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitReadChangesPatch',
    async (
      _event,
      options: {
        workspaceId: string
        scope: 'current' | 'branch'
        filePath?: string
        authorName?: string
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.readChangesPatch({
        cwd,
        scope: options.scope,
        filePath: options.filePath,
        authorName: options.authorName,
      })
    }
  )

  ipcMain.handle(
    'workspaceSync:gitReadChanges',
    async (
      _event,
      options: {
        workspaceId: string
        scope: 'current' | 'branch'
        authorName?: string
      }
    ) => {
      let cwd: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        cwd = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkpointWorkerClient.readChanges({
        cwd,
        scope: options.scope,
        authorName: options.authorName,
      })
    }
  )

  // ── Git changes subscriptions ────────────────────────────────────────────────
  // The GitChangesBroadcaster registers on 'sync:*' channels; we add workspace-
  // scoped aliases here that resolve workspaceId → projectPath before delegating.

  ipcMain.handle(
    'workspaceSync:subscribeGitChanges',
    async (event, options: { workspaceId: string; scope: GitChangesScope }) => {
      let projectPath: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        projectPath = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        throw e
      }
      const snapshot = await gitDirtyStateService.subscribe(event.sender, {
        projectPath,
        scope: options.scope,
        workspaceId: options.workspaceId,
      })
      // Ensure the returned snapshot has the workspaceId the caller expects
      return { ...snapshot, workspaceId: options.workspaceId }
    }
  )

  ipcMain.handle(
    'workspaceSync:unsubscribeGitChanges',
    (event, options: { workspaceId: string; scope: GitChangesScope }) => {
      // Resolve async; unsubscribe is best-effort
      resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' }).then((access) => {
        const projectPath = access.gitRootPath ?? access.projectRootPath
        gitDirtyStateService.unsubscribe(event.sender, projectPath, options.scope)
      }).catch(() => { /* ignore */ })
      return { success: true }
    }
  )

  ipcMain.handle(
    'workspaceSync:subscribeGitDirtyState',
    async (event, options: { workspaceId: string; authorName?: string }) => {
      let projectPath: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        projectPath = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        throw e
      }
      return gitDirtyStateService.subscribeGitDirtyState(event.sender, {
        projectPath,
        workspaceId: options.workspaceId,
        authorName: options.authorName,
      })
    }
  )

  ipcMain.handle(
    'workspaceSync:unsubscribeGitDirtyState',
    (event, options: { workspaceId: string }) => {
      resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' }).then((access) => {
        const projectPath = access.gitRootPath ?? access.projectRootPath
        gitDirtyStateService.unsubscribeGitDirtyState(event.sender, projectPath)
      }).catch(() => { /* ignore */ })
      return { success: true }
    }
  )

  ipcMain.handle(
    'workspaceSync:mergePreview',
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
    'workspaceSync:mergeTreePreview',
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
    'workspaceSync:enqueueOps',
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
    'workspaceSync:ackOps',
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
    'workspaceSync:getJournalState',
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
