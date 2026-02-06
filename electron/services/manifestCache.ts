import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export interface CachedEntry {
  path: string
  hash: string
  size: number
  mtime: number
}

export interface ManifestCacheState {
  projectPath: string
  updatedAt: number
  entries: Record<string, CachedEntry>
  dirMtimes?: Record<string, number>
}

const cacheByProjectPath = new Map<string, ManifestCacheState>()
const dirtyPathsByProject = new Map<string, Set<string>>()

function getCacheDir(): string {
  return path.join(app.getPath('userData'), 'manifest-cache')
}

function getCacheKey(projectPath: string): string {
  return createHash('sha1').update(projectPath).digest('hex')
}

function getCacheFilePath(projectPath: string): string {
  const fileName = `${getCacheKey(projectPath)}.json`
  return path.join(getCacheDir(), fileName)
}

function ensureCacheDir(): void {
  const dir = getCacheDir()
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true })
  }
}

function isManifestCacheState(value: unknown): value is ManifestCacheState {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  return (
    typeof record.projectPath === 'string' &&
    typeof record.updatedAt === 'number' &&
    typeof record.entries === 'object'
  )
}

export function loadManifestCache(projectPath: string): ManifestCacheState | null {
  const cached = cacheByProjectPath.get(projectPath)
  if (cached) return cached

  try {
    const cachePath = getCacheFilePath(projectPath)
    if (!fs.existsSync(cachePath)) return null
    const raw = fs.readFileSync(cachePath, 'utf-8')
    const parsed = JSON.parse(raw)
    if (!isManifestCacheState(parsed)) return null
    if (parsed.projectPath !== projectPath) return null
    cacheByProjectPath.set(projectPath, parsed)
    return parsed
  } catch {
    return null
  }
}

export function saveManifestCache(
  projectPath: string,
  entries: Record<string, CachedEntry>,
  dirMtimes?: Record<string, number>
): ManifestCacheState {
  const state: ManifestCacheState = {
    projectPath,
    updatedAt: Date.now(),
    entries,
    dirMtimes,
  }

  cacheByProjectPath.set(projectPath, state)

  try {
    ensureCacheDir()
    const cachePath = getCacheFilePath(projectPath)
    fs.writeFileSync(cachePath, JSON.stringify(state))
  } catch {
    // Non-fatal: cache is optional
  }

  return state
}

export function clearManifestCache(projectPath: string): void {
  cacheByProjectPath.delete(projectPath)
  try {
    const cachePath = getCacheFilePath(projectPath)
    if (fs.existsSync(cachePath)) fs.unlinkSync(cachePath)
  } catch {
    // ignore
  }
}

export function markManifestDirtyPath(projectPath: string, relPath: string): void {
  const normalized = relPath.replace(/\\/g, '/')
  let set = dirtyPathsByProject.get(projectPath)
  if (!set) {
    set = new Set<string>()
    dirtyPathsByProject.set(projectPath, set)
  }
  set.add(normalized)
}

export function consumeManifestDirtyPaths(projectPath: string): string[] {
  const set = dirtyPathsByProject.get(projectPath)
  if (!set || set.size === 0) return []
  dirtyPathsByProject.delete(projectPath)
  return Array.from(set)
}
