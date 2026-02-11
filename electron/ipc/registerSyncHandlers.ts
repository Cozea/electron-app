import { app, type IpcMain } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'

import type { FileManifestEntry } from '../../shared/electronApiTypes'
import { getGitRuntimeHealth, mergeTextWithGit, mergeTreeWithGit } from '../gitRuntime'
import { resolvePathWithinDirectory } from '../pathUtils'
import { markInternalFsChange } from '../projectWatcher'
import {
  loadManifestCache,
  saveManifestCache,
  consumeManifestDirtyPaths,
} from '../services/manifestCache'
import {
  EXCLUDED_GENERATED_DIRECTORIES,
  shouldExcludeGeneratedFile,
} from '../services/generatedArtifactFilters'
import {
  acknowledgeSyncOps,
  enqueueSyncOps,
  getReplicaStateSnapshot,
  getSyncHistory,
  mergeCacheDelete,
  mergeCacheGet,
  mergeCacheGetResolvedConflict,
  mergeCachePrune,
  mergeCacheSaveResolvedConflict,
  mergeCacheSet,
  normalizeSyncPath,
  setSyncHistory,
  type ConflictResolutionPayload,
  type MergeCacheRecordPayload,
  type SyncHistoryPayload,
  type SyncOpRecord,
} from '../services/syncReplicaStore'
import { getManifestFromWorker, getManifestFromWorkerIncremental } from '../workers/fileOpsManager'
import { notifyFileChanged, notifyFileDeleted, notifyFileMetaChanged } from '../yjsNotify'

interface LocalManifestResult {
  manifest: FileManifestEntry[]
  totalFiles: number
}

