import { app, dialog, shell, type BrowserWindow, type IpcMain } from 'electron'
import { exec, execFile } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'
import * as Effect from 'effect/Effect'

import type {
  AppSettings,
  LocalProject,
  StorageActionResult,
  StorageProjectsPage,
  StorageSnapshot,
  StorageUsage,
} from '../../../../shared/electronApiTypes'
import { rememberApprovedExternalReadRoot } from '../fsAccess'
import { WorkspaceCatalog } from '../workspaces/WorkspaceCatalog'
import { waitForWorkspaceCatalogRuntime } from '../workspaces/WorkspaceCatalogRuntime'
import { notifyWorkspaceCatalogChanged } from '../workspaces/CatalogSnapshot'

interface RegisterSettingsStorageHandlersDeps {
  getMainWindow: () => BrowserWindow | null
  loadSettings: () => AppSettings
  saveSettings: (settings: Partial<AppSettings>) => void
}

const execAsync = promisify(exec)
const execFileAsync = promisify(execFile)
const STORAGE_SNAPSHOT_TTL_MS = 30_000
const DEFAULT_STORAGE_PAGE_SIZE = 10
const MAX_STORAGE_PAGE_SIZE = 100
const STORAGE_BUILD_CACHE_DIR_NAMES = ['dist', 'build', '.next'] as const
const STORAGE_PROJECT_SCAN_CONCURRENCY = 4
const STORAGE_PROJECT_CHILD_SCAN_CONCURRENCY = 6
const DARWIN_CAPACITY_PROBE_TIMEOUT_MS = 15_000
const DARWIN_SWIFT_CAPACITY_SCRIPT = `
import Foundation

let rawPath = CommandLine.arguments.count > 1 ? CommandLine.arguments[1] : NSHomeDirectory()
let path = NSString(string: rawPath).expandingTildeInPath
let url = URL(fileURLWithPath: path)
let values = try url.resourceValues(forKeys: [
  .volumeAvailableCapacityForImportantUsageKey,
  .volumeTotalCapacityKey,
])

let total = values.volumeTotalCapacity ?? 0
let free = values.volumeAvailableCapacityForImportantUsage ?? 0
print("\\(total),\\(free)")
`.trim()

interface StorageSnapshotCacheEntry {
  projectsDirectory: string
  usage: StorageUsage
  projects: LocalProject[]
  updatedAt: number
}

interface ScannedStorageEntry {
  totalSize: number
  dependencies?: number
  buildCache?: number
  project?: LocalProject
}

let storageSnapshotCache: StorageSnapshotCacheEntry | null = null
let darwinCapacityProbeAvailable: boolean | null = null

function getDefaultSettings(): AppSettings {
  return {
    projectsDirectory: path.join(app.getPath('home'), 'Developer', 'Cozea'),
    previewHeaderCompatibilityEnabled: true,
    approvedExternalReadRoots: [],
    deactivateTransparency: false,
  }
}

function invalidateStorageSnapshotCache(): void {
  storageSnapshotCache = null
}

function getStorageSnapshotCacheForDirectory(
  projectsDir: string
): StorageSnapshotCacheEntry | null {
  return storageSnapshotCache?.projectsDirectory === projectsDir
    ? storageSnapshotCache
    : null
}

function normalizePageSize(value?: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return DEFAULT_STORAGE_PAGE_SIZE
  return Math.max(1, Math.min(MAX_STORAGE_PAGE_SIZE, Math.floor(value)))
}

function normalizePage(value: number | undefined, totalPages: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return 1
  return Math.max(1, Math.min(totalPages, Math.floor(value)))
}

function paginateProjects(
  projects: LocalProject[],
  page?: number,
  pageSize?: number
): StorageProjectsPage {
  const normalizedPageSize = normalizePageSize(pageSize)
  const total = projects.length
  const totalPages = Math.max(1, Math.ceil(total / normalizedPageSize))
  const normalizedPage = normalizePage(page, totalPages)
  const startIndex = (normalizedPage - 1) * normalizedPageSize

  return {
    items: projects.slice(startIndex, startIndex + normalizedPageSize),
    page: normalizedPage,
    pageSize: normalizedPageSize,
    total,
    totalPages,
  }
}

