import { useCallback, useEffect, useMemo, useState } from 'react'

import { scanForRoutes, type ScanResult, type ScannedRoute } from '@/utils/routeScanner'

interface StoredFrameworkInfo {
  framework?: string
  devCommand?: string
  devPort?: number
}

interface RouteScanState {
  error: string | null
  framework: ScanResult['framework'] | null
  frameworkDisplayName: string | null
  isLoading: boolean
  lastScannedAt: number | null
  routeConvention: string | null
  routes: ScannedRoute[]
}

interface RouteScanCacheEntry {
  cacheKey: string
  inFlight: Promise<void> | null
  listeners: Set<() => void>
  projectPath: string
  refreshTimerId: number | null
  state: RouteScanState
  storedFrameworkInfo: StoredFrameworkInfo | null
}

interface ProjectWatchRegistration {
  cleanups: Array<() => void>
  count: number
}

interface UseProjectRouteScanOptions {
  enabled?: boolean
  projectPath: string | null
  storedFrameworkInfo?: StoredFrameworkInfo | null
}

interface UseProjectRouteScanResult extends RouteScanState {
  refreshRoutes: () => Promise<void>
}

const DEFAULT_STATE: RouteScanState = {
  error: null,
  framework: null,
  frameworkDisplayName: null,
  isLoading: false,
  lastScannedAt: null,
  routeConvention: null,
  routes: [],
}

const ROUTE_SCAN_REFRESH_DEBOUNCE_MS = 250
const ROUTE_SOURCE_FILE_PATTERN = /\.(astro|jsx|js|tsx|ts|vue|svelte)$/i
const ROUTE_RELEVANT_DIRECTORIES = [
  'app/',
  'src/app/',
  'pages/',
  'src/pages/',
  'routes/',
  'src/routes/',
  'views/',
  'src/views/',
  'components/',
  'src/components/',
]
const ROUTE_RELEVANT_FILES = new Set([
  'package.json',
  'tsconfig.json',
  'vite.config.ts',
  'vite.config.js',
  'next.config.js',
  'next.config.ts',
  'next.config.mjs',
  'nuxt.config.ts',
  'nuxt.config.js',
  'astro.config.mjs',
  'remix.config.js',
  'remix.config.ts',
  'svelte.config.js',
  'svelte.config.ts',
])

const routeScanEntries = new Map<string, RouteScanCacheEntry>()
const watchRegistrations = new Map<string, ProjectWatchRegistration>()

function normalizeProjectPath(projectPath: string): string {
  return projectPath.replace(/\\/g, '/').replace(/\/+$/, '')
}

function buildFrameworkInfoKey(storedFrameworkInfo?: StoredFrameworkInfo | null): string {
  if (!storedFrameworkInfo) return 'none'
  return JSON.stringify({
    devCommand: storedFrameworkInfo.devCommand ?? null,
    devPort: storedFrameworkInfo.devPort ?? null,
    framework: storedFrameworkInfo.framework ?? null,
  })
}

function buildRouteScanCacheKey(projectPath: string, storedFrameworkInfo?: StoredFrameworkInfo | null): string {
  return `${normalizeProjectPath(projectPath)}::${buildFrameworkInfoKey(storedFrameworkInfo)}`
}

function cloneState(state: RouteScanState): RouteScanState {
  return {
    ...state,
    routes: [...state.routes],
  }
}

function getOrCreateRouteScanEntry(
  projectPath: string,
  storedFrameworkInfo?: StoredFrameworkInfo | null,
): RouteScanCacheEntry {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  const cacheKey = buildRouteScanCacheKey(normalizedProjectPath, storedFrameworkInfo)
  const existing = routeScanEntries.get(cacheKey)
  if (existing) {
    existing.storedFrameworkInfo = storedFrameworkInfo ?? null
    return existing
  }

  const entry: RouteScanCacheEntry = {
    cacheKey,
    inFlight: null,
    listeners: new Set(),
    projectPath: normalizedProjectPath,
    refreshTimerId: null,
    state: cloneState(DEFAULT_STATE),
    storedFrameworkInfo: storedFrameworkInfo ?? null,
  }
  routeScanEntries.set(cacheKey, entry)
  return entry
}

function emitRouteScanEntry(entry: RouteScanCacheEntry): void {
  for (const listener of entry.listeners) {
    listener()
  }
}

async function performRouteScan(
  entry: RouteScanCacheEntry,
  options?: { force?: boolean },
): Promise<void> {
  if (entry.inFlight) {
    return entry.inFlight
  }

  if (!options?.force && entry.state.lastScannedAt && entry.state.routes.length > 0) {
    return
  }

  entry.state = {
    ...entry.state,
    error: null,
    isLoading: true,
  }
  emitRouteScanEntry(entry)

  const run = (async () => {
    try {
      const result = await scanForRoutes(entry.projectPath, entry.storedFrameworkInfo)
      entry.state = {
        error: null,
        framework: result.framework,
        frameworkDisplayName: result.frameworkDisplayName,
        isLoading: false,
        lastScannedAt: Date.now(),
        routeConvention: result.routeConvention,
        routes: result.routes,
      }
    } catch (error) {
      entry.state = {
        ...entry.state,
        error: error instanceof Error ? error.message : 'Failed to scan routes.',
        isLoading: false,
      }
    } finally {
      entry.inFlight = null
      emitRouteScanEntry(entry)
    }
  })()

  entry.inFlight = run
  await run
}

function invalidateProjectRouteScans(projectPath: string): void {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  for (const entry of routeScanEntries.values()) {
    if (entry.projectPath !== normalizedProjectPath) continue
    entry.state = {
      ...entry.state,
      error: null,
      lastScannedAt: null,
    }
    emitRouteScanEntry(entry)
  }
}

