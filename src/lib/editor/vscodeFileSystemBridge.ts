import {
  FileChangeType,
  FileSystemProviderCapabilities,
  FileSystemProviderError,
  FileSystemProviderErrorCode,
  FileType,
  registerFileSystemOverlay,
  type IFileChange,
  type IFileDeleteOptions,
  type IFileOverwriteOptions,
  type IFileSystemProviderWithFileReadWriteCapability,
  type IFileWriteOptions,
  type IStat,
  type IWatchOptions,
} from '@codingame/monaco-vscode-files-service-override'
import { Emitter, Event } from '@codingame/monaco-vscode-api/vscode/vs/base/common/event'
import { URI } from '@codingame/monaco-vscode-api/vscode/vs/base/common/uri'

type WatchEntry = {
  resourcePath: string
  recursive: boolean
}

const encoder = new TextEncoder()

function uint8ArrayToBase64(bytes: Uint8Array): string {
  let binary = ''
  const chunkSize = 0x8000
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    const chunk = bytes.subarray(offset, offset + chunkSize)
    binary += String.fromCharCode(...chunk)
  }
  return btoa(binary)
}

function base64ToUint8Array(value: string): Uint8Array {
  const binary = atob(value)
  const bytes = new Uint8Array(binary.length)
  for (let index = 0; index < binary.length; index += 1) {
    bytes[index] = binary.charCodeAt(index)
  }
  return bytes
}