async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  mapper: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  const normalizedConcurrency = Math.max(1, Math.min(concurrency, items.length || 1))
  const results = Array.from({ length: items.length }) as R[]
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const currentIndex = nextIndex
      nextIndex += 1
      results[currentIndex] = await mapper(items[currentIndex], currentIndex)
    }
  }

  await Promise.all(
    Array.from({ length: normalizedConcurrency }, () => worker())
  )

  return results
}

function buildStorageSnapshotResponse(
  snapshot: StorageSnapshotCacheEntry,
  options?: { page?: number; pageSize?: number },
  fromCache: boolean = false
): StorageSnapshot {
  return {
    projectsDirectory: snapshot.projectsDirectory,
    usage: snapshot.usage,
    projects: paginateProjects(snapshot.projects, options?.page, options?.pageSize),
    updatedAt: snapshot.updatedAt,
    fromCache,
  }
}

function resolveExistingPath(targetPath: string): string {
  let current = path.resolve(targetPath)
  while (!fs.existsSync(current)) {
    const parent = path.dirname(current)
    if (parent === current) {
      return app.getPath('home')
    }
    current = parent
  }
  return current
}

async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    if (!fs.existsSync(dirPath)) return 0

    if (process.platform === 'win32') {
      const { stdout } = await execAsync(
        `powershell -command "(Get-ChildItem -Path '${dirPath}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`,
        { timeout: 30000 }
      )
      const size = parseInt(stdout.trim(), 10)
      return Number.isNaN(size) ? 0 : size
    }

    const { stdout } = await execAsync(`du -sk "${dirPath}" 2>/dev/null || echo "0"`, {
      timeout: 30000,
    })
    const sizeKb = parseInt(stdout.split('\t')[0], 10)
    return Number.isNaN(sizeKb) ? 0 : sizeKb * 1024
  } catch {
    return 0
  }
}

async function isDarwinCapacityProbeAvailable(): Promise<boolean> {
  if (process.platform !== 'darwin') return false
  if (darwinCapacityProbeAvailable !== null) return darwinCapacityProbeAvailable

  if (!fs.existsSync('/usr/bin/swift') || !fs.existsSync('/usr/bin/xcode-select')) {
    darwinCapacityProbeAvailable = false
    return darwinCapacityProbeAvailable
  }

  try {
    await execFileAsync('/usr/bin/xcode-select', ['-p'], { timeout: 5_000 })
    darwinCapacityProbeAvailable = true
  } catch {
    darwinCapacityProbeAvailable = false
  }

  return darwinCapacityProbeAvailable
}

async function getDarwinDiskSpace(dirPath: string): Promise<{ total: number; free: number } | null> {
  if (!(await isDarwinCapacityProbeAvailable())) {
    return null
  }

  try {
    // Use Foundation's "important usage" capacity so the value matches Finder/System Settings
    // more closely than statfs/df on APFS volumes with purgeable space.
    const { stdout } = await execFileAsync(
      '/usr/bin/swift',
      ['-e', DARWIN_SWIFT_CAPACITY_SCRIPT, dirPath],
      { timeout: DARWIN_CAPACITY_PROBE_TIMEOUT_MS }
    )
    const [rawTotal, rawFree] = stdout.trim().split(',', 2)
    const total = parseInt(rawTotal || '', 10)
    const free = parseInt(rawFree || '', 10)

    if (!Number.isFinite(total) || total <= 0 || !Number.isFinite(free) || free < 0) {
      return null
    }

    return { total, free }
  } catch {
    return null
  }
}

