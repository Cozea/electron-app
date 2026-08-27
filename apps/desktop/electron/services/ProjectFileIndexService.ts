import fs from 'node:fs'
import path from 'node:path'

import type { ListFilesResult } from '../../../../shared/electronApiTypes'
import {
  EXCLUDED_GENERATED_DIRECTORIES,
  shouldExcludeGeneratedDirectory,
  shouldExcludeGeneratedFile,
} from './generatedArtifactFilters'

interface ProjectFileIndexEntry {
  projectPath: string
  filesByPath: Map<string, { path: string; sizeBytes: number }>
  builtAt: number
  lastAccessedAt: number
  stale: boolean
  buildPromise: Promise<ListFilesResult> | null
}

interface FileMetaChangeInput {
  filePath: string
  isDirectory?: boolean
  sizeBytes: number
}

const MAX_FILES = 20_000
const YIELD_EVERY_VISITED_ENTRIES = 250
const CACHE_FRESH_MS = 30_000
const MAX_CACHE_ENTRIES = 12

const fileIndexesByProjectPath = new Map<string, ProjectFileIndexEntry>()

function normalizeProjectPath(projectPath: string): string {
  return path.resolve(projectPath)
}

function normalizeRelativePath(relativePath: string): string {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function isPathInsideProject(projectPath: string, filePath: string): boolean {
  const relativePath = path.relative(projectPath, filePath)
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

function resolveRelativeProjectPath(projectPath: string, filePath: string): string | null {
  const relativePath = path.relative(projectPath, filePath)
  if (!relativePath || relativePath.startsWith('..') || path.isAbsolute(relativePath)) {
    return null
  }

  return normalizeRelativePath(relativePath)
}

function shouldExcludeDirectoryName(name: string): boolean {
  return name === '.git' || shouldExcludeGeneratedDirectory(name)
}

function shouldExcludeRelativePath(relativePath: string): boolean {
  const normalizedPath = normalizeRelativePath(relativePath)
  const pathSegments = normalizedPath.split('/')
  return (
    pathSegments.some(shouldExcludeDirectoryName) ||
    shouldExcludeGeneratedFile(normalizedPath)
  )
}

function createEmptyEntry(projectPath: string): ProjectFileIndexEntry {
  const now = Date.now()
  return {
    projectPath,
    filesByPath: new Map(),
    builtAt: 0,
    lastAccessedAt: now,
    stale: true,
    buildPromise: null,
  }
}

function getOrCreateEntry(projectPath: string): ProjectFileIndexEntry {
  const resolvedProjectPath = normalizeProjectPath(projectPath)
  const existing = fileIndexesByProjectPath.get(resolvedProjectPath)
  if (existing) {
    existing.lastAccessedAt = Date.now()
    return existing
  }

  const entry = createEmptyEntry(resolvedProjectPath)
  fileIndexesByProjectPath.set(resolvedProjectPath, entry)
  pruneLeastRecentlyUsedIndexes()
  return entry
}

function listCachedFiles(entry: ProjectFileIndexEntry): Array<{ path: string; sizeBytes: number }> {
  return Array.from(entry.filesByPath.values()).sort((left, right) => left.path.localeCompare(right.path))
}

function isCacheFresh(entry: ProjectFileIndexEntry): boolean {
  return !entry.stale && Date.now() - entry.builtAt <= CACHE_FRESH_MS
}

function pruneLeastRecentlyUsedIndexes(): void {
  if (fileIndexesByProjectPath.size <= MAX_CACHE_ENTRIES) return

  const entriesByAccessTime = Array.from(fileIndexesByProjectPath.values()).sort(
    (left, right) => left.lastAccessedAt - right.lastAccessedAt,
  )

  for (const entry of entriesByAccessTime) {
    if (fileIndexesByProjectPath.size <= MAX_CACHE_ENTRIES) return
    if (entry.buildPromise) continue
    fileIndexesByProjectPath.delete(entry.projectPath)
  }
}

async function buildProjectFileIndex(entry: ProjectFileIndexEntry): Promise<ListFilesResult> {
  const filesByPath = new Map<string, { path: string; sizeBytes: number }>()
  const skippedDirectories = new Set(['.git', ...EXCLUDED_GENERATED_DIRECTORIES])
  const queue: Array<{ dir: string; relativePath: string }> = [
    { dir: entry.projectPath, relativePath: '' },
  ]
  let visitedEntries = 0

  while (queue.length > 0 && filesByPath.size < MAX_FILES) {
    const current = queue.shift()
    if (!current) break

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(current.dir, { withFileTypes: true })
    } catch {
      continue
    }

    for (const dirent of entries) {
      if (filesByPath.size >= MAX_FILES) break
      if (dirent.isSymbolicLink()) continue

      const relativePath = normalizeRelativePath(path.join(current.relativePath, dirent.name))
      const fullPath = path.join(current.dir, dirent.name)
      const nameLower = dirent.name.toLowerCase()
      visitedEntries += 1

      if (dirent.isDirectory()) {
        if (!skippedDirectories.has(nameLower)) {
          queue.push({ dir: fullPath, relativePath })
        }
      } else {
        if (shouldExcludeGeneratedFile(relativePath)) {
          continue
        }
        try {
          const stats = await fs.promises.stat(fullPath)
          if (stats.isFile()) {
            filesByPath.set(relativePath, { path: relativePath, sizeBytes: stats.size })
          }
        } catch {
          continue
        }
      }

      if (visitedEntries % YIELD_EVERY_VISITED_ENTRIES === 0) {
        await new Promise<void>((resolve) => setImmediate(resolve))
      }
    }
  }

  entry.filesByPath = filesByPath
  entry.builtAt = Date.now()
  entry.lastAccessedAt = entry.builtAt
  entry.stale = false

  return {
    success: true,
    files: listCachedFiles(entry),
  }
}

export async function listProjectFilesFromIndex(projectPath: string): Promise<ListFilesResult> {
  const entry = getOrCreateEntry(projectPath)

  if (isCacheFresh(entry)) {
    return {
      success: true,
      files: listCachedFiles(entry),
    }
  }

  if (entry.buildPromise) {
    return entry.buildPromise
  }

  entry.buildPromise = buildProjectFileIndex(entry)
    .catch((error) => ({
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error',
    }))
    .finally(() => {
      entry.buildPromise = null
    })

  return entry.buildPromise
}

export function markProjectFileIndexStale(projectPath: string): void {
  const resolvedProjectPath = normalizeProjectPath(projectPath)
  const entry = fileIndexesByProjectPath.get(resolvedProjectPath)
  if (entry) {
    entry.stale = true
  }
}

export function applyProjectFileMetaChangeToIndex(input: FileMetaChangeInput): void {
  const resolvedFilePath = path.resolve(input.filePath)

  for (const entry of fileIndexesByProjectPath.values()) {
    if (!isPathInsideProject(entry.projectPath, resolvedFilePath)) continue

    const relativePath = resolveRelativeProjectPath(entry.projectPath, resolvedFilePath)
    if (!relativePath) continue

    entry.lastAccessedAt = Date.now()

    if (input.isDirectory) {
      entry.stale = true
      continue
    }

    if (shouldExcludeRelativePath(relativePath)) {
      entry.filesByPath.delete(relativePath)
      continue
    }

    entry.filesByPath.set(relativePath, {
      path: relativePath,
      sizeBytes: input.sizeBytes,
    })
    entry.builtAt = Date.now()
    entry.stale = false
  }
}

export function applyProjectFileDeleteToIndex(filePath: string): void {
  const resolvedFilePath = path.resolve(filePath)

  for (const entry of fileIndexesByProjectPath.values()) {
    if (!isPathInsideProject(entry.projectPath, resolvedFilePath)) continue

    const relativePath = resolveRelativeProjectPath(entry.projectPath, resolvedFilePath)
    if (!relativePath) continue

    const directoryPrefix = `${relativePath}/`
    entry.filesByPath.delete(relativePath)
    for (const cachedPath of entry.filesByPath.keys()) {
      if (cachedPath.startsWith(directoryPrefix)) {
        entry.filesByPath.delete(cachedPath)
      }
    }
    entry.builtAt = Date.now()
    entry.lastAccessedAt = entry.builtAt
    entry.stale = false
  }
}

export function clearProjectFileIndexesForTests(): void {
  fileIndexesByProjectPath.clear()
}
