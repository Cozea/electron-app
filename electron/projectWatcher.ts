import fs from 'node:fs'
import path from 'node:path'
import { notifyFileChanged, notifyFileDeleted } from './yjsNotify'
import { markManifestDirtyPath } from './services/manifestCache'

const INTERNAL_IGNORE_MS = 1500
const PROCESS_DEBOUNCE_MS = 200
const MAX_TEXT_FILE_BYTES = 2 * 1024 * 1024 // 2MB

const DEFAULT_EXCLUDED_DIRS = new Set([
  'node_modules',
  '.git',
  'dist',
  'build',
  '.next',
  'coverage',
  '__pycache__',
  '.turbo',
  '.cache',
  '.vite',
])

const BINARY_EXTENSIONS = new Set([
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'ico',
  'bmp',
  'tif',
  'tiff',
  'pdf',
  'zip',
  'gz',
  'tar',
  'rar',
  '7z',
  'mp3',
  'wav',
  'ogg',
  'mp4',
  'mov',
  'avi',
  'webm',
  'ttf',
  'otf',
  'woff',
  'woff2',
  'eot',
  'wasm',
])

function isBinaryPath(filePath: string): boolean {
  const fileName = filePath.split('/').pop() ?? filePath
  const ext = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : ''
  return !!ext && BINARY_EXTENSIONS.has(ext)
}

function normalizeRelativePath(relPath: string): string {
  return relPath.replace(/\\/g, '/')
}

function shouldIgnoreRelativePath(relPath: string): boolean {
  const normalized = normalizeRelativePath(relPath)
  const parts = normalized.split('/')
  return parts.some((segment) => DEFAULT_EXCLUDED_DIRS.has(segment))
}

const internalWriteTimestamps = new Map<string, number>()

export function markInternalFsChange(fullPath: string): void {
  internalWriteTimestamps.set(fullPath, Date.now())
}

function isRecentInternalChange(fullPath: string): boolean {
  const ts = internalWriteTimestamps.get(fullPath)
  if (!ts) return false
  if (Date.now() - ts > INTERNAL_IGNORE_MS) {
    internalWriteTimestamps.delete(fullPath)
    return false
  }
  return true
}

interface ProjectWatchHandle {
  projectPath: string
  refCount: number
  watcherType: 'recursive' | 'manual'
  rootWatcher: fs.FSWatcher | null
  dirWatchers: Map<string, fs.FSWatcher>
  pendingTimers: Map<string, ReturnType<typeof setTimeout>>
}

const watchersByProjectPath = new Map<string, ProjectWatchHandle>()

function scheduleProcess(
  handle: ProjectWatchHandle,
  fullPath: string
): void {
  const existing = handle.pendingTimers.get(fullPath)
  if (existing) clearTimeout(existing)

  const timer = setTimeout(() => {
    handle.pendingTimers.delete(fullPath)
    processPath(handle, fullPath)
  }, PROCESS_DEBOUNCE_MS)

  handle.pendingTimers.set(fullPath, timer)
}

function processPath(handle: ProjectWatchHandle, fullPath: string): void {
  if (isRecentInternalChange(fullPath)) return

  const rel = path.relative(handle.projectPath, fullPath)
  if (!rel || rel.startsWith('..') || path.isAbsolute(rel)) return

  const relNormalized = normalizeRelativePath(rel)
  if (shouldIgnoreRelativePath(relNormalized)) return

  markManifestDirtyPath(handle.projectPath, relNormalized)

  try {
    const stats = fs.statSync(fullPath)
    if (stats.isDirectory()) {
      if (handle.watcherType === 'manual') {
        void ensureDirWatched(handle, fullPath)
      }
      return
    }
    if (!stats.isFile()) return
    if (stats.size > MAX_TEXT_FILE_BYTES) return
    if (isBinaryPath(relNormalized)) return

    const content = fs.readFileSync(fullPath, 'utf-8')
    notifyFileChanged(fullPath, content, { origin: 'external' })
  } catch {
    // Missing path: treat as deletion (rename/remove)
    notifyFileDeleted(fullPath, { origin: 'external' })

    // If a directory was removed, close any nested directory watchers.
    if (handle.watcherType === 'manual') {
      const prefix = `${path.resolve(fullPath)}${path.sep}`
      for (const [dirPath, watcher] of handle.dirWatchers.entries()) {
        if (dirPath === fullPath || dirPath.startsWith(prefix)) {
          try {
            watcher.close()
          } catch {
            // ignore
          }
          handle.dirWatchers.delete(dirPath)
        }
      }
    }
  }
}

