import { app, dialog, shell, type BrowserWindow, type IpcMain } from 'electron'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import type {
  AppSettings,
  LocalProject,
  StorageActionResult,
  StorageProjectsPage,
  StorageSnapshot,
  StorageUsage,
} from '../../shared/electronApiTypes'

interface RegisterSettingsStorageHandlersDeps {
  getMainWindow: () => BrowserWindow | null
  loadSettings: () => AppSettings
  saveSettings: (settings: Partial<AppSettings>) => void
}

const execAsync = promisify(exec)
const STORAGE_SNAPSHOT_TTL_MS = 30_000
const DEFAULT_STORAGE_PAGE_SIZE = 10
const MAX_STORAGE_PAGE_SIZE = 100
const STORAGE_BUILD_CACHE_DIR_NAMES = ['dist', 'build', '.next'] as const

interface StorageSnapshotCacheEntry {
  projectsDirectory: string
  usage: StorageUsage
  projects: LocalProject[]
  updatedAt: number
}

let storageSnapshotCache: StorageSnapshotCacheEntry | null = null

function getDefaultSettings(): AppSettings {
  return {
    projectsDirectory: path.join(app.getPath('home'), 'Developer', 'Cozea'),
    previewHeaderCompatibilityEnabled: true,
  }
}

function invalidateStorageSnapshotCache(): void {
  storageSnapshotCache = null
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

async function removePath(targetPath: string): Promise<number> {
  const size = await getPathSize(targetPath)
  if (!fs.existsSync(targetPath)) return size
  await fs.promises.rm(targetPath, { recursive: true, force: true })
  return size
}

async function clearDirectoryContents(dirPath: string): Promise<number> {
  if (!fs.existsSync(dirPath)) return 0
  const entries = await fs.promises.readdir(dirPath)
  const sizes = await Promise.all(entries.map((entry) => removePath(path.join(dirPath, entry))))
  return sizes.reduce((total, size) => total + size, 0)
}

function getProjectDirectories(projectsDir: string): string[] {
  if (!fs.existsSync(projectsDir)) return []
  try {
    return fs
      .readdirSync(projectsDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))
      .map((entry) => path.join(projectsDir, entry.name))
  } catch {
    return []
  }
}

function isPathInsideDirectory(parentDir: string, targetPath: string): boolean {
  const relativePath = path.relative(path.resolve(parentDir), path.resolve(targetPath))
  return Boolean(relativePath) && !relativePath.startsWith('..') && !path.isAbsolute(relativePath)
}

async function collectStorageSnapshot(projectsDir: string): Promise<StorageSnapshotCacheEntry> {
  const userDataDir = app.getPath('userData')
  const logsDir = app.getPath('logs')
  const appCachePath = path.join(userDataDir, 'Cache')

  let projectsTotalSize = 0
  let dependenciesSize = 0
  let buildCacheSize = 0
  const projects: LocalProject[] = []

  if (fs.existsSync(projectsDir)) {
    try {
      const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
      const scannedEntries = await Promise.all(
        entries.map(async (entry) => {
          const entryPath = path.join(projectsDir, entry.name)
          const totalSize = entry.isDirectory()
            ? await getDirectorySize(entryPath)
            : await getPathSize(entryPath)

          if (!entry.isDirectory() || entry.name.startsWith('.')) {
            return { totalSize }
          }

          const [nodeModules, dist, build, nextCache] = await Promise.all([
            getDirectorySize(path.join(entryPath, 'node_modules')),
            getDirectorySize(path.join(entryPath, 'dist')),
            getDirectorySize(path.join(entryPath, 'build')),
            getDirectorySize(path.join(entryPath, '.next')),
          ])

          let lastModified = Date.now()
          try {
            lastModified = fs.statSync(entryPath).mtimeMs
          } catch {
            // Ignore stat errors.
          }

          return {
            totalSize,
            dependencies: nodeModules,
            buildCache: dist + build + nextCache,
            project: {
              name: entry.name,
              path: entryPath,
              size: totalSize,
              lastModified,
            } satisfies LocalProject,
          }
        })
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
      console.error('Failed to scan project directories:', error)
    }
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

  const snapshot = await collectStorageSnapshot(projectsDir)
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

  ipcMain.handle('settings:set', (_event, settings: Partial<AppSettings>) => {
    deps.saveSettings(settings)
    return { success: true }
  })

  ipcMain.handle('dialog:selectDirectory', async () => {
    const win = deps.getMainWindow()
    if (!win) return { success: false, error: 'No window available' }

    const result = await dialog.showOpenDialog(win, {
      properties: ['openDirectory', 'createDirectory'],
      title: 'Select Projects Directory',
    })

    if (result.canceled || result.filePaths.length === 0) {
      return { success: false, canceled: true }
    }

    return { success: true, path: result.filePaths[0] }
  })

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
    const projectDirectories = getProjectDirectories(projectsDir)

    try {
      const targets = [
        appCachePath,
        ...projectDirectories.flatMap((projectPath) =>
          STORAGE_BUILD_CACHE_DIR_NAMES.map((directoryName) => path.join(projectPath, directoryName))
        ),
      ]

      const clearedBytes = (await Promise.all(targets.map((target) => removePath(target)))).reduce(
        (total, size) => total + size,
        0
      )

      await fs.promises.mkdir(appCachePath, { recursive: true })
      invalidateStorageSnapshotCache()

      return {
        success: true,
        clearedBytes,
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

    try {
      const clearedBytes = await clearDirectoryContents(logsDir)
      await fs.promises.mkdir(logsDir, { recursive: true })
      invalidateStorageSnapshotCache()

      return {
        success: true,
        clearedBytes,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear logs.',
      }
    }
  })

  ipcMain.handle(
    'storage:deleteProject',
    async (_event, options: { projectPath: string }): Promise<StorageActionResult> => {
      const settings = deps.loadSettings()
      const projectsDir = settings.projectsDirectory
      const projectPath = options?.projectPath

      if (!projectPath) {
        return { success: false, error: 'Project path is required.' }
      }

      if (!isPathInsideDirectory(projectsDir, projectPath)) {
        return { success: false, error: 'Project path is outside the configured projects directory.' }
      }

      try {
        const clearedBytes = await removePath(projectPath)
        invalidateStorageSnapshotCache()
        return {
          success: true,
          clearedBytes,
          deletedCount: 1,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to delete project.',
        }
      }
    }
  )

  ipcMain.handle('storage:clearAll', async (): Promise<StorageActionResult> => {
    const settings = deps.loadSettings()
    const currentProjectsDir = settings.projectsDirectory
    const userDataDir = app.getPath('userData')
    const logsDir = app.getPath('logs')
    const appCachePath = path.join(userDataDir, 'Cache')
    const defaultSettings = getDefaultSettings()
    const deletedProjectCount = getProjectDirectories(currentProjectsDir).length

    try {
      const [projectsBytes, appCacheBytes, logsBytes] = await Promise.all([
        clearDirectoryContents(currentProjectsDir),
        clearDirectoryContents(appCachePath),
        clearDirectoryContents(logsDir),
      ])

      await Promise.all([
        fs.promises.mkdir(defaultSettings.projectsDirectory, { recursive: true }),
        fs.promises.mkdir(appCachePath, { recursive: true }),
        fs.promises.mkdir(logsDir, { recursive: true }),
      ])

      deps.saveSettings(defaultSettings)
      invalidateStorageSnapshotCache()

      return {
        success: true,
        clearedBytes: projectsBytes + appCacheBytes + logsBytes,
        deletedCount: deletedProjectCount,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clear local data.',
      }
    }
  })
}
