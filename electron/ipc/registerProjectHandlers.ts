import { shell, type IpcMain } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'

import type {
  AppSettings,
  CopyDirectorySnapshotResult,
  CreateGitHubRepoResult,
  FileEntry,
  GhCliStatus,
  StorageActionResult,
  ImportSourcePreflightIssue,
  ImportSourcePreflightResult,
  ListFilesResult,
  ProjectPathNativeIconResult,
  ReadFileBase64Result,
  ReadFileResult,
  WatchProjectResult,
  WriteFileResult,
} from '../../shared/electronApiTypes'
import { isReadPathAllowed } from '../fsAccess'
import { runGitCommand as runGitRuntimeCommand } from '../gitRuntime'
import { resolvePathWithinDirectory } from '../pathUtils'
import { markInternalFsChange, startProjectWatcher, stopProjectWatcher } from '../projectWatcher'
import {
  checkoutProjectGitBranch,
  createProjectGitWorktree,
  listProjectGitBranches,
} from '../services/projectGitDesktopService'
import {
  shouldExcludeGeneratedDirectory,
  shouldExcludeGeneratedFile,
} from '../services/generatedArtifactFilters'
import { listProjectFilesFromIndex } from '../services/ProjectFileIndexService'
import { getProjectContextOptionsFromAnalysis } from '../services/ProjectAnalysisService'
import { notifyFileChanged, notifyFileDeleted, notifyFileMetaChanged } from '../yjsNotify'
import { resolveAuthorizedWorkspaceAccess } from '../workspaces/authorization'

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
): { slug: string; projectId?: string; localPathHint?: string; attachedPathHint?: string } {
  if (typeof value === 'string') {
    return { slug: value }
  }

  if (!value || typeof value !== 'object') {
    return { slug: '' }
  }

  const rawValue = value as {
    slug?: unknown
    projectId?: unknown
    localPathHint?: unknown
    attachedPathHint?: unknown
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
  const localPathHint =
    typeof rawValue.localPathHint === 'string' ? rawValue.localPathHint : undefined
  const attachedPathHint =
    typeof rawValue.attachedPathHint === 'string' ? rawValue.attachedPathHint : undefined
  return { slug, projectId, localPathHint, attachedPathHint }
}



export function registerProjectHandlers(
  ipcMain: IpcMain,
  deps: RegisterProjectHandlersDeps
): void {
  ipcMain.handle(
    'project:listGitBranches',
    async (_event, { workspaceId }: { workspaceId: string }) => {
      let projectPath: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'git-read' })
        projectPath = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, isRepo: false, hasOriginRemote: false, branches: [], error: String(e) }
      }
      return listProjectGitBranches(projectPath)
    },
  )

  ipcMain.handle(
    'project:checkoutGitBranch',
    async (_event, { workspaceId, branch }: { workspaceId: string; branch: string }) => {
      let projectPath: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return checkoutProjectGitBranch({ cwd: projectPath, branch })
    },
  )

  ipcMain.handle(
    'project:createGitWorktree',
    async (
      _event,
      options: { workspaceId: string; branch: string; newBranch?: string; path?: string | null }
    ) => {
      let projectPath: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId: options.workspaceId, operation: 'git-write' })
        projectPath = access.gitRootPath ?? access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }
      return createProjectGitWorktree({
        cwd: projectPath,
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
    'project:getPathNativeIcon',
    async (): Promise<ProjectPathNativeIconResult> => ({
      success: false,
      error: 'Native project icons are temporarily disabled.',
    }),
  )

  ipcMain.handle(
    'project:openFolder',
    async (_event, { workspaceId }: { workspaceId: string }): Promise<StorageActionResult> => {
      if (!workspaceId || typeof workspaceId !== 'string') {
        return {
          success: false,
          error: 'Project path is required.',
        }
      }

      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'read-file' })
        const resolvedPath = path.resolve(access.projectRootPath)
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
      const { slug } = normalizeProjectLookup(value)
      const settings = deps.loadSettings()
      if (!slug || typeof settings.projectsDirectory !== 'string') {
        console.warn('[ProjectPath] Invalid exists lookup payload', {
          value,
          normalizedSlug: slug,
          projectsDirectoryType: typeof settings.projectsDirectory,
        })
        return false
      }
      const candidate = path.resolve(settings.projectsDirectory, slug)
      const projectsDirectory = path.resolve(settings.projectsDirectory)
      const relative = path.relative(projectsDirectory, candidate)
      if (relative.startsWith('..') || path.isAbsolute(relative)) {
        return false
      }
      return fs.existsSync(candidate)
    },
  )

  ipcMain.handle(
    'project:pathExists',
    async (_event, { workspaceId }: { workspaceId: string }): Promise<boolean> => {
      if (!workspaceId || typeof workspaceId !== 'string') return false
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'read-file' })
        return fs.existsSync(access.projectRootPath)
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
        workspaceId,
        filePath,
        content,
        encoding = 'utf8',
        origin = 'agent',
      }: {
        workspaceId: string
        filePath: string
        content: string
        encoding?: 'utf8' | 'base64'
        origin?: 'agent' | 'remote' | 'sync'
      }
    ): Promise<WriteFileResult> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'write-file', relativePath: filePath })
        const fullPath = access.fullPath!
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
          notifyFileChanged(fullPath, content, {
            origin,
            workspaceId,
            projectRootPath: access.projectRootPath,
            relativePath: filePath,
          })
        }
        notifyFileMetaChanged({
          filePath: fullPath,
          workspaceId,
          projectRootPath: access.projectRootPath,
          relativePath: filePath,
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
      { workspaceId, filePath }: { workspaceId: string; filePath: string }
    ): Promise<ReadFileResult> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'read-file', relativePath: filePath })
        const fullPath = access.fullPath!

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
      { workspaceId, filePath }: { workspaceId: string; filePath: string }
    ): Promise<ReadFileBase64Result> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'read-file', relativePath: filePath })
        const fullPath = access.fullPath!

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
    async (_event, { workspaceId }: { workspaceId: string }): Promise<ListFilesResult> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'list-files' })
        return await listProjectFilesFromIndex(access.projectRootPath)
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
    'project:getContextOptions',
    async (
      _event,
      {
        workspaceId,
        frameworkInfo,
      }: {
        workspaceId: string
        frameworkInfo?: import('../../shared/electronApiTypes').ProjectStoredFrameworkInfo | null
      },
    ) => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'read-file' })
        return await getProjectContextOptionsFromAnalysis({ projectPath: access.projectRootPath, frameworkInfo })
      } catch (e) {
        return { success: false, error: String(e) }
      }
    },
  )

  ipcMain.handle(
    'project:renameFile',
    async (
      _event,
      {
        workspaceId,
        oldPath,
        newPath,
        origin,
      }: {
        workspaceId: string
        oldPath: string
        newPath: string
        origin?: 'agent' | 'remote' | 'sync'
      }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'write-file' })
        const fullOldPath = resolvePathWithinDirectory(access.projectRootPath, oldPath)
        const fullNewPath = resolvePathWithinDirectory(access.projectRootPath, newPath)

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
          notifyFileDeleted(fullOldPath, {
            origin,
            workspaceId,
            projectRootPath: access.projectRootPath,
            relativePath: oldPath,
          })
          notifyFileMetaChanged({
            filePath: fullNewPath,
            workspaceId,
            projectRootPath: access.projectRootPath,
            relativePath: newPath,
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
        workspaceId,
        targetPath,
        origin,
      }: {
        workspaceId: string
        targetPath: string
        origin?: 'agent' | 'remote' | 'sync'
      }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'delete-file', relativePath: targetPath })
        const fullPath = access.fullPath!

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
          notifyFileDeleted(fullPath, {
            origin,
            workspaceId,
            projectRootPath: access.projectRootPath,
            relativePath: targetPath,
          })
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
        workspaceId,
        sourcePath,
        destinationPath,
      }: {
        workspaceId: string
        sourcePath: string
        destinationPath: string
      }
    ): Promise<{ success: boolean; error?: string }> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'write-file' })
        const fullSource = resolvePathWithinDirectory(access.projectRootPath, sourcePath)
        const fullDestination = resolvePathWithinDirectory(access.projectRootPath, destinationPath)

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
        workspaceId,
        mode = 'relocation',
      }: {
        workspaceId: string
        mode?: 'relocation' | 'raw'
      }
    ): Promise<ImportSourcePreflightResult> => {
      if (!workspaceId) {
        return {
          success: false,
          error: 'Project path is required',
        }
      }

      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'import-read' })
        return await preflightImportSource(access.projectRootPath, mode)
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
    async (_event, { workspaceId }: { workspaceId: string }): Promise<WatchProjectResult> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'read-file' })
        return startProjectWatcher(access.projectRootPath, workspaceId)
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )

  ipcMain.handle(
    'project:watchStop',
    async (_event, { workspaceId }: { workspaceId: string }): Promise<WatchProjectResult> => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'read-file' })
        return stopProjectWatcher(access.projectRootPath)
      } catch (e) {
        return { success: false, error: String(e) }
      }
    }
  )

  /**
   * System-level, read-only file APIs that rely on `approvedExternalReadRoots`.
   * These MUST NOT be used for reading project files inside a workspace.
   * For workspace files, use `project.readFile` or `project.listFiles` with a `workspaceId`.
   */
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

  // ---------------------------------------------------------------------------
  // GitHub CLI helpers
  // ---------------------------------------------------------------------------

  function runGhCommand(
    args: string[],
    options?: { cwd?: string; timeoutMs?: number }
  ): Promise<{ success: boolean; stdout: string; stderr: string; error?: string }> {
    const timeoutMs = options?.timeoutMs ?? 15_000
    return new Promise((resolve) => {
      let child: ChildProcess
      try {
        child = spawn('gh', args, {
          cwd: options?.cwd,
          stdio: 'pipe',
          env: { ...process.env },
        })
      } catch (error) {
        resolve({
          success: false,
          stdout: '',
          stderr: '',
          error: error instanceof Error ? error.message : 'Failed to spawn gh',
        })
        return
      }

      let stdout = ''
      let stderr = ''
      let settled = false

      const timer = setTimeout(() => {
        if (!settled) {
          settled = true
          child.kill('SIGTERM')
          resolve({ success: false, stdout, stderr, error: 'gh command timed out' })
        }
      }, timeoutMs)

      child.stdout?.on('data', (chunk: Buffer) => { stdout += chunk.toString() })
      child.stderr?.on('data', (chunk: Buffer) => { stderr += chunk.toString() })

      child.on('error', (error) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        const isNotFound =
          (error as NodeJS.ErrnoException).code === 'ENOENT' ||
          error.message.includes('ENOENT')
        resolve({
          success: false,
          stdout,
          stderr,
          error: isNotFound
            ? 'GitHub CLI (`gh`) is not installed.'
            : error.message,
        })
      })

      child.on('close', (code) => {
        if (settled) return
        settled = true
        clearTimeout(timer)
        resolve({
          success: code === 0,
          stdout,
          stderr,
          error: code !== 0 ? stderr.trim() || `gh exited with code ${code}` : undefined,
        })
      })
    })
  }

  ipcMain.handle(
    'project:checkGhCliStatus',
    async (): Promise<GhCliStatus> => {
      const result = await runGhCommand(['auth', 'status'])

      if (!result.success) {
        return {
          available: false,
          error: result.error ?? 'GitHub CLI is not available or not authenticated.',
        }
      }

      // `gh auth status` prints to stderr, so we combine both streams
      const combined = `${result.stdout}\n${result.stderr}`
      const usernameMatch = combined.match(/Logged in to [\w.]+\s+.*?account\s+(\S+)/i)
        ?? combined.match(/account\s+(\S+)/i)
        ?? combined.match(/✓\s+Logged in to \S+ as (\S+)/i)

      return {
        available: true,
        username: usernameMatch?.[1]?.replace(/\s*\(.*\)$/, '') ?? undefined,
      }
    }
  )

  ipcMain.handle(
    'project:createGitHubRepo',
    async (
      _event,
      { workspaceId, name, visibility = 'private' }: { workspaceId: string; name: string; visibility?: 'private' | 'public' }
    ): Promise<CreateGitHubRepoResult> => {
      let localPath: string
      try {
        const access = await resolveAuthorizedWorkspaceAccess({ workspaceId, operation: 'integration-tool' })
        localPath = access.projectRootPath
      } catch (e) {
        return { success: false, error: String(e) }
      }

      const trimmedName = name.trim()
      if (!trimmedName) {
        return { success: false, error: 'Repository name is required.' }
      }

      if (!fs.existsSync(localPath)) {
        return { success: false, error: 'Local project folder does not exist.' }
      }

      // Ensure the folder has a git repo (it should from createFolder with initGit)
      const gitDir = path.join(localPath, '.git')
      if (!fs.existsSync(gitDir)) {
        const initResult = await runGitCommand(['init'], localPath)
        if (!initResult.success) {
          return { success: false, error: initResult.error ?? 'Failed to initialize git.' }
        }
      }

      // Create the GitHub repo and set it as origin
      const visibilityFlag = visibility === 'public' ? '--public' : '--private'
      const result = await runGhCommand(
        ['repo', 'create', trimmedName, visibilityFlag, '--source', localPath, '--remote', 'origin'],
        { cwd: localPath, timeoutMs: 30_000 }
      )

      if (!result.success) {
        // Provide a friendlier message for common errors
        const errLower = (result.error ?? '').toLowerCase()
        if (errLower.includes('name already exists') || errLower.includes('already exists')) {
          return {
            success: false,
            error: `A GitHub repository named "${trimmedName}" already exists on your account. Choose a different project name.`,
          }
        }
        if (errLower.includes('not logged in') || errLower.includes('gh auth login')) {
          return {
            success: false,
            error: 'GitHub CLI is not authenticated. Run `gh auth login` first.',
          }
        }
        return { success: false, error: result.error ?? 'Failed to create GitHub repository.' }
      }

      // Extract the repo URL from stdout (gh repo create prints the URL)
      const repoUrl = result.stdout.trim().split('\n').pop()?.trim() ?? undefined

      return { success: true, repoUrl }
    }
  )
}
