import { type IpcMain } from 'electron'
import * as Effect from 'effect/Effect'
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization'
import { WorkspaceCatalog } from '../workspaces/WorkspaceCatalog'
import { waitForWorkspaceCatalogRuntime } from '../workspaces/WorkspaceCatalogRuntime'

import { createHash } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import path from 'node:path'

import { getGitRuntimeHealth, mergeTextWithGit, mergeTreeWithGit } from '../gitRuntime'
import { resolvePathWithinDirectory } from '../pathUtils'
import { GitChangesBroadcaster } from '../services/GitChangesBroadcaster'
import { CheckpointWorkerClient } from '../services/CheckpointWorkerClient'
import { getSharedProjectdClient } from '../projectd/ProjectdClient'
import type { GitChangesScope } from '../../../../shared/electronApiTypes'
import { bootstrapSubstrateVcs } from '../substrate/vcs/bootstrap'

function sha256Hex(content: Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

/**
 * Lightweight project-path resolution for subscription cleanup.
 *
 * Unlike {@link resolveAuthorizedWorkspaceAccess}, this does NOT run the
 * workspace verification pipeline (catalog.verify). Cleanup must succeed even
 * when the workspace can no longer be verified (e.g. its folder moved), so we
 * read the stored lane path directly instead of gating on authorization. Used
 * only to recover the projectPath that git-change subscriptions are keyed by.
 */
async function resolveWorkspaceGitPathForCleanup(
  workspaceId: string,
  laneId?: string | null,
): Promise<string | null> {
  const rt = await waitForWorkspaceCatalogRuntime()
  return rt.runPromise(
    Effect.gen(function* () {
      const catalog = yield* Effect.service(WorkspaceCatalog)
      const workspace = yield* catalog.getById(workspaceId)
      if (!workspace) {
        return null
      }
      const lane = yield* catalog.getLane(workspaceId, laneId)
      if (!lane) {
        return null
      }
      return lane.gitRootPath ?? lane.projectRootPath
    }),
  )
}




export function registerWorkspaceSyncHandlers(ipcMain: IpcMain): void {
  // Phase 4: register Changes checkpoint facade + shared status invalidation bus.
  bootstrapSubstrateVcs()

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
        opMeta: _opMeta,
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
      } catch {
        return { results: [], successCount: 0 }
      }
      const results: Array<{ path: string; success: boolean; error?: string }> = []

      for (const file of files) {
        try {
          const fullPath = resolvePathWithinDirectory(projectRootPath, file.path)
          const dir = path.dirname(fullPath)

          await mkdir(dir, { recursive: true })

          const bytes =
            file.encoding === 'base64'
              ? Buffer.from(file.content, 'base64')
              : Buffer.from(file.content, 'utf-8')
          if (file.encoding === 'base64') {
            await writeFile(fullPath, bytes)
          } else {
            await writeFile(fullPath, file.content, 'utf-8')
          }
          results.push({ path: file.path, success: true })
        } catch (error) {
          const errorMsg = error instanceof Error ? error.message : 'Unknown error'
          results.push({ path: file.path, success: false, error: errorMsg })
          console.error(`[Sync] Failed to write file: ${file.path}`, error)
        }
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
      } catch {
        return { results: [] }
      }
      const results: Array<{ path: string; success: boolean }> = []

      for (const relPath of paths) {
        try {
          const fullPath = resolvePathWithinDirectory(projectRootPath, relPath)
          try {
            await unlink(fullPath)
          } catch (unlinkErr) {
            const code = (unlinkErr as NodeJS.ErrnoException)?.code
            if (code !== 'ENOENT') {
              throw unlinkErr
            }
          }
          results.push({ path: relPath, success: true })
        } catch (error) {
          console.error(`[Sync] Failed to delete file: ${relPath}`, error)
          results.push({ path: relPath, success: false })
        }
      }

      return { results }
    }
  )

  ipcMain.handle('workspaceSync:getGitRuntimeHealth', async (_event, { force = false }: { force?: boolean }) => {
    return getGitRuntimeHealth(Boolean(force))
  })



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
      let hasKnownGit = false
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
        projectPath = access.gitRootPath ?? access.projectRootPath
        hasKnownGit = Boolean(access.gitRootPath)
      } catch (e) {
        return {
          success: false,
          isRepo: false,
          hasOriginRemote: false,
          branch: null,
          upstream: null,
          ahead: 0,
          behind: 0,
          clean: true,
          files: [],
          error: String(e),
        }
      }
      try {
        const client = getSharedProjectdClient()
        const status = await client.gitStatus(projectPath)
        const isRepo = hasKnownGit || Boolean(!status.isUnborn || (status.files && status.files.length > 0) || status.headOid)
        return {
          success: true,
          isRepo,
          hasOriginRemote: Boolean(status.upstream?.startsWith('origin/')),
          branch: status.headRef,
          upstream: status.upstream,
          ahead: status.ahead ?? 0,
          behind: status.behind ?? 0,
          clean: status.clean ?? true,
          files: (status.files ?? []).map((f: any) => ({
            path: f.path,
            status: f.isConflicted ? 'conflicted' : f.isUntracked ? 'untracked' : f.isStaged ? 'staged' : 'modified',
            staged: Boolean(f.isStaged),
          })),
        }
      } catch (err: any) {
        return {
          success: false,
          isRepo: hasKnownGit,
          hasOriginRemote: false,
          branch: null,
          upstream: null,
          ahead: 0,
          behind: 0,
          clean: true,
          files: [],
          error: err?.message ?? 'Failed to get git status through canonical GitService',
        }
      }
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

  // ── Git changes subscriptions ────────────────────────────────────────────────
  // Keep git-change subscriptions on the workspace-scoped API. Older raw
  // `sync:*` IPC channels are intentionally not registered from the renderer.

  ipcMain.handle(
    'workspaceSync:subscribeGitChanges',
    async (event, options: { workspaceId: string; scope: GitChangesScope }) => {
      const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
      const projectPath = access.gitRootPath ?? access.projectRootPath
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
      // Resolve async; unsubscribe is best-effort. Use the lightweight path
      // resolver (no verification) so cleanup still fires when the workspace can
      // no longer be verified (e.g. moved folder) rather than silently leaking
      // the subscription until sender destruction.
      resolveWorkspaceGitPathForCleanup(options.workspaceId).then((projectPath) => {
        if (projectPath) {
          gitDirtyStateService.unsubscribe(event.sender, projectPath, options.scope)
        }
      }).catch(() => { /* ignore */ })
      return { success: true }
    }
  )

  ipcMain.handle(
    'workspaceSync:subscribeGitDirtyState',
    async (event, options: { workspaceId: string; authorName?: string }) => {
      const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-read' })
      const projectPath = access.gitRootPath ?? access.projectRootPath
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
      // Best-effort cleanup via the lightweight path resolver (no verification),
      // so a moved/unverifiable workspace still unsubscribes its dirty-state
      // listener rather than leaking until sender destruction.
      resolveWorkspaceGitPathForCleanup(options.workspaceId).then((projectPath) => {
        if (projectPath) {
          gitDirtyStateService.unsubscribeGitDirtyState(event.sender, projectPath)
        }
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
}
