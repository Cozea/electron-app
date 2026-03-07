import type { IpcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import type {
  AppSettings,
  CloneRepositoryResult,
  CopyDirectorySnapshotResult,
  CreateProjectFolderResult,
  FileEntry,
  ImportSourcePreflightIssue,
  ImportSourcePreflightResult,
  ListFilesResult,
  ReadFileBase64Result,
  ReadFileResult,
  WatchProjectResult,
  WriteFileResult,
} from '../../shared/electronApiTypes'
import { runGitCommand as runGitRuntimeCommand } from '../gitRuntime'
import { resolvePathWithinDirectory } from '../pathUtils'
import { markInternalFsChange, startProjectWatcher, stopProjectWatcher } from '../projectWatcher'
import {
  EXCLUDED_GENERATED_DIRECTORIES,
  shouldExcludeGeneratedDirectory,
  shouldExcludeGeneratedFile,
} from '../services/generatedArtifactFilters'
import { notifyFileChanged, notifyFileMetaChanged } from '../yjsNotify'

interface RegisterProjectHandlersDeps {
  loadSettings: () => AppSettings
}

const IMPORT_PREFLIGHT_MAX_ISSUES = 50

function normalizeRelativePathForFilters(relativePath: string): string {
  return relativePath.replace(/\\/g, '/')
}

async function preflightImportSource(
  projectPath: string,
  mode: 'relocation' | 'raw' = 'relocation'
): Promise<ImportSourcePreflightResult> {
  const normalizedRoot = path.resolve(projectPath)
  const issues: ImportSourcePreflightIssue[] = []
  let scannedFiles = 0
  let truncated = false
  const queue: string[] = ['']

  if (!fs.existsSync(normalizedRoot) || !fs.statSync(normalizedRoot).isDirectory()) {
    return {
      success: false,
      error: 'Source project directory does not exist',
    }
  }

  while (queue.length > 0) {
    const currentRelativeDir = queue.pop() ?? ''
    const currentDir = path.join(normalizedRoot, currentRelativeDir)

    let entries: fs.Dirent[]
    try {
      entries = await fs.promises.readdir(currentDir, { withFileTypes: true })
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to read source directory',
      }
    }

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue

      const relPath = currentRelativeDir ? path.join(currentRelativeDir, entry.name) : entry.name
      const normalizedRelPath = normalizeRelativePathForFilters(relPath)
      const fullPath = path.join(normalizedRoot, relPath)

      if (entry.isDirectory()) {
        if (mode === 'relocation' && shouldExcludeGeneratedDirectory(entry.name)) {
          continue
        }
        queue.push(relPath)
        continue
      }

      if (!entry.isFile()) continue
      if (mode === 'relocation' && shouldExcludeGeneratedFile(normalizedRelPath)) {
        continue
      }

      scannedFiles += 1
      try {
        const stats = await fs.promises.stat(fullPath)
        // On macOS, many File Provider placeholders report logical size but 0 allocated blocks.
        // Treat those as unavailable to avoid import hangs on deferred hydration.
        if (
          process.platform === 'darwin' &&
          stats.size > 0 &&
          typeof stats.blocks === 'number' &&
          stats.blocks === 0
        ) {
          if (issues.length < IMPORT_PREFLIGHT_MAX_ISSUES) {
            issues.push({
              path: normalizedRelPath,
              reason: 'likely-offline-placeholder',
            })
          } else {
            truncated = true
          }
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : `Failed to stat ${normalizedRelPath}`,
        }
      }
    }
  }

  return {
    success: true,
    scannedFiles,
    issues,
    truncated,
  }
}

function buildGitAuthorizationHeader(provider: string, accessToken?: string): string | null {
  if (!accessToken?.trim()) return null

  const username = provider === 'gitlab' ? 'oauth2' : 'x-access-token'
  const encoded = Buffer.from(`${username}:${accessToken.trim()}`, 'utf8').toString('base64')
  return `AUTHORIZATION: Basic ${encoded}`
}

