// Re-export shared types for convenience
export type { User, OrganizationMembership, Session } from '../../shared/types'

// Import for use in this file
import type { Session, OrganizationMembership } from '../../shared/types'

export interface AppSettings {
  projectsDirectory: string
}

export interface StorageUsage {
  projects: number
  dependencies: number
  buildCache: number
  logs: number
  total: number
  diskTotal: number
  diskFree: number
}

export interface LocalProject {
  name: string
  path: string
  size: number
  lastModified: number
}

export interface CreateProjectFolderResult {
  success: boolean
  localPath?: string
  error?: string
}

export interface WriteFileResult {
  success: boolean
  fullPath?: string
  sizeBytes?: number
  error?: string
}

export interface ReadFileResult {
  success: boolean
  content?: string
  sizeBytes?: number
  error?: string
}

export interface ListFilesResult {
  success: boolean
  files?: { path: string; sizeBytes: number }[]
  error?: string
}

// Sync types
export interface FileManifestEntry {
  path: string
  hash: string
  size: number
  mtime: number
}

export interface SyncWriteFilesResult {
  results: Array<{ path: string; success: boolean; error?: string }>
  successCount: number
}

export interface SyncDeleteFilesResult {
  results: Array<{ path: string; success: boolean }>
}

export interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: string
}

// Terminal types
export interface TerminalProfile {
  id: string
  name: string
  path: string
  args?: string[]
  env?: Record<string, string>
  icon?: string
}

export interface TerminalInfo {
  id: string
  profileId: string
  profileName: string
  title: string
}

export interface ElectronAPI {
  platform: NodeJS.Platform
  auth: {
    login: () => Promise<{ success: boolean }>
    logout: () => Promise<{ success: boolean }>
    getSession: () => Promise<Session | null>
    refresh: () => Promise<Session | null>
    updateOrganizations: (organizations: OrganizationMembership[]) => Promise<{ success: boolean; error?: string }>
    onSuccess: (callback: (session: Session) => void) => () => void
    onError: (callback: (error: string) => void) => () => void
  }
  tools: {
    run: (request: { name: string; input: Record<string, unknown>; projectPath?: string }) => Promise<{ success: boolean; output?: unknown; error?: string }>
  }
  shell: {
    openExternal: (url: string) => Promise<{ success: boolean }>
  }
  settings: {
    get: () => Promise<AppSettings>
    set: (settings: Partial<AppSettings>) => Promise<{ success: boolean }>
  }
  dialog: {
    selectDirectory: () => Promise<{ success: boolean; path?: string; canceled?: boolean; error?: string }>
  }
  storage: {
    getUsage: () => Promise<StorageUsage>
    listProjects: () => Promise<LocalProject[]>
  }
  window: {
    isFullScreen: () => Promise<boolean>
    onFullScreenChange: (callback: (isFullScreen: boolean) => void) => () => void
  }
  project: {
    createFolder: (options: { slug: string; initGit?: boolean }) => Promise<CreateProjectFolderResult>
    getLocalPath: (slug: string) => Promise<string | null>
    exists: (slug: string) => Promise<boolean>
    writeFile: (options: { projectPath: string; filePath: string; content: string }) => Promise<WriteFileResult>
    readFile: (options: { projectPath: string; filePath: string }) => Promise<ReadFileResult>
    listFiles: (options: { projectPath: string }) => Promise<ListFilesResult>
  }
  fs: {
    readDir: (path: string) => Promise<FileEntry[]>
    readFile: (path: string) => Promise<string | null>
  }
  sync: {
    hashFile: (options: { filePath: string }) => Promise<{ hash: string; size: number }>
    getLocalManifest: (options: { projectPath: string; excludePatterns?: string[] }) =>
      Promise<{ manifest: FileManifestEntry[]; totalFiles: number }>
    writeFiles: (options: { projectPath: string; files: Array<{ path: string; content: string }> }) =>
      Promise<SyncWriteFilesResult>
    deleteFiles: (options: { projectPath: string; paths: string[] }) =>
      Promise<SyncDeleteFilesResult>
  }
  yjs: {
    onExternalFileChange: (callback: (data: { filePath: string; content: string }) => void) => () => void
  }
  devServer: {
    start: (options: { projectPath: string; command: string; port: number; cols?: number; rows?: number }) => Promise<{ success: boolean; pid?: number; error?: string }>
    stop: (options: { projectPath: string }) => Promise<{ success: boolean; error?: string }>
    resize: (options: { projectPath: string; cols: number; rows: number }) => Promise<{ success: boolean }>
    isRunning: (options: { projectPath: string }) => Promise<boolean>
    onOutput: (callback: (data: { projectPath: string; output: string; stream: 'stdout' | 'stderr' }) => void) => () => void
    onExit: (callback: (data: { projectPath: string; code: number | null }) => void) => () => void
    onError: (callback: (data: { projectPath: string; error: string }) => void) => () => void
  }
  terminal: {
    create: (options: {
      projectPath: string
      profileId?: string
      cwd?: string
      cols?: number
      rows?: number
    }) => Promise<{ success: boolean; terminalId?: string; error?: string }>
    input: (options: { terminalId: string; data: string }) => Promise<void>
    resize: (options: { terminalId: string; cols: number; rows: number }) => Promise<{ success: boolean }>
    kill: (options: { terminalId: string }) => Promise<{ success: boolean }>
    getProfiles: () => Promise<TerminalProfile[]>
    list: (options: { projectPath: string }) => Promise<string[]>
    getInfo: (options: { terminalId: string }) => Promise<TerminalInfo | null>
    onOutput: (callback: (data: { terminalId: string; data: string }) => void) => () => void
    onExit: (callback: (data: { terminalId: string; exitCode: number | null }) => void) => () => void
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