async function getDiskSpace(dirPath: string): Promise<{ total: number; free: number }> {
  try {
    if (process.platform === 'win32') {
      const driveLetter = path.parse(dirPath).root || 'C:\\'
      const { stdout } = await execAsync(
        `powershell -command "Get-PSDrive -Name '${driveLetter[0]}' | Select-Object Used,Free | ConvertTo-Json"`,
        { timeout: 10000 }
      )
      const info = JSON.parse(stdout) as { Used?: number; Free?: number }
      return {
        total: (info.Used || 0) + (info.Free || 0),
        free: info.Free || 0,
      }
    }

    if (process.platform === 'darwin') {
      const darwinDiskSpace = await getDarwinDiskSpace(dirPath)
      if (darwinDiskSpace) {
        return darwinDiskSpace
      }
    }

    const { stdout } = await execAsync(`df -k "${dirPath}" 2>/dev/null | tail -1`, {
      timeout: 10000,
    })
    const parts = stdout.trim().split(/\s+/)
    const totalKb = parseInt(parts[1], 10)
    const availableKb = parseInt(parts[3], 10)
    return {
      total: Number.isNaN(totalKb) ? 0 : totalKb * 1024,
      free: Number.isNaN(availableKb) ? 0 : availableKb * 1024,
    }
  } catch {
    return { total: 0, free: 0 }
  }
}

async function getPathSize(targetPath: string): Promise<number> {
  try {
    if (!fs.existsSync(targetPath)) return 0
    const stats = await fs.promises.lstat(targetPath)
    if (stats.isDirectory()) {
      return getDirectorySize(targetPath)
    }
    return stats.size
  } catch {
    return 0
  }
}

function isBuildCacheDirectoryName(
  name: string
): name is (typeof STORAGE_BUILD_CACHE_DIR_NAMES)[number] {
  return STORAGE_BUILD_CACHE_DIR_NAMES.includes(
    name as (typeof STORAGE_BUILD_CACHE_DIR_NAMES)[number]
  )
}

async function scanProjectDirectory(entryPath: string): Promise<{
  totalSize: number
  dependencies: number
  buildCache: number
}> {
  let children: fs.Dirent[]
  try {
    children = await fs.promises.readdir(entryPath, { withFileTypes: true })
  } catch {
    return {
      totalSize: await getDirectorySize(entryPath),
      dependencies: 0,
      buildCache: 0,
    }
  }

  if (children.length === 0) {
    return {
      totalSize: 0,
      dependencies: 0,
      buildCache: 0,
    }
  }

  const childSizes = await mapWithConcurrency(
    children,
    STORAGE_PROJECT_CHILD_SCAN_CONCURRENCY,
    async (child) => {
      const childPath = path.join(entryPath, child.name)
      const size = child.isDirectory()
        ? await getDirectorySize(childPath)
        : await getPathSize(childPath)

      return {
        name: child.name,
        size,
      }
    }
  )

  let totalSize = 0
  let dependencies = 0
  let buildCache = 0

  for (const child of childSizes) {
    totalSize += child.size

    if (child.name === 'node_modules') {
      dependencies += child.size
      continue
    }

    if (isBuildCacheDirectoryName(child.name)) {
      buildCache += child.size
    }
  }

  return {
    totalSize,
    dependencies,
    buildCache,
  }
}

async function scanManagedProjectPath(entryPath: string): Promise<ScannedStorageEntry> {
  const { totalSize, dependencies, buildCache } = await scanProjectDirectory(entryPath)

  let lastModified = Date.now()
  try {
    lastModified = fs.statSync(entryPath).mtimeMs
  } catch {
    // Ignore stat errors.
  }

  return {
    totalSize,
    dependencies,
    buildCache,
    project: {
      name: path.basename(entryPath),
      path: entryPath,
      size: totalSize,
      lastModified,
    } satisfies LocalProject,
  }
}

async function removePath(
  targetPath: string,
  options?: { measureSize?: boolean }
): Promise<number> {
  const size = options?.measureSize === false ? 0 : await getPathSize(targetPath)
  if (!fs.existsSync(targetPath)) return size
  await fs.promises.rm(targetPath, { recursive: true, force: true })
  return size
}