function normalizePath(value: string): string {
  return value.replace(/^file:\/\//i, '').replace(/\\/g, '/').replace(/\/+$/, '')
}

function toResourcePath(resource: URI): string {
  return normalizePath(resource.fsPath || resource.path)
}

function getParentPath(value: string): string | null {
  const normalized = normalizePath(value)
  if (!normalized) return null
  const index = normalized.lastIndexOf('/')
  if (index <= 0) {
    return '/'
  }
  return normalized.slice(0, index)
}

function getBaseName(value: string): string {
  const normalized = normalizePath(value)
  const index = normalized.lastIndexOf('/')
  return index === -1 ? normalized : normalized.slice(index + 1)
}

function isWithinProject(resourcePath: string, projectPath: string): boolean {
  return resourcePath === projectPath || resourcePath.startsWith(`${projectPath}/`)
}

function toRelativePath(resourcePath: string, projectPath: string): string {
  if (resourcePath === projectPath) return ''
  if (resourcePath.startsWith(`${projectPath}/`)) {
    return resourcePath.slice(projectPath.length + 1)
  }
  return resourcePath
}

async function readProjectFileBytes(projectPath: string, absolutePath: string): Promise<Uint8Array | null> {
  const relativePath = toRelativePath(absolutePath, projectPath)
  const result = await window.electronAPI.project.readFileBase64({
    projectPath,
    filePath: relativePath,
  })
  if (!result.success || typeof result.base64 !== 'string') {
    return null
  }
  return base64ToUint8Array(result.base64)
}

class ElectronProjectFileSystemProvider implements IFileSystemProviderWithFileReadWriteCapability {
  readonly capabilities = FileSystemProviderCapabilities.FileReadWrite
  readonly onDidChangeCapabilities = Event.None

  private readonly fileChangeEmitter = new Emitter<readonly IFileChange[]>()
  readonly onDidChangeFile = this.fileChangeEmitter.event

  private projectPath: string | null = null
  private readonly watchedPaths = new Set<WatchEntry>()

  setProjectPath(projectPath: string | null): void {
    this.projectPath = projectPath ? normalizePath(projectPath) : null
  }

  watch(resource: URI, opts: IWatchOptions) {
    const entry: WatchEntry = {
      resourcePath: toResourcePath(resource),
      recursive: opts.recursive,
    }
    this.watchedPaths.add(entry)
    return {
      dispose: () => {
        this.watchedPaths.delete(entry)
      },
    }
  }

  async stat(resource: URI): Promise<IStat> {
    const resourcePath = this.ensureReadablePath(resource)
    const now = Date.now()

    if (resourcePath === this.projectPath) {
      return {
        type: FileType.Directory,
        ctime: now,
        mtime: now,
        size: 0,
      }
    }

    const metadata = await this.lookupEntryMetadata(resourcePath)
    if (!metadata) {
      throw FileSystemProviderError.create('File not found', FileSystemProviderErrorCode.FileNotFound)
    }

    return {
      type: metadata.isDirectory ? FileType.Directory : FileType.File,
      ctime: metadata.mtime,
      mtime: metadata.mtime,
      size: metadata.size,
    }
  }

  async readdir(resource: URI): Promise<[string, FileType][]> {
    const resourcePath = this.ensureReadablePath(resource)
    const entries = await window.electronAPI.fs.readDir(resourcePath)
    return entries.map((entry) => [entry.name, entry.type === 'directory' ? FileType.Directory : FileType.File])
  }

  async readFile(resource: URI): Promise<Uint8Array> {
    const resourcePath = this.ensureReadablePath(resource)
    const projectPath = this.projectPath
    if (!projectPath) {
      throw FileSystemProviderError.create('Workspace is not ready', FileSystemProviderErrorCode.Unavailable)
    }

    const bytes = await readProjectFileBytes(projectPath, resourcePath)
    if (!bytes) {
      throw FileSystemProviderError.create('File not found', FileSystemProviderErrorCode.FileNotFound)
    }
    return bytes
  }

  async writeFile(resource: URI, content: Uint8Array, _opts: IFileWriteOptions): Promise<void> {
    const { projectPath, resourcePath } = this.ensureWritablePath(resource)
    const relativePath = toRelativePath(resourcePath, projectPath)
    const result = await window.electronAPI.project.writeFile({
      projectPath,
      filePath: relativePath,
      content: uint8ArrayToBase64(content),
      encoding: 'base64',
    })

    if (!result.success) {
      throw FileSystemProviderError.create(result.error ?? 'Failed to write file', FileSystemProviderErrorCode.Unknown)
    }

    this.emitChange(FileChangeType.UPDATED, resourcePath)
  }

  async mkdir(_resource: URI): Promise<void> {
    throw FileSystemProviderError.create('mkdir is not supported', FileSystemProviderErrorCode.NoPermissions)
  }

  async delete(resource: URI, _opts: IFileDeleteOptions): Promise<void> {
    const { projectPath, resourcePath } = this.ensureWritablePath(resource)
    const relativePath = toRelativePath(resourcePath, projectPath)
    const result = await window.electronAPI.project.deletePath({
      projectPath,
      targetPath: relativePath,
    })

    if (!result.success) {
      throw FileSystemProviderError.create(result.error ?? 'Failed to delete file', FileSystemProviderErrorCode.Unknown)
    }

    this.emitChange(FileChangeType.DELETED, resourcePath)
  }

  async rename(from: URI, to: URI, _opts: IFileOverwriteOptions): Promise<void> {
    const { projectPath, resourcePath: fromPath } = this.ensureWritablePath(from)
    const { resourcePath: toPath } = this.ensureWritablePath(to)

    const result = await window.electronAPI.project.renameFile({
      projectPath,
      oldPath: toRelativePath(fromPath, projectPath),
      newPath: toRelativePath(toPath, projectPath),
    })

    if (!result.success) {
      throw FileSystemProviderError.create(result.error ?? 'Failed to rename file', FileSystemProviderErrorCode.Unknown)
    }

    this.emitChange(FileChangeType.DELETED, fromPath)
    this.emitChange(FileChangeType.ADDED, toPath)
  }

  handleExternalFileChange(filePath: string, type: FileChangeType): void {
    this.emitChange(type, normalizePath(filePath))
  }

  private ensureReadablePath(resource: URI): string {
    const resourcePath = toResourcePath(resource)
    const projectPath = this.projectPath
    if (!projectPath || !isWithinProject(resourcePath, projectPath)) {
      throw FileSystemProviderError.create('File is outside workspace', FileSystemProviderErrorCode.FileNotFound)
    }
    return resourcePath
  }

  private ensureWritablePath(resource: URI): { projectPath: string; resourcePath: string } {
    const projectPath = this.projectPath
    if (!projectPath) {
      throw FileSystemProviderError.create('Workspace is not ready', FileSystemProviderErrorCode.NoPermissions)
    }

    const resourcePath = toResourcePath(resource)
    if (!isWithinProject(resourcePath, projectPath)) {
      throw FileSystemProviderError.create('File is outside workspace', FileSystemProviderErrorCode.NoPermissions)
    }

    return { projectPath, resourcePath }
  }

  private async lookupEntryMetadata(resourcePath: string): Promise<{ isDirectory: boolean; size: number; mtime: number } | null> {
    const parentPath = getParentPath(resourcePath)
    if (!parentPath) return null

    const entries = await window.electronAPI.fs.readDir(parentPath)
    const entry = entries.find((candidate) => candidate.name === getBaseName(resourcePath))
    if (entry) {
      const mtime = entry.modifiedAt ? Date.parse(entry.modifiedAt) : Number.NaN
      return {
        isDirectory: entry.type === 'directory',
        size: entry.type === 'directory' ? 0 : (entry.size ?? 0),
        mtime: Number.isFinite(mtime) ? mtime : Date.now(),
      }
    }

    if (await window.electronAPI.project.pathExists(resourcePath)) {
      const projectPath = this.projectPath
      if (projectPath) {
        const bytes = await readProjectFileBytes(projectPath, resourcePath)
        if (bytes) {
          return {
            isDirectory: false,
            size: bytes.byteLength,
            mtime: Date.now(),
          }
        }
      }

      const content = await window.electronAPI.fs.readFile(resourcePath)
      if (typeof content === 'string') {
        return {
          isDirectory: false,
          size: encoder.encode(content).byteLength,
          mtime: Date.now(),
        }
      }

      return {
        isDirectory: true,
        size: 0,
        mtime: Date.now(),
      }
    }

    return null
  }

  private emitChange(type: FileChangeType, filePath: string): void {
    const projectPath = this.projectPath
    if (!projectPath || !isWithinProject(filePath, projectPath)) {
      return
    }

    const shouldEmit = this.watchedPaths.size === 0 || Array.from(this.watchedPaths).some((watchEntry) => {
      if (watchEntry.resourcePath === filePath) return true
      if (!watchEntry.recursive) return false
      return filePath.startsWith(`${watchEntry.resourcePath}/`)
    })

    if (!shouldEmit) {
      return
    }

    this.fileChangeEmitter.fire([{ type, resource: URI.file(filePath) }])
  }
}

const provider = new ElectronProjectFileSystemProvider()
let overlayRegistered = false
let externalWatchersRegistered = false
let activeWorkspaceProjectPath: string | null = null

export function ensureVscodeFileSystemBridgeInitialized(): void {
  if (!overlayRegistered) {
    registerFileSystemOverlay(1000, provider)
    overlayRegistered = true
  }

  if (externalWatchersRegistered) {
    return
  }

  const handleChange = (filePath: string) => {
    provider.handleExternalFileChange(filePath, FileChangeType.UPDATED)
  }
  const handleDelete = (filePath: string) => {
    provider.handleExternalFileChange(filePath, FileChangeType.DELETED)
  }

  window.electronAPI.yjs?.onExternalFileChange?.((payload) => {
    handleChange(payload.filePath)
  })
  window.electronAPI.yjs?.onExternalFileDelete?.((payload) => {
    handleDelete(payload.filePath)
  })
  window.electronAPI.yjs?.onExternalFileMetaChange?.((payload) => {
    provider.handleExternalFileChange(payload.filePath, FileChangeType.UPDATED)
  })

  externalWatchersRegistered = true
}

export function setVscodeWorkspaceProjectPath(projectPath: string | null): void {
  activeWorkspaceProjectPath = projectPath ? normalizePath(projectPath) : null
  provider.setProjectPath(activeWorkspaceProjectPath)
}

export function getVscodeWorkspaceProjectPath(): string | null {
  return activeWorkspaceProjectPath
}
