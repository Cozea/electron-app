import { shell, type IpcMain } from 'electron'
import fs from 'node:fs'
import path from 'node:path'

import type {
  AppSettings,
  CloneRepositoryResult,
  CopyDirectorySnapshotResult,
  CreateProjectFolderResult,
  FileEntry,
  StorageActionResult,
  ImportSourcePreflightIssue,
  ImportSourcePreflightResult,
  ListFilesResult,
  ReadFileBase64Result,
  ReadFileResult,
  WatchProjectResult,
  WriteFileResult,
} from '../../shared/electronApiTypes'
import { isReadPathAllowed } from '../fsAccess'
import { runGitCommand as runGitRuntimeCommand } from '../gitRuntime'
import { buildGitAuthorizationHeader } from '../services/gitAuth'
import { resolvePathWithinDirectory } from '../pathUtils'
import {
  clearRegisteredProjectPath,
  readRegisteredProjectPath,
  rememberProjectPath,
} from '../projectPathRegistry'
import {
  ensureProjectCollabLane,
  readProjectLaneState,
  setActiveProjectLane,
  upsertProjectLane,
} from '../projectLaneRegistry'
import { resolveKnownProjectPath } from '../projectPathResolution'
import { markInternalFsChange, startProjectWatcher, stopProjectWatcher } from '../projectWatcher'
import {
  checkoutProjectGitBranch,
  createProjectGitWorktree,
  listProjectGitBranches,
} from '../services/projectGitDesktopService'
import {
  EXCLUDED_GENERATED_DIRECTORIES,
  shouldExcludeGeneratedDirectory,
  shouldExcludeGeneratedFile,
} from '../services/generatedArtifactFilters'
import { notifyFileChanged, notifyFileDeleted, notifyFileMetaChanged } from '../yjsNotify'

interface RegisterProjectHandlersDeps {
  loadSettings: () => AppSettings
}

const IMPORT_PREFLIGHT_MAX_ISSUES = 50

function normalizeRelativePathForFilters(relativePath: string): string {
  return relativePath.replace(/\\/g, '/')
}

function shouldExcludeImportGitPath(relativePath: string): boolean {
  const normalizedPath = normalizeRelativePathForFilters(relativePath).replace(/^\/+/, '')
  return normalizedPath === '.git' || normalizedPath.startsWith('.git/')
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
        if (mode === 'relocation' && shouldExcludeImportGitPath(normalizedRelPath)) {
          continue
        }
        if (mode === 'relocation' && shouldExcludeGeneratedDirectory(entry.name)) {
          continue
        }
        queue.push(relPath)
        continue
      }

      if (!entry.isFile()) continue
      if (mode === 'relocation' && shouldExcludeImportGitPath(normalizedRelPath)) {
        continue
      }
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