function normalizeRepositoryUrl(repoUrl: string, provider: string): string | null {
  const trimmed = repoUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return null

  if (trimmed.startsWith('git@') || trimmed.startsWith('ssh://') || trimmed.startsWith('git://')) {
    return trimmed
  }

  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  const shorthandMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (!shorthandMatch) return null

  const owner = shorthandMatch[1]
  const repo = shorthandMatch[2].replace(/\.git$/i, '')
  const host = provider === 'gitlab' ? 'gitlab.com' : 'github.com'
  return `https://${host}/${owner}/${repo}.git`
}

function runGitCommand(
  args: string[],
  cwd: string
): Promise<{ success: true } | { success: false; error: string }> {
  return runGitRuntimeCommand(args, { cwd }).then((result) => {
    if (result.success) {
      return { success: true }
    }
    return {
      success: false,
      error:
        result.error ||
        result.stderr.trim() ||
        result.stdout.trim() ||
        `git exited with code ${result.exitCode ?? 'unknown'}`,
    }
  })
}

export function registerProjectHandlers(
  ipcMain: IpcMain,
  deps: RegisterProjectHandlersDeps
): void {
  ipcMain.handle(
    'project:createFolder',
    async (
      _event,
      { slug, initGit = true }: { slug: string; initGit?: boolean }
    ): Promise<CreateProjectFolderResult> => {
      const settings = deps.loadSettings()
      const projectsDir = settings.projectsDirectory
      const projectPath = path.join(projectsDir, slug)

      try {
        if (!fs.existsSync(projectsDir)) {
          fs.mkdirSync(projectsDir, { recursive: true })
        }

        if (fs.existsSync(projectPath)) {
          return {
            success: false,
            error: `Project folder already exists: ${projectPath}`,
          }
        }

        fs.mkdirSync(projectPath, { recursive: true })
        console.log(`[Project] Created folder: ${projectPath}`)

        if (initGit) {
          try {
            const initResult = await runGitCommand(['init'], projectPath)
            if (!initResult.success) {
              throw new Error(initResult.error)
            }
            console.log(`[Project] Initialized git repo: ${projectPath}`)

            const gitignoreContent = `# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Cache
.cache/
.turbo/
`
            fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignoreContent)
            console.log('[Project] Created .gitignore')
          } catch (gitError) {
            console.warn('[Project] Git init failed:', gitError)
            return {
              success: false,
              error: gitError instanceof Error ? gitError.message : 'Git init failed',
            }
          }
        }

        return {
          success: true,
          localPath: projectPath,
        }
      } catch (error) {
        console.error('[Project] Failed to create folder:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to create project folder',
        }
      }
    }
  )

  // Clone a repository into the project directory for repo imports.
  ipcMain.handle(
    'project:cloneRepository',
    async (
      _event,
      {
        slug,
        repoUrl,
        provider,
        branch,
        accessToken,
      }: {
        slug: string
        repoUrl: string
        provider: string
        branch?: string
        accessToken?: string
      }
    ): Promise<CloneRepositoryResult> => {
      const settings = deps.loadSettings()
      const projectsDir = settings.projectsDirectory
      const targetPath = path.join(projectsDir, slug)
      const normalizedRepoUrl = normalizeRepositoryUrl(repoUrl, provider)

      if (!normalizedRepoUrl) {
        return {
          success: false,
          error: 'Invalid repository URL. Use a full URL or owner/repo format.',
        }
      }

      try {
        if (!fs.existsSync(projectsDir)) {
          fs.mkdirSync(projectsDir, { recursive: true })
        }

        if (fs.existsSync(targetPath)) {
          const existingEntries = fs.readdirSync(targetPath, { withFileTypes: true })
          if (existingEntries.length > 0) {
            return {
              success: false,
              error: `Destination already exists and is not empty: ${targetPath}`,
            }
          }
          fs.rmSync(targetPath, { recursive: true, force: true })
        }

        const cloneArgs: string[] = []
        const authHeader = buildGitAuthorizationHeader(provider, accessToken)

        if (authHeader && /^https?:\/\//i.test(normalizedRepoUrl)) {
          cloneArgs.push('-c', `http.extraheader=${authHeader}`)
        }

        cloneArgs.push('clone', '--single-branch', '--depth', '1')
        if (branch && branch.trim()) {
          cloneArgs.push('--branch', branch.trim())
        }
        cloneArgs.push(normalizedRepoUrl, targetPath)

        const cloneResult = await runGitCommand(cloneArgs, projectsDir)
        if (!cloneResult.success) {
          return {
            success: false,
            error: cloneResult.error,
          }
        }

        return {
          success: true,
          localPath: targetPath,
          normalizedRepoUrl,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to clone repository',
        }
      }
    }
  )

  ipcMain.handle('project:getLocalPath', (_event, { slug }: { slug: string }): string | null => {
    const settings = deps.loadSettings()
    const projectPath = path.join(settings.projectsDirectory, slug)
    return fs.existsSync(projectPath) ? projectPath : null
  })

  ipcMain.handle('project:exists', (_event, { slug }: { slug: string }): boolean => {
    const settings = deps.loadSettings()
    const projectPath = path.join(settings.projectsDirectory, slug)
    return fs.existsSync(projectPath)
  })

  ipcMain.handle('project:pathExists', (_event, { projectPath }: { projectPath: string }): boolean => {
    if (!projectPath || typeof projectPath !== 'string') return false
    try {
      return fs.existsSync(projectPath)
    } catch {
      return false
    }
  })

  ipcMain.handle(
    'project:writeFile',
    async (
      _event,
      {
        projectPath,
        filePath,
        content,
        encoding = 'utf8',
        origin = 'agent',
      }: {
        projectPath: string
        filePath: string
        content: string
        encoding?: 'utf8' | 'base64'
        origin?: 'agent' | 'remote' | 'sync'
      }
    ): Promise<WriteFileResult> => {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, filePath)
        const dir = path.dirname(fullPath)

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        // Prevent the project watcher from treating this as an external change.
        markInternalFsChange(fullPath)
        if (encoding === 'base64') {
          fs.writeFileSync(fullPath, Buffer.from(content, 'base64'))
        } else {
          fs.writeFileSync(fullPath, content, 'utf-8')
        }
        const stats = fs.statSync(fullPath)
        console.log(`[Project] Wrote file: ${fullPath}`)

        if (encoding !== 'base64') {
          notifyFileChanged(fullPath, content, { origin })
        }
        notifyFileMetaChanged({
          filePath: fullPath,
          origin,
          isBinary: encoding === 'base64',
          sizeBytes: stats.size,
          content: encoding === 'base64' ? undefined : content,
        })

        return {
          success: true,
          fullPath,
          sizeBytes: stats.size,
        }
      } catch (error) {
        console.error('[Project] Failed to write file:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  ipcMain.handle(
    'project:readFile',
    async (
      _event,
      { projectPath, filePath }: { projectPath: string; filePath: string }
    ): Promise<ReadFileResult> => {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, filePath)

        if (!fs.existsSync(fullPath)) {
          return { success: false, error: 'File not found' }
        }

        const content = fs.readFileSync(fullPath, 'utf-8')
        const stats = fs.statSync(fullPath)

        return {
          success: true,
          content,
          sizeBytes: stats.size,
        }
      } catch (error) {
        console.error('[Project] Failed to read file:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  ipcMain.handle(
    'project:readFileBase64',
    async (
      _event,
      { projectPath, filePath }: { projectPath: string; filePath: string }
    ): Promise<ReadFileBase64Result> => {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, filePath)

        if (!fs.existsSync(fullPath)) {
          return { success: false, error: 'File not found' }
        }

        const buffer = fs.readFileSync(fullPath)
        const stats = fs.statSync(fullPath)

        return {
          success: true,
          base64: buffer.toString('base64'),
          sizeBytes: stats.size,
        }
      } catch (error) {
        console.error('[Project] Failed to read file (base64):', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  ipcMain.handle(
    'project:listFiles',
    async (_event, { projectPath }: { projectPath: string }): Promise<ListFilesResult> => {
      try {
        const files: { path: string; sizeBytes: number }[] = []
        const skippedDirectories = new Set(['.git', ...EXCLUDED_GENERATED_DIRECTORIES])
        const maxFiles = 20000

        function walkDir(dir: string, relativePath = '') {
          if (!fs.existsSync(dir) || files.length >= maxFiles) return

          const entries = fs.readdirSync(dir, { withFileTypes: true })
          for (const entry of entries) {
            if (files.length >= maxFiles) break
            if (entry.isSymbolicLink()) continue

            const relPath = path.join(relativePath, entry.name)
            const fullPath = path.join(dir, entry.name)
            const nameLower = entry.name.toLowerCase()
            const normalizedPathLower = relPath.replace(/\\/g, '/')

            if (entry.isDirectory()) {
              if (!skippedDirectories.has(nameLower)) {
                walkDir(fullPath, relPath)
              }
            } else {
              if (shouldExcludeGeneratedFile(normalizedPathLower)) {
                continue
              }
              const stats = fs.statSync(fullPath)
              files.push({ path: relPath, sizeBytes: stats.size })
            }
          }
        }

        walkDir(projectPath)
        return { success: true, files }
      } catch (error) {
        console.error('[Project] Failed to list files:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  ipcMain.handle(
    'project:renameFile',
    async (
      _event,
      {
        projectPath,
        oldPath,
        newPath,
        origin,
      }: {
        projectPath: string
        oldPath: string
        newPath: string
        origin?: 'agent' | 'remote' | 'sync'
      }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const fullOldPath = resolvePathWithinDirectory(projectPath, oldPath)
        const fullNewPath = resolvePathWithinDirectory(projectPath, newPath)

        if (!fs.existsSync(fullOldPath)) {
          return { success: false, error: 'Source file not found' }
        }

        const newDir = path.dirname(fullNewPath)
        if (!fs.existsSync(newDir)) {
          fs.mkdirSync(newDir, { recursive: true })
        }

        markInternalFsChange(fullOldPath)
        markInternalFsChange(fullNewPath)
        fs.renameSync(fullOldPath, fullNewPath)
        console.log(`[Project] Renamed: ${oldPath} -> ${newPath}`, origin ? { origin } : undefined)

        return { success: true }
      } catch (error) {
        console.error('[Project] Failed to rename file:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  ipcMain.handle(
    'project:deletePath',
    async (
      _event,
      {
        projectPath,
        targetPath,
      }: {
        projectPath: string
        targetPath: string
      }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, targetPath)

        if (!fs.existsSync(fullPath)) {
          return { success: false, error: 'Target not found' }
        }

        const stats = fs.statSync(fullPath)
        markInternalFsChange(fullPath)
        if (stats.isDirectory()) {
          fs.rmSync(fullPath, { recursive: true, force: true })
        } else {
          fs.unlinkSync(fullPath)
        }

        console.log(`[Project] Deleted: ${targetPath}`)
        return { success: true }
      } catch (error) {
        console.error('[Project] Failed to delete path:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  ipcMain.handle(
    'project:copyPath',
    async (
      _event,
      {
        projectPath,
        sourcePath,
        destinationPath,
      }: {
        projectPath: string
        sourcePath: string
        destinationPath: string
      }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const fullSource = resolvePathWithinDirectory(projectPath, sourcePath)
        const fullDestination = resolvePathWithinDirectory(projectPath, destinationPath)

        if (!fs.existsSync(fullSource)) {
          return { success: false, error: 'Source not found' }
        }
        if (fs.existsSync(fullDestination)) {
          return { success: false, error: 'Destination already exists' }
        }

        const destinationDir = path.dirname(fullDestination)
        if (!fs.existsSync(destinationDir)) {
          fs.mkdirSync(destinationDir, { recursive: true })
        }

        const stats = fs.statSync(fullSource)
        if (stats.isDirectory()) {
          fs.cpSync(fullSource, fullDestination, { recursive: true })
        } else {
          fs.copyFileSync(fullSource, fullDestination)
        }

        console.log(`[Project] Copied: ${sourcePath} -> ${destinationPath}`)
        return { success: true }
      } catch (error) {
        console.error('[Project] Failed to copy path:', error)
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Unknown error',
        }
      }
    }
  )

  // Copy project source files from one absolute directory to another.
  // Used when a user chooses use new directory for an existing project path.
  ipcMain.handle(
    'project:copyDirectorySnapshot',
    async (
      _event,
      {
        sourcePath,
        targetPath,
        mode = 'relocation',
      }: {
        sourcePath: string
        targetPath: string
        mode?: 'relocation' | 'raw'
      }
    ): Promise<CopyDirectorySnapshotResult> => {
      try {
        if (!sourcePath || !targetPath) {
          return { success: false, error: 'Source and target paths are required' }
        }

        const normalizedSource = path.resolve(sourcePath)
        const normalizedTarget = path.resolve(targetPath)

        if (!fs.existsSync(normalizedSource) || !fs.statSync(normalizedSource).isDirectory()) {
          return { success: false, error: 'Source project directory does not exist' }
        }

        if (normalizedSource === normalizedTarget) {
          return { success: true, copiedTo: normalizedTarget }
        }

        const sourceWithSep = `${normalizedSource}${path.sep}`
        const targetWithSep = `${normalizedTarget}${path.sep}`
        if (normalizedTarget.startsWith(sourceWithSep) || normalizedSource.startsWith(targetWithSep)) {
          return { success: false, error: 'Source and target directories cannot be nested' }
        }

        if (!fs.existsSync(normalizedTarget)) {
          await fs.promises.mkdir(normalizedTarget, { recursive: true })
        }

        await fs.promises.cp(normalizedSource, normalizedTarget, {
          recursive: true,
          force: true,
          errorOnExist: false,
          filter: (src) => {
            if (mode === 'raw') return true

            const relative = path.relative(normalizedSource, src)
            if (!relative || relative === '') return true

            const normalizedRelative = relative.replace(/\\/g, '/')
            const entryName = path.basename(src)

            if (shouldExcludeGeneratedDirectory(entryName)) return false
            if (shouldExcludeGeneratedFile(normalizedRelative)) return false
            return true
          },
        })

        return { success: true, copiedTo: normalizedTarget }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to copy project files',
        }
      }
    }
  )

  ipcMain.handle(
    'project:preflightImportSource',
    async (
      _event,
      {
        projectPath,
        mode = 'relocation',
      }: {
        projectPath: string
        mode?: 'relocation' | 'raw'
      }
    ): Promise<ImportSourcePreflightResult> => {
      if (!projectPath) {
        return {
          success: false,
          error: 'Project path is required',
        }
      }

      try {
        return await preflightImportSource(projectPath, mode)
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to preflight import source',
        }
      }
    }
  )

  // Watch/unwatch a project folder for external filesystem edits.
  ipcMain.handle(
    'project:watchStart',
    (_event, { projectPath }: { projectPath: string }): WatchProjectResult => {
      return startProjectWatcher(projectPath)
    }
  )

  ipcMain.handle(
    'project:watchStop',
    (_event, { projectPath }: { projectPath: string }): WatchProjectResult => {
      return stopProjectWatcher(projectPath)
    }
  )

  ipcMain.handle('fs:readDir', async (_event, dirPath: string): Promise<FileEntry[]> => {
    try {
      if (!fs.existsSync(dirPath)) {
        return []
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      const result: FileEntry[] = []

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        const isDirectory = entry.isDirectory()

        try {
          const stats = fs.statSync(fullPath)
          result.push({
            name: entry.name,
            path: fullPath,
            type: isDirectory ? 'directory' : 'file',
            size: isDirectory ? undefined : stats.size,
            modifiedAt: stats.mtime.toISOString(),
          })
        } catch {
          // Skip files we cannot stat.
        }
      }

      return result
    } catch (error) {
      console.error('[FS] Failed to read directory:', error)
      return []
    }
  })

  ipcMain.handle('fs:readFile', async (_event, filePath: string): Promise<string | null> => {
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }
      return fs.readFileSync(filePath, 'utf-8')
    } catch (error) {
      console.error('[FS] Failed to read file:', error)
      return null
    }
  })
}