function handleWatchEvent(
  handle: ProjectWatchHandle,
  baseDir: string,
  _eventType: string,
  filename: string | null
) {
  if (!filename) return

  const fullPath = path.resolve(baseDir, filename.toString())
  scheduleProcess(handle, fullPath)
}

function walkDirectories(rootDir: string, onDir: (dirPath: string) => void) {
  const stack: string[] = [rootDir]
  while (stack.length > 0) {
    const current = stack.pop()!
    onDir(current)

    let entries: fs.Dirent[]
    try {
      entries = fs.readdirSync(current, { withFileTypes: true })
    } catch {
      continue
    }

    for (const entry of entries) {
      if (!entry.isDirectory()) continue
      if (DEFAULT_EXCLUDED_DIRS.has(entry.name)) continue
      const next = path.join(current, entry.name)
      stack.push(next)
    }
  }
}

async function ensureDirWatched(handle: ProjectWatchHandle, dirPath: string) {
  const resolved = path.resolve(dirPath)
  if (handle.dirWatchers.has(resolved)) return

  try {
    const watcher = fs.watch(resolved, (eventType, filename) => {
      handleWatchEvent(handle, resolved, eventType, filename)
    })
    handle.dirWatchers.set(resolved, watcher)
  } catch {
    // ignore
  }

  // Watch any subdirectories (best-effort)
  walkDirectories(resolved, (subDir) => {
    if (subDir === resolved) return
    if (handle.dirWatchers.has(subDir)) return
    try {
      const subWatcher = fs.watch(subDir, (eventType, filename) => {
        handleWatchEvent(handle, subDir, eventType, filename)
      })
      handle.dirWatchers.set(subDir, subWatcher)
    } catch {
      // ignore
    }
  })
}

function createProjectWatchHandle(projectPath: string): ProjectWatchHandle {
  const resolvedProjectPath = path.resolve(projectPath)

  // Prefer recursive watch when available (macOS/Windows).
  try {
    const handle: ProjectWatchHandle = {
      projectPath: resolvedProjectPath,
      refCount: 1,
      watcherType: 'recursive',
      rootWatcher: null,
      dirWatchers: new Map(),
      pendingTimers: new Map(),
    }

    handle.rootWatcher = fs.watch(
      resolvedProjectPath,
      { recursive: true },
      (eventType, filename) => {
        handleWatchEvent(handle, resolvedProjectPath, eventType, filename)
      }
    )

    return handle
  } catch {
    // Fall back to manual directory watchers.
  }

  const handle: ProjectWatchHandle = {
    projectPath: resolvedProjectPath,
    refCount: 1,
    watcherType: 'manual',
    rootWatcher: null,
    dirWatchers: new Map(),
    pendingTimers: new Map(),
  }

  walkDirectories(resolvedProjectPath, (dirPath) => {
    try {
      const watcher = fs.watch(dirPath, (eventType, filename) => {
        handleWatchEvent(handle, dirPath, eventType, filename)
      })
      handle.dirWatchers.set(path.resolve(dirPath), watcher)
    } catch {
      // ignore
    }
  })

  return handle
}

export function startProjectWatcher(projectPath: string): { success: boolean; error?: string } {
  const resolved = path.resolve(projectPath)

  const existing = watchersByProjectPath.get(resolved)
  if (existing) {
    existing.refCount++
    return { success: true }
  }

  try {
    const stats = fs.statSync(resolved)
    if (!stats.isDirectory()) {
      return { success: false, error: 'Project path is not a directory' }
    }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Project path not found' }
  }

  const handle = createProjectWatchHandle(resolved)
  watchersByProjectPath.set(resolved, handle)
  return { success: true }
}

export function stopProjectWatcher(projectPath: string): { success: boolean; error?: string } {
  const resolved = path.resolve(projectPath)
  const handle = watchersByProjectPath.get(resolved)
  if (!handle) return { success: true }

  handle.refCount = Math.max(0, handle.refCount - 1)
  if (handle.refCount > 0) return { success: true }

  try {
    if (handle.rootWatcher) {
      try {
        handle.rootWatcher.close()
      } catch {
        // ignore
      }
      handle.rootWatcher = null
    }

    for (const watcher of handle.dirWatchers.values()) {
      try {
        watcher.close()
      } catch {
        // ignore
      }
    }
    handle.dirWatchers.clear()

    for (const timer of handle.pendingTimers.values()) {
      clearTimeout(timer)
    }
    handle.pendingTimers.clear()

    watchersByProjectPath.delete(resolved)
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : 'Failed to stop watcher' }
  }
}