function sha256Hex(content: Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

const localManifestRequests = new Map<string, Promise<LocalManifestResult>>()
let localManifestRequestCounter = 0

function buildManifestRequestKey(
  projectPath: string,
  excludePatterns?: string[],
  strict?: boolean
): string {
  const normalizedExcludes = [...(excludePatterns ?? [])]
    .map((value) => value.trim().toLowerCase())
    .filter(Boolean)
    .sort()
  return `${projectPath}::${strict ? 'strict' : 'lenient'}::${normalizedExcludes.join(',')}`
}

function getConflictResolutionPath(): string {
  return path.join(app.getPath('userData'), 'sync-conflict-resolutions.json')
}

export function registerSyncHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    'sync:hashFile',
    async (_event, { filePath }: { filePath: string }): Promise<{ hash: string; size: number }> => {
      const content = fs.readFileSync(filePath)
      const hash = sha256Hex(content)

      return { hash, size: content.length }
    }
  )

  ipcMain.handle(
    'sync:getLocalManifest',
    async (
      _event,
      {
        projectPath,
        excludePatterns,
        debugSource,
        strict,
      }: {
        projectPath: string
        excludePatterns?: string[]
        debugSource?: string
        strict?: boolean
      }
    ): Promise<LocalManifestResult> => {
      const requestId = `manifest-${++localManifestRequestCounter}-${Date.now().toString(36)}`
      const source = debugSource?.trim() || 'unknown'
      const startedAt = Date.now()
      const logPrefix = `[SyncManifest:${requestId}]`
      const requestKey = buildManifestRequestKey(projectPath, excludePatterns, strict)
      console.log(`${logPrefix} start`, {
        source,
        projectPath,
        excludeCount: excludePatterns?.length ?? 0,
        strict: strict === true,
      })

      const inFlight = localManifestRequests.get(requestKey)
      if (inFlight) {
        console.log(`${logPrefix} joining in-flight request`, { source, projectPath })
        try {
          const result = await inFlight
          console.log(`${logPrefix} in-flight request resolved`, {
            source,
            totalFiles: result.totalFiles,
            durationMs: Date.now() - startedAt,
          })
          return result
        } catch (error) {
          console.warn(`${logPrefix} in-flight request failed`, {
            source,
            durationMs: Date.now() - startedAt,
            error: error instanceof Error ? error.message : String(error),
          })
          throw error
        }
      }

      const manifestTask = (async (): Promise<LocalManifestResult> => {
        let resolutionPath:
          | 'dirty-path-cache-update'
          | 'worker-incremental'
          | 'worker-full'
          | 'main-thread' = 'main-thread'
        const cached = loadManifestCache(projectPath)
        const dirtyPaths = consumeManifestDirtyPaths(projectPath)
        const hasLegacyHashes = cached
          ? Object.values(cached.entries).some((entry) => entry.hash.length !== 64)
          : false

        if (cached && !hasLegacyHashes && dirtyPaths.length > 0 && dirtyPaths.length <= 1000) {
          console.log(`${logPrefix} using dirty-path cache update`, {
            source,
            dirtyPathCount: dirtyPaths.length,
          })
          resolutionPath = 'dirty-path-cache-update'
          const updatedEntries = { ...cached.entries }

          for (const relPath of dirtyPaths) {
            const fullPath = path.join(projectPath, relPath)
            if (!fs.existsSync(fullPath)) {
              delete updatedEntries[relPath]
              continue
            }

            try {
              const stats = fs.statSync(fullPath)
              if (!stats.isFile()) {
                delete updatedEntries[relPath]
                continue
              }
              const content = fs.readFileSync(fullPath)
              const hash = sha256Hex(content)
              updatedEntries[relPath] = {
                path: relPath,
                hash,
                size: stats.size,
                mtime: stats.mtimeMs,
              }
            } catch (error) {
              if (strict) {
                throw error
              }
              delete updatedEntries[relPath]
            }
          }

          saveManifestCache(projectPath, updatedEntries, cached.dirMtimes)
          const manifest = Object.values(updatedEntries)
          console.log(`${logPrefix} dirty-path cache update complete`, {
            source,
            totalFiles: manifest.length,
          })
          return { manifest, totalFiles: manifest.length }
        }

        let workerResult:
          | {
              manifest: FileManifestEntry[]
              totalFiles: number
              dirMtimes: Record<string, number>
            }
          | null = null

        try {
          const incrementalStartedAt = Date.now()
          console.log(`${logPrefix} worker incremental manifest attempt`, { source })
          workerResult = await getManifestFromWorkerIncremental(
            projectPath,
            excludePatterns,
            strict,
            cached?.entries,
            cached?.dirMtimes
          )
          resolutionPath = 'worker-incremental'
          console.log(`${logPrefix} worker incremental manifest success`, {
            source,
            totalFiles: workerResult.totalFiles,
            durationMs: Date.now() - incrementalStartedAt,
          })
        } catch (error) {
          console.warn(`${logPrefix} worker incremental manifest failed`, {
            source,
            error: error instanceof Error ? error.message : String(error),
          })
          try {
            const fullWorkerStartedAt = Date.now()
            console.log(`${logPrefix} worker full manifest attempt`, { source })
            workerResult = await getManifestFromWorker(projectPath, excludePatterns, strict)
            resolutionPath = 'worker-full'
            console.log(`${logPrefix} worker full manifest success`, {
              source,
              totalFiles: workerResult.totalFiles,
              durationMs: Date.now() - fullWorkerStartedAt,
            })
          } catch (workerError) {
            console.warn(`${logPrefix} worker full manifest failed; using main thread fallback`, {
              source,
              error: workerError instanceof Error ? workerError.message : String(workerError),
            })
          }
        }

        if (workerResult) {
          const entries: Record<string, FileManifestEntry> = {}
          for (const entry of workerResult.manifest) {
            entries[entry.path] = entry
          }
          saveManifestCache(projectPath, entries, workerResult.dirMtimes)
          console.log(`${logPrefix} manifest resolved`, {
            source,
            resolutionPath,
            totalFiles: workerResult.totalFiles,
          })
          return { manifest: workerResult.manifest, totalFiles: workerResult.totalFiles }
        }

        const defaultExcludes = ['.git', ...EXCLUDED_GENERATED_DIRECTORIES]
        const excludes = new Set(
          [...defaultExcludes, ...(excludePatterns || [])].map((name) => name.toLowerCase())
        )
        const previousByPath = cached?.entries ? new Map(Object.entries(cached.entries)) : null

        const manifest: FileManifestEntry[] = []
        console.log(`${logPrefix} main-thread manifest generation start`, { source })

        function walkDir(dir: string, relativePath = '') {
          if (!fs.existsSync(dir)) return

          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (entry.isSymbolicLink()) continue

            if (excludes.has(entry.name.toLowerCase())) continue
            if (entry.name.startsWith('.') && entry.name !== '.env.example') continue

            const relPath = path.join(relativePath, entry.name)
            const fullPath = path.join(dir, entry.name)

            if (entry.isDirectory()) {
              walkDir(fullPath, relPath)
            } else if (entry.isFile()) {
              try {
                const stats = fs.statSync(fullPath)
                const normalizedPath = relPath.replace(/\\/g, '/')
                if (shouldExcludeGeneratedFile(normalizedPath)) {
                  continue
                }
                const previous = previousByPath?.get(normalizedPath)

                if (
                  previous &&
                  previous.hash.length === 64 &&
                  previous.mtime === stats.mtimeMs &&
                  previous.size === stats.size
                ) {
                  manifest.push({
                    path: normalizedPath,
                    hash: previous.hash,
                    size: stats.size,
                    mtime: stats.mtimeMs,
                  })
                  continue
                }

                const content = fs.readFileSync(fullPath)
                const hash = sha256Hex(content)

                manifest.push({
                  path: normalizedPath,
                  hash,
                  size: stats.size,
                  mtime: stats.mtimeMs,
                })
              } catch (error) {
                if (strict) {
                  throw error
                }
                console.warn(`[Sync] Could not read file: ${fullPath}`, error)
              }
            }
          }
        }

        if (fs.existsSync(projectPath)) {
          walkDir(projectPath)
        }

        console.log(`${logPrefix} main-thread manifest generation complete`, {
          source,
          totalFiles: manifest.length,
        })
        const entries: Record<string, FileManifestEntry> = {}
        for (const entry of manifest) {
          entries[entry.path] = entry
        }
        saveManifestCache(projectPath, entries, cached?.dirMtimes)
        return { manifest, totalFiles: manifest.length }
      })()

      localManifestRequests.set(requestKey, manifestTask)
      try {
        const result = await manifestTask
        console.log(`${logPrefix} completed`, {
          source,
          totalFiles: result.totalFiles,
          durationMs: Date.now() - startedAt,
        })
        return result
      } catch (error) {
        console.warn(`${logPrefix} failed`, {
          source,
          durationMs: Date.now() - startedAt,
          error: error instanceof Error ? error.message : String(error),
        })
        throw error
      } finally {
        if (localManifestRequests.get(requestKey) === manifestTask) {
          localManifestRequests.delete(requestKey)
        }
      }
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
    'sync:resolveConflict',
    async (
      _event,
      { fingerprint, resolvedContent }: { fingerprint: string; resolvedContent: string }
    ): Promise<{ success: boolean; error?: string }> => {
      if (!fingerprint || typeof resolvedContent !== 'string') {
        return { success: false, error: 'Invalid conflict resolution payload' }
      }
      try {
        const filePath = getConflictResolutionPath()
        const existing = fs.existsSync(filePath)
          ? (JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<
              string,
              {
                resolvedContent: string
                updatedAt: number
              }
            >)
          : {}
        existing[fingerprint] = {
          resolvedContent,
          updatedAt: Date.now(),
        }
        fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8')
        mergeCacheSaveResolvedConflict({
          fingerprint,
          resolvedContent,
          createdAt: Date.now(),
          lastUsedAt: Date.now(),
          hitCount: 0,
        })
        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to persist conflict resolution',
        }
      }
    }
  )

  ipcMain.handle(
    'sync:mergeCacheGet',
    async (_event, { key }: { key: string }): Promise<MergeCacheRecordPayload | null> => {
      return mergeCacheGet(String(key))
    }
  )

  ipcMain.handle(
    'sync:mergeCacheSet',
    async (_event, { record }: { record: MergeCacheRecordPayload }): Promise<{ success: boolean }> => {
      return { success: mergeCacheSet(record) }
    }
  )

  ipcMain.handle(
    'sync:mergeCacheDelete',
    async (_event, { key }: { key: string }): Promise<{ success: boolean }> => {
      return { success: mergeCacheDelete(String(key)) }
    }
  )

  ipcMain.handle(
    'sync:mergeCacheGetResolved',
    async (_event, { fingerprint }: { fingerprint: string }): Promise<ConflictResolutionPayload | null> => {
      return mergeCacheGetResolvedConflict(String(fingerprint))
    }
  )

  ipcMain.handle(
    'sync:mergeCacheSaveResolved',
    async (_event, { record }: { record: ConflictResolutionPayload }): Promise<{ success: boolean }> => {
      return { success: mergeCacheSaveResolvedConflict(record) }
    }
  )

  ipcMain.handle(
    'sync:mergeCachePrune',
    async (
      _event,
      { threshold, maxEntries }: { threshold: number; maxEntries?: number }
    ): Promise<{ removed: number }> => {
      return mergeCachePrune(Number(threshold) || 0, maxEntries)
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
      replicaState: {
        projectId: string
        replicaHead: number
        pendingOps: number
        lastAckedAt: number | null
        ackedOps: number
        pathHeads: Record<string, string>
        lastStateVector: number
        lastPersistedAt: number | null
      }
    }> => {
      return enqueueSyncOps(String(projectId), Array.isArray(ops) ? ops : [])
    }
  )

  ipcMain.handle(
    'sync:ackOps',
    async (
      _event,
      { projectId, opIds }: { projectId: string; opIds: string[] }
    ): Promise<{
      acked: number
      replicaState: {
        projectId: string
        replicaHead: number
        pendingOps: number
        lastAckedAt: number | null
        ackedOps: number
        pathHeads: Record<string, string>
        lastStateVector: number
        lastPersistedAt: number | null
      }
    }> => {
      return acknowledgeSyncOps(String(projectId), Array.isArray(opIds) ? opIds : [])
    }
  )

  ipcMain.handle(
    'sync:getReplicaState',
    async (
      _event,
      { projectId }: { projectId: string }
    ): Promise<{
      projectId: string
      replicaHead: number
      pendingOps: number
      lastAckedAt: number | null
      ackedOps: number
      pathHeads: Record<string, string>
      lastStateVector: number
      lastPersistedAt: number | null
    }> => {
      return getReplicaStateSnapshot(String(projectId))
    }
  )

  ipcMain.handle(
    'sync:getHistory',
    async (_event, { projectId }: { projectId: string }): Promise<SyncHistoryPayload> => {
      return getSyncHistory(String(projectId))
    }
  )

  ipcMain.handle(
    'sync:setHistory',
    async (
      _event,
      {
        projectId,
        lastSyncAt,
        cloudPaths,
      }: {
        projectId: string
        lastSyncAt: number
        cloudPaths: string[]
      }
    ): Promise<SyncHistoryPayload> => {
      return setSyncHistory(String(projectId), {
        lastSyncAt: Number(lastSyncAt) || Date.now(),
        cloudPaths: Array.isArray(cloudPaths) ? cloudPaths : [],
      })
    }
  )
}