function scheduleProjectRouteScanRefresh(projectPath: string): void {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  for (const entry of routeScanEntries.values()) {
    if (entry.projectPath !== normalizedProjectPath) continue

    if (entry.refreshTimerId !== null) {
      window.clearTimeout(entry.refreshTimerId)
    }

    entry.refreshTimerId = window.setTimeout(() => {
      entry.refreshTimerId = null
      void performRouteScan(entry, { force: true })
    }, ROUTE_SCAN_REFRESH_DEBOUNCE_MS)
  }
}

function toRelativeProjectPath(projectPath: string, filePath: string): string | null {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  const normalizedFilePath = filePath.replace(/\\/g, '/')
  if (!normalizedFilePath.startsWith(normalizedProjectPath)) return null
  return normalizedFilePath.slice(normalizedProjectPath.length).replace(/^\/+/, '')
}

function isRouteRelevantProjectFile(relativePath: string | null): boolean {
  if (!relativePath) return false
  const normalizedRelativePath = relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
  if (!normalizedRelativePath) return false

  if (ROUTE_RELEVANT_FILES.has(normalizedRelativePath)) {
    return true
  }

  if (ROUTE_SOURCE_FILE_PATTERN.test(normalizedRelativePath)) {
    return ROUTE_RELEVANT_DIRECTORIES.some((segment) => normalizedRelativePath.startsWith(segment))
      || normalizedRelativePath.includes('/components/')
      || normalizedRelativePath.startsWith('components/')
  }

  return false
}

function retainProjectWatchRegistration(projectPath: string): () => void {
  const normalizedProjectPath = normalizeProjectPath(projectPath)
  const existing = watchRegistrations.get(normalizedProjectPath)
  if (existing) {
    existing.count += 1
    return () => releaseProjectWatchRegistration(normalizedProjectPath)
  }

  const handlePotentialRouteChange = (absoluteFilePath: string) => {
    const relativePath = toRelativeProjectPath(normalizedProjectPath, absoluteFilePath)
    if (!isRouteRelevantProjectFile(relativePath)) return
    invalidateProjectRouteScans(normalizedProjectPath)
    scheduleProjectRouteScanRefresh(normalizedProjectPath)
  }

  const cleanups: Array<() => void> = []
  const changeCleanup = window.electronAPI.yjs?.onExternalFileChange?.(({ filePath }) => {
    handlePotentialRouteChange(filePath)
  })
  if (changeCleanup) {
    cleanups.push(changeCleanup)
  }

  const deleteCleanup = window.electronAPI.yjs?.onExternalFileDelete?.(({ filePath }) => {
    handlePotentialRouteChange(filePath)
  })
  if (deleteCleanup) {
    cleanups.push(deleteCleanup)
  }

  watchRegistrations.set(normalizedProjectPath, {
    cleanups,
    count: 1,
  })

  return () => releaseProjectWatchRegistration(normalizedProjectPath)
}

function releaseProjectWatchRegistration(projectPath: string): void {
  const registration = watchRegistrations.get(projectPath)
  if (!registration) return

  registration.count -= 1
  if (registration.count > 0) return

  for (const cleanup of registration.cleanups) {
    cleanup()
  }
  watchRegistrations.delete(projectPath)
}

export function useProjectRouteScan({
  enabled = true,
  projectPath,
  storedFrameworkInfo = null,
}: UseProjectRouteScanOptions): UseProjectRouteScanResult {
  const normalizedProjectPath = useMemo(
    () => (projectPath ? normalizeProjectPath(projectPath) : null),
    [projectPath]
  )
  const cacheKey = useMemo(
    () => (normalizedProjectPath ? buildRouteScanCacheKey(normalizedProjectPath, storedFrameworkInfo) : null),
    [normalizedProjectPath, storedFrameworkInfo]
  )

  const [snapshot, setSnapshot] = useState<RouteScanState>(() => {
    if (!cacheKey || !normalizedProjectPath) {
      return cloneState(DEFAULT_STATE)
    }

    return cloneState(getOrCreateRouteScanEntry(normalizedProjectPath, storedFrameworkInfo).state)
  })

  useEffect(() => {
    if (!enabled || !cacheKey || !normalizedProjectPath) {
      return
    }

    const entry = getOrCreateRouteScanEntry(normalizedProjectPath, storedFrameworkInfo)
    const syncSnapshot = () => {
      setSnapshot(cloneState(entry.state))
    }

    entry.listeners.add(syncSnapshot)
    syncSnapshot()

    const releaseWatchers = retainProjectWatchRegistration(normalizedProjectPath)

    if (!entry.state.lastScannedAt && !entry.inFlight) {
      void performRouteScan(entry)
    }

    return () => {
      entry.listeners.delete(syncSnapshot)
      releaseWatchers()
    }
  }, [cacheKey, enabled, normalizedProjectPath, storedFrameworkInfo])

  const refreshRoutes = useCallback(async () => {
    if (!enabled || !normalizedProjectPath) return
    const entry = getOrCreateRouteScanEntry(normalizedProjectPath, storedFrameworkInfo)
    invalidateProjectRouteScans(normalizedProjectPath)
    await performRouteScan(entry, { force: true })
  }, [enabled, normalizedProjectPath, storedFrameworkInfo])

  if (!enabled || !cacheKey || !normalizedProjectPath) {
    return {
      ...DEFAULT_STATE,
      routes: [],
      refreshRoutes: async () => {},
    }
  }

  return {
    ...snapshot,
    refreshRoutes,
  }
}