async function clearDirectoryContents(
  dirPath: string,
  options?: { measureSize?: boolean }
): Promise<number> {
  if (!fs.existsSync(dirPath)) return 0
  const entries = await fs.promises.readdir(dirPath)
  const sizes = await Promise.all(
    entries.map((entry) =>
      removePath(path.join(dirPath, entry), { measureSize: options?.measureSize })
    )
  )
  return sizes.reduce((total, size) => total + size, 0)
}

async function listManagedStoragePaths(): Promise<string[]> {
  const runtime = await waitForWorkspaceCatalogRuntime()
  const targets = await runtime.runPromise(
    Effect.flatMap(Effect.service(WorkspaceCatalog), (catalog) =>
      catalog.listManagedDeletionTargets(),
    ) as Effect.Effect<
      Array<{ projectRootPath: string }>,
      never,
      WorkspaceCatalog
    >,
  )
  return [...new Set(targets.map((target) => target.projectRootPath))]
}

async function collectStorageSnapshot(
  projectsDir: string,
  managedProjectPaths: string[],
): Promise<StorageSnapshotCacheEntry> {
  const userDataDir = app.getPath('userData')
  const logsDir = app.getPath('logs')
  const appCachePath = path.join(userDataDir, 'Cache')

  let projectsTotalSize = 0
  let dependenciesSize = 0
  let buildCacheSize = 0
  const projects: LocalProject[] = []

  try {
    const scannedEntries = await mapWithConcurrency(
      managedProjectPaths,
      STORAGE_PROJECT_SCAN_CONCURRENCY,
      async (projectPath) => scanManagedProjectPath(projectPath),
    )

    for (const scannedEntry of scannedEntries) {
      projectsTotalSize += scannedEntry.totalSize ?? 0
      if (scannedEntry.project) {
        projects.push(scannedEntry.project)
        dependenciesSize += scannedEntry.dependencies ?? 0
        buildCacheSize += scannedEntry.buildCache ?? 0
      }
    }
  } catch (error) {
    console.error('Failed to scan managed project directories:', error)
  }

  const [logsSize, appCache, diskSpace] = await Promise.all([
    getDirectorySize(logsDir),
    getDirectorySize(appCachePath),
    getDiskSpace(resolveExistingPath(projectsDir)),
  ])

  const projectFilesSize = Math.max(0, projectsTotalSize - dependenciesSize - buildCacheSize)
  const totalBuildCache = buildCacheSize + appCache
  projects.sort((a, b) => b.lastModified - a.lastModified)

  return {
    projectsDirectory: projectsDir,
    usage: {
      projects: projectFilesSize,
      dependencies: dependenciesSize,
      buildCache: totalBuildCache,
      logs: logsSize,
      total: projectFilesSize + dependenciesSize + totalBuildCache + logsSize,
      diskTotal: diskSpace.total,
      diskFree: diskSpace.free,
    },
    projects,
    updatedAt: Date.now(),
  }
}

async function getStorageSnapshotCacheEntry(
  projectsDir: string,
  forceRefresh: boolean = false
): Promise<{ snapshot: StorageSnapshotCacheEntry; fromCache: boolean }> {
  const canUseCache =
    !forceRefresh &&
    storageSnapshotCache?.projectsDirectory === projectsDir &&
    Date.now() - storageSnapshotCache.updatedAt < STORAGE_SNAPSHOT_TTL_MS

  if (canUseCache && storageSnapshotCache) {
    return { snapshot: storageSnapshotCache, fromCache: true }
  }

  const snapshot = await collectStorageSnapshot(projectsDir, await listManagedStoragePaths())
  storageSnapshotCache = snapshot
  return { snapshot, fromCache: false }
}