function resolveAvailableProjectPath(projectsDir: string, slug: string): string {
  const basePath = path.join(projectsDir, slug)
  if (!fs.existsSync(basePath)) {
    return basePath
  }

  let attempt = 2
  while (true) {
    const candidate = path.join(projectsDir, `${slug}-${attempt}`)
    if (!fs.existsSync(candidate)) {
      return candidate
    }
    attempt += 1
  }
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

function normalizeProjectLookup(
  value: unknown,
): { slug: string; projectId?: string } {
  if (typeof value === 'string') {
    return { slug: value }
  }

  if (!value || typeof value !== 'object') {
    return { slug: '' }
  }

  const rawValue = value as {
    slug?: unknown
    projectId?: unknown
  }

  let slug = ''
  if (typeof rawValue.slug === 'string') {
    slug = rawValue.slug
  } else if (
    rawValue.slug &&
    typeof rawValue.slug === 'object' &&
    'slug' in rawValue.slug &&
    typeof (rawValue.slug as { slug?: unknown }).slug === 'string'
  ) {
    slug = (rawValue.slug as { slug: string }).slug
  }

  const projectId = typeof rawValue.projectId === 'string' ? rawValue.projectId : undefined
  return { slug, projectId }
}

export function registerProjectHandlers(
  ipcMain: IpcMain,
  deps: RegisterProjectHandlersDeps
): void {
  ipcMain.handle(
    'project:createFolder',
    async (
      _event,
      {
        slug,
        initGit = true,
        projectId,
        baseDirectory,
      }: {
        slug: string
        initGit?: boolean
        projectId?: string
        baseDirectory?: string
      }
    ): Promise<CreateProjectFolderResult> => {
      const settings = deps.loadSettings()
      const projectsDir = baseDirectory?.trim() || settings.projectsDirectory

      try {
        if (!fs.existsSync(projectsDir)) {
          fs.mkdirSync(projectsDir, { recursive: true })
        }

        const resolvedProjectPath = resolveAvailableProjectPath(projectsDir, slug)

        fs.mkdirSync(resolvedProjectPath, { recursive: true })
        console.log(`[Project] Created folder: ${resolvedProjectPath}`)

        if (initGit) {
          try {
            const initResult = await runGitCommand(['init'], resolvedProjectPath)
            if (!initResult.success) {
              throw new Error(initResult.error)
            }
            console.log(`[Project] Initialized git repo: ${resolvedProjectPath}`)

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
            fs.writeFileSync(path.join(resolvedProjectPath, '.gitignore'), gitignoreContent)
            console.log('[Project] Created .gitignore')
          } catch (gitError) {
            console.warn('[Project] Git init failed:', gitError)
            return {
              success: false,
              error: gitError instanceof Error ? gitError.message : 'Git init failed',
            }
          }
        }

        if (typeof projectId === 'string' && projectId.trim().length > 0) {
          rememberProjectPath(projectId, resolvedProjectPath)
        }

        return {
          success: true,
          localPath: resolvedProjectPath,
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
        projectId,
        baseDirectory,
      }: {
        slug: string
        repoUrl: string
        provider: string
        branch?: string
        accessToken?: string
        projectId?: string
        baseDirectory?: string
      }
    ): Promise<CloneRepositoryResult> => {
      const settings = deps.loadSettings()
      const projectsDir = baseDirectory?.trim() || settings.projectsDirectory
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

        const resolvedTargetPath = resolveAvailableProjectPath(projectsDir, slug)

        const cloneArgs: string[] = []
        const authHeader = buildGitAuthorizationHeader(provider, accessToken)

        if (authHeader && /^https?:\/\//i.test(normalizedRepoUrl)) {
          cloneArgs.push('-c', `http.extraheader=${authHeader}`)
        }

        cloneArgs.push('clone', '--single-branch', '--depth', '1')
        if (branch && branch.trim()) {
          cloneArgs.push('--branch', branch.trim())
        }
        cloneArgs.push(normalizedRepoUrl, resolvedTargetPath)

        const cloneResult = await runGitCommand(cloneArgs, projectsDir)
        if (!cloneResult.success) {
          return {
            success: false,
            error: cloneResult.error,
          }
        }

        if (typeof projectId === 'string' && projectId.trim().length > 0) {
          rememberProjectPath(projectId, resolvedTargetPath)
        }

        return {
          success: true,
          localPath: resolvedTargetPath,
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

  ipcMain.handle(
    'project:getLocalPath',
    async (_event, value: string | { slug: string; projectId?: string }): Promise<string | null> => {
      const { slug, projectId } = normalizeProjectLookup(value)
      const settings = deps.loadSettings()
      if (projectId) {
        const registeredPath = readRegisteredProjectPath(projectId)
        if (registeredPath) {
          return registeredPath
        }
      }
      if (!slug || typeof settings.projectsDirectory !== 'string') {
        console.warn('[ProjectPath] Invalid getLocalPath lookup payload', {
          value,
          normalizedSlug: slug,
          projectId: projectId ?? null,
          projectsDirectoryType: typeof settings.projectsDirectory,
          projectsDirectory: settings.projectsDirectory,
        })
        return null
      }
      const resolvedPath = resolveKnownProjectPath(settings.projectsDirectory, { slug, projectId })
      if (resolvedPath && projectId) {
        rememberProjectPath(projectId, resolvedPath)
      }
      return resolvedPath
    },
  )

  ipcMain.handle(
    'project:rememberLocalPath',
    async (
      _event,
      {
        projectId,
        projectPath,
      }: { projectId: string; projectPath: string }
    ): Promise<{ success: boolean; localPath?: string; error?: string }> => {
      try {
        const localPath = rememberProjectPath(projectId, projectPath)
        return {
          success: true,
          localPath,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to remember project path',
        }
      }
    },
  )

  ipcMain.handle(
    'project:clearLocalPath',
    async (_event, { projectId }: { projectId: string }): Promise<{ success: boolean }> => {
      clearRegisteredProjectPath(projectId)
      return { success: true }
    },
  )

  ipcMain.handle(
    'project:getLaneState',
    async (_event, { projectId }: { projectId: string }) => {
      return readProjectLaneState(projectId)
    },
  )

  ipcMain.handle(
    'project:ensureCollabLane',
    async (
      _event,
      {
        projectId,
        projectPath,
        branch,
      }: { projectId: string; projectPath: string; branch: string }
    ) => {
      return ensureProjectCollabLane({ projectId, projectPath, branch })
    },
  )

  ipcMain.handle(
    'project:upsertLane',
    async (
      _event,
      {
        projectId,
        branch,
        projectPath,
        name,
        isCollab,
        laneId,
      }: {
        projectId: string
        branch: string
        projectPath: string
        name?: string
        isCollab?: boolean
        laneId?: string
      }
    ): Promise<{ success: boolean; laneState?: unknown; error?: string }> => {
      try {
        const laneState = upsertProjectLane({
          projectId,
          branch,
          projectPath,
          name,
          isCollab,
          laneId,
        })
        return { success: true, laneState }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to update project lane',
        }
      }
    },
  )

  ipcMain.handle(
    'project:setActiveLane',
    async (
      _event,
      { projectId, laneId }: { projectId: string; laneId: string }
    ): Promise<{ success: boolean; laneState?: unknown; error?: string }> => {
      try {
        const laneState = setActiveProjectLane({ projectId, laneId })
        return { success: true, laneState }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to activate project lane',
        }
      }
    },
  )

  ipcMain.handle(
    'project:listGitBranches',
    async (_event, { projectPath }: { projectPath: string }) => {
      return listProjectGitBranches(projectPath)
    },
  )

  ipcMain.handle(
    'project:checkoutGitBranch',
    async (_event, { projectPath, branch }: { projectPath: string; branch: string }) => {
      return checkoutProjectGitBranch({ cwd: projectPath, branch })
    },
  )

  ipcMain.handle(
    'project:createGitWorktree',
    async (
      _event,
      options: { projectPath: string; branch: string; newBranch?: string; path?: string | null }
    ) => {
      return createProjectGitWorktree({
        cwd: options.projectPath,
        branch: options.branch,
        newBranch: options.newBranch,
        path: options.path,
      })
    },
  )

  ipcMain.handle(
    'project:mergeLaneIntoCollab',
    async (
      _event,
      {
        collabProjectPath,
        collabBranch,
        sourceBranch,
      }: {
        collabProjectPath: string
        collabBranch: string
        sourceBranch: string
      }
    ): Promise<{ success: boolean; error?: string }> => {
      const resolvedProjectPath = path.resolve(collabProjectPath)
      const normalizedCollabBranch = collabBranch.trim()
      const normalizedSourceBranch = sourceBranch.trim()

      if (!normalizedCollabBranch || !normalizedSourceBranch) {
        return {
          success: false,
          error: 'Both collab branch and source branch are required.',
        }
      }

      try {
        const checkoutResult = await runGitCommand(
          ['checkout', normalizedCollabBranch],
          resolvedProjectPath,
        )
        if (!checkoutResult.success) {
          return {
            success: false,
            error: checkoutResult.error,
          }
        }

        if (normalizedSourceBranch === normalizedCollabBranch) {
          return { success: true }
        }

        const mergeResult = await runGitCommand(
          ['merge', '--no-ff', '--no-edit', normalizedSourceBranch],
          resolvedProjectPath,
        )
        if (!mergeResult.success) {
          return {
            success: false,
            error: mergeResult.error,
          }
        }

        return { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to merge lane into collab',
        }
      }
    },
  )

  ipcMain.handle(
    'project:openFolder',
    async (_event, { projectPath }: { projectPath: string }): Promise<StorageActionResult> => {
      if (!projectPath || typeof projectPath !== 'string') {
        return {
          success: false,
          error: 'Project path is required.',
        }
      }

      try {
        const resolvedPath = path.resolve(projectPath)
        const stats = await fs.promises.stat(resolvedPath)
        if (!stats.isDirectory()) {
          return {
            success: false,
            error: 'Project folder does not exist.',
          }
        }

        const errorMessage = await shell.openPath(resolvedPath)
        return errorMessage ? { success: false, error: errorMessage } : { success: true }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : 'Failed to open project folder.',
        }
      }
    },
  )

  ipcMain.handle(
    'project:exists',
    async (_event, value: string | { slug: string; projectId?: string }): Promise<boolean> => {
      const { slug, projectId } = normalizeProjectLookup(value)
      const settings = deps.loadSettings()
      if (!slug || typeof settings.projectsDirectory !== 'string') {
        console.warn('[ProjectPath] Invalid exists lookup payload', {
          value,
          normalizedSlug: slug,
          projectId: projectId ?? null,
          projectsDirectoryType: typeof settings.projectsDirectory,
        })
        return false
      }
      return resolveKnownProjectPath(settings.projectsDirectory, { slug, projectId }) !== null
    },
  )

  ipcMain.handle(
    'project:pathExists',
    (_event, { projectPath }: { projectPath: string }): boolean => {
      if (!projectPath || typeof projectPath !== 'string') return false
      try {
        return fs.existsSync(projectPath)
      } catch {
        return false
      }
    },
  )

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

        if (origin) {
          const nextStats = fs.statSync(fullNewPath)
          notifyFileDeleted(fullOldPath, { origin })
          notifyFileMetaChanged({
            filePath: fullNewPath,
            origin,
            isBinary: false,
            isDirectory: nextStats.isDirectory(),
            sizeBytes: nextStats.isDirectory() ? 0 : nextStats.size,
          })
        }

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
        origin,
      }: {
        projectPath: string
        targetPath: string
        origin?: 'agent' | 'remote' | 'sync'
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
        if (origin) {
          notifyFileDeleted(fullPath, { origin })
        }
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

            if (shouldExcludeImportGitPath(normalizedRelative)) return false
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
      const settings = deps.loadSettings()
      if (!isReadPathAllowed(dirPath, settings)) {
        console.warn('[FS] Blocked directory read outside approved roots:', dirPath)
        return []
      }

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
      const settings = deps.loadSettings()
      if (!isReadPathAllowed(filePath, settings)) {
        console.warn('[FS] Blocked file read outside approved roots:', filePath)
        return null
      }

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
