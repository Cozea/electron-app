import { app, dialog, type BrowserWindow, type IpcMain } from 'electron'
import { exec } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { promisify } from 'node:util'

import type { AppSettings, LocalProject, StorageUsage } from '../../shared/electronApiTypes'

interface RegisterSettingsStorageHandlersDeps {
  getMainWindow: () => BrowserWindow | null
  loadSettings: () => AppSettings
  saveSettings: (settings: Partial<AppSettings>) => void
}

const execAsync = promisify(exec)

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

  ipcMain.handle('storage:getUsage', async (): Promise<StorageUsage> => {
    const settings = deps.loadSettings()
    const projectsDir = settings.projectsDirectory
    const userDataDir = app.getPath('userData')
    const logsDir = app.getPath('logs')

    const [projectsSize, logsSize] = await Promise.all([
      getDirectorySize(projectsDir),
      getDirectorySize(logsDir),
    ])

    let dependenciesSize = 0
    let buildCacheSize = 0

    if (fs.existsSync(projectsDir)) {
      try {
        const projects = fs
          .readdirSync(projectsDir, { withFileTypes: true })
          .filter((entry) => entry.isDirectory())

        const sizes = await Promise.all(
          projects.map(async (project) => {
            const projectPath = path.join(projectsDir, project.name)
            const nodeModulesPath = path.join(projectPath, 'node_modules')
            const distPath = path.join(projectPath, 'dist')
            const buildPath = path.join(projectPath, 'build')
            const nextCachePath = path.join(projectPath, '.next')

            const [nodeModules, dist, build, nextCache] = await Promise.all([
              getDirectorySize(nodeModulesPath),
              getDirectorySize(distPath),
              getDirectorySize(buildPath),
              getDirectorySize(nextCachePath),
            ])

            return {
              dependencies: nodeModules,
              buildCache: dist + build + nextCache,
            }
          })
        )

        for (const size of sizes) {
          dependenciesSize += size.dependencies
          buildCacheSize += size.buildCache
        }
      } catch (error) {
        console.error('Failed to scan project directories:', error)
      }
    }

    const appCachePath = path.join(userDataDir, 'Cache')
    const appCache = await getDirectorySize(appCachePath)
    const diskSpace = await getDiskSpace(projectsDir)

    const projectFilesSize = Math.max(0, projectsSize - dependenciesSize - buildCacheSize)
    const totalBuildCache = buildCacheSize + appCache

    return {
      projects: projectFilesSize,
      dependencies: dependenciesSize,
      buildCache: totalBuildCache,
      logs: logsSize,
      total: projectFilesSize + dependenciesSize + totalBuildCache + logsSize,
      diskTotal: diskSpace.total,
      diskFree: diskSpace.free,
    }
  })

  ipcMain.handle('storage:listProjects', async (): Promise<LocalProject[]> => {
    const settings = deps.loadSettings()
    const projectsDir = settings.projectsDirectory

    if (!fs.existsSync(projectsDir)) {
      return []
    }

    try {
      const entries = fs
        .readdirSync(projectsDir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory() && !entry.name.startsWith('.'))

      const projects = await Promise.all(
        entries.map(async (entry) => {
          const projectPath = path.join(projectsDir, entry.name)
          const size = await getDirectorySize(projectPath)

          let lastModified = Date.now()
          try {
            const stats = fs.statSync(projectPath)
            lastModified = stats.mtimeMs
          } catch {
            // Ignore stat errors.
          }

          return {
            name: entry.name,
            path: projectPath,
            size,
            lastModified,
          }
        })
      )

      return projects.sort((a, b) => b.lastModified - a.lastModified)
    } catch (error) {
      console.error('Failed to list projects:', error)
      return []
    }
  })
}