export function registerSettingsStorageHandlers(
  ipcMain: IpcMain,
  deps: RegisterSettingsStorageHandlersDeps
): void {
  ipcMain.handle('settings:get', () => {
    return deps.loadSettings()
  })

  ipcMain.handle('settings:set', async (_event, settings: Partial<AppSettings>) => {
    deps.saveSettings(settings)
    if (typeof settings.projectsDirectory === 'string' && settings.projectsDirectory.trim()) {
      try {
        await fs.promises.mkdir(settings.projectsDirectory, { recursive: true })
        const rt = await waitForWorkspaceCatalogRuntime()
        await rt.runPromise(
          Effect.flatMap(Effect.service(WorkspaceCatalog), (catalog) =>
            catalog.setSetting('projectsDirectory', settings.projectsDirectory!.trim()),
          ) as Effect.Effect<void, never, WorkspaceCatalog>,
        )
      } catch (error) {
        console.warn('[Settings] Failed to sync projects directory to workspace catalog.', error)
      }
    }
    invalidateStorageSnapshotCache()
    return { success: true }
  })

  ipcMain.handle('dialog:selectDirectory', async (_event, options?: { title?: string }) => {
    const win = deps.getMainWindow()
    if (!win) return { success: false, error: 'No window available' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: options?.title ?? 'Select Projects Directory',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    const approvedRootUpdate = rememberApprovedExternalReadRoot(
      deps.loadSettings(),
      result.filePaths[0],
    )
    if (approvedRootUpdate) {
      deps.saveSettings(approvedRootUpdate)
    }

    return { success: true, path: result.filePaths[0] }
  })

  ipcMain.handle(
    'dialog:selectFile',
    async (
      _event,
      options?: {
        title?: string
        filters?: Array<{ name: string; extensions: string[] }>
      }
    ) => {
      const win = deps.getMainWindow()
      if (!win) return { success: false, error: 'No window available' }

      const result = await dialog.showOpenDialog(win, {
        properties: ['openFile'],
        title: options?.title ?? 'Select File',
        filters: options?.filters,
      })

      if (result.canceled || result.filePaths.length === 0) {
        return { success: false, canceled: true }
      }

      return { success: true, path: result.filePaths[0] }
    }
  )

  ipcMain.handle('dialog:showMessageBox', async (_event, options) => {
    const win = deps.getMainWindow()
    if (!win) return dialog.showMessageBox(options)
    return dialog.showMessageBox(win, options)
  })

  ipcMain.handle(
    'storage:getSnapshot',
    async (
      _event,
      options?: { page?: number; pageSize?: number; forceRefresh?: boolean }
    ): Promise<StorageSnapshot> => {
      const settings = deps.loadSettings()
      const { snapshot, fromCache } = await getStorageSnapshotCacheEntry(
        settings.projectsDirectory,
        options?.forceRefresh
      )
      return buildStorageSnapshotResponse(snapshot, options, fromCache)
    }
  )

  ipcMain.handle('storage:getUsage', async (): Promise<StorageUsage> => {
    const settings = deps.loadSettings()
    const { snapshot } = await getStorageSnapshotCacheEntry(settings.projectsDirectory)
    return snapshot.usage
  })

  ipcMain.handle('storage:listProjects', async (): Promise<LocalProject[]> => {
    const settings = deps.loadSettings()
    const { snapshot } = await getStorageSnapshotCacheEntry(settings.projectsDirectory)
    return snapshot.projects
  })

  ipcMain.handle('storage:openProjectsDirectory', async (): Promise<StorageActionResult> => {
    const settings = deps.loadSettings()
    const projectsDir = settings.projectsDirectory

    try {
      await fs.promises.mkdir(projectsDir, { recursive: true })
      const errorMessage = await shell.openPath(projectsDir)
      return errorMessage ? { success: false, error: errorMessage } : { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open projects directory.',
      }
    }
  })

  ipcMain.handle('storage:clearCache', async (): Promise<StorageActionResult> => {
    const settings = deps.loadSettings()
    const projectsDir = settings.projectsDirectory
    const userDataDir = app.getPath('userData')
    const appCachePath = path.join(userDataDir, 'Cache')
    const projectDirectories = await listManagedStoragePaths()
    const cachedSnapshot = getStorageSnapshotCacheForDirectory(projectsDir)

    try {
      const targets = [
        appCachePath,
        ...projectDirectories.flatMap((projectPath) =>
          STORAGE_BUILD_CACHE_DIR_NAMES.map((directoryName) => path.join(projectPath, directoryName))
        ),
      ]

      await Promise.all(
        targets.map((target) => removePath(target, { measureSize: false }))
      )

      await fs.promises.mkdir(appCachePath, { recursive: true })
      invalidateStorageSnapshotCache()

      return {
        success: true,
        ...(typeof cachedSnapshot?.usage.buildCache === 'number'
          ? { clearedBytes: cachedSnapshot.usage.buildCache }
          : {}),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear build cache.',
      }
    }
  })

  ipcMain.handle('storage:clearLogs', async (): Promise<StorageActionResult> => {
    const logsDir = app.getPath('logs')
    const cachedLogsSize = storageSnapshotCache?.usage.logs

    try {
      await clearDirectoryContents(logsDir, { measureSize: false })
      await fs.promises.mkdir(logsDir, { recursive: true })
      invalidateStorageSnapshotCache()

      return {
        success: true,
        ...(typeof cachedLogsSize === 'number' ? { clearedBytes: cachedLogsSize } : {}),
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear logs.',
      }
    }
  })

  ipcMain.handle('storage:clearAll', async (): Promise<StorageActionResult> => {
    const settings = deps.loadSettings()
    const currentProjectsDir = settings.projectsDirectory
    const userDataDir = app.getPath('userData')
    const logsDir = app.getPath('logs')
    const appCachePath = path.join(userDataDir, 'Cache')
    const defaultSettings = getDefaultSettings()
    const cachedSnapshot = getStorageSnapshotCacheForDirectory(currentProjectsDir)

    try {
      const runtime = await waitForWorkspaceCatalogRuntime()
      const managedTargets = await runtime.runPromise(
        Effect.flatMap(Effect.service(WorkspaceCatalog), (catalog) =>
          catalog.listManagedDeletionTargets(),
        ) as Effect.Effect<
          Array<{
            workspaceId: string
            projectRootPath: string
            managedRootPath: string
          }>,
          never,
          WorkspaceCatalog
        >,
      )
      const movedWorkspaceIds: string[] = []
      for (const target of managedTargets) {
        const [managedRootPath, projectRootPath] = await Promise.all([
          fs.promises.realpath(target.managedRootPath),
          fs.promises.realpath(target.projectRootPath),
        ])
        const relative = path.relative(managedRootPath, projectRootPath)
        if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) {
          continue
        }
        await shell.trashItem(projectRootPath)
        movedWorkspaceIds.push(target.workspaceId)
      }

      await Promise.all([
        clearDirectoryContents(appCachePath, { measureSize: false }),
        clearDirectoryContents(logsDir, { measureSize: false }),
      ])

      for (const workspaceId of movedWorkspaceIds) {
        await runtime.runPromise(
          Effect.flatMap(Effect.service(WorkspaceCatalog), (catalog) =>
            catalog.forget(workspaceId),
          ) as Effect.Effect<void, never, WorkspaceCatalog>,
        )
      }
      if (movedWorkspaceIds.length > 0) {
        notifyWorkspaceCatalogChanged()
      }

      await Promise.all([
        fs.promises.mkdir(defaultSettings.projectsDirectory, { recursive: true }),
        fs.promises.mkdir(appCachePath, { recursive: true }),
        fs.promises.mkdir(logsDir, { recursive: true }),
      ])

      deps.saveSettings(defaultSettings)
      await runtime.runPromise(
        Effect.flatMap(Effect.service(WorkspaceCatalog), (catalog) =>
          catalog.setSetting('projectsDirectory', defaultSettings.projectsDirectory),
        ) as Effect.Effect<void, never, WorkspaceCatalog>,
      )
      invalidateStorageSnapshotCache()

      return {
        success: true,
        ...(typeof cachedSnapshot?.usage.total === 'number'
          ? { clearedBytes: cachedSnapshot.usage.total }
          : {}),
        deletedCount: movedWorkspaceIds.length,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear local data.',
      }
    }
  })
}
