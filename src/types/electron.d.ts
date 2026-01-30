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

export interface ReadFileBase64Result {
  success: boolean
  base64?: string
  sizeBytes?: number
  error?: string
}

export interface ListFilesResult {
  success: boolean
  files?: { path: string; sizeBytes: number }[]
  error?: string
}

export interface PreviewInjectBridgeResult {
  success: boolean
  error?: string
}

export interface PreviewCaptureScreenshotResult {
  success: boolean
  base64?: string
  error?: string
}

export interface WatchProjectResult {
  success: boolean
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

export interface SyncWriteFile {
  path: string
  content: string
  encoding?: 'utf8' | 'base64'
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

// Integration types
export interface IntegrationKeyResult {
  success: boolean
  keyId?: string
  keyData?: string
  error?: string
}

export interface IntegrationEncryptResult {
  success: boolean
  encrypted?: string
  error?: string
}

export interface IntegrationDecryptResult {
  success: boolean
  credentials?: Record<string, unknown>
  error?: string
}

export interface IntegrationToolDefinition {
  provider: string
  name: string
  displayName: string
  command: string
  description: string
}

export interface IntegrationToolResult {
  success: boolean
  stdout?: string
  stderr?: string
  exitCode?: number | null
  timedOut?: boolean
  error?: string
}

export interface DbSupabaseSelectResult {
  success: boolean
  rows?: unknown[]
  error?: string
}

export interface DbFirestoreDocument {
  id: string
  path: string
  createTime?: string
  updateTime?: string
  fields: Record<string, unknown>
}

export interface DbFirestoreListDocumentsResult {
  success: boolean
  documents?: DbFirestoreDocument[]
  nextPageToken?: string
  error?: string
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
  integrations: {
    // Encryption key management (keys stored in OS keychain)
    isEncryptionAvailable: () => Promise<boolean>
    generateKey: () => Promise<IntegrationKeyResult>
    storeKey: (options: { keyId: string; keyData: string }) => Promise<{ success: boolean; error?: string }>
    getKey: (options: { keyId: string }) => Promise<IntegrationKeyResult>
    deleteKey: (options: { keyId: string }) => Promise<{ success: boolean; error?: string }>
    keyExists: (options: { keyId: string }) => Promise<boolean>
    // Credential encryption/decryption
    encrypt: (options: { credentials: Record<string, unknown>; keyId: string }) => Promise<IntegrationEncryptResult>
    decrypt: (options: { encrypted: string; keyId: string }) => Promise<IntegrationDecryptResult>
    // OAuth events
    onOAuthSuccess: (callback: (data: {
      provider: string
      accessToken?: string
      refreshToken?: string
      tokenExpiresAt?: number
      externalId?: string
      externalAccountName?: string
      scopes?: string[]
    }) => void) => () => void
    onOAuthError: (callback: (data: { provider: string; error: string }) => void) => () => void
    startOAuth: (options: { provider: string; orgId: string }) => Promise<{ success: boolean; error?: string }>
    // Integration tool execution
    runTool: (options: {
      toolName: string
      args: string[]
      workingDir: string
      encryptedCredentials: string
      keyId: string
      timeout?: number
    }) => Promise<IntegrationToolResult>
    isToolAvailable: (options: { toolName: string }) => Promise<boolean>
    getToolDefinition: (options: { toolName: string }) => Promise<IntegrationToolDefinition | null>
    listTools: () => Promise<IntegrationToolDefinition[]>
  }
  database: {
    supabaseSelect: (options: {
      table: string
      select?: string
      limit?: number
      offset?: number
      orderBy?: string
      orderAscending?: boolean
      credentials?: { url: string; anonKey: string }
      encryptedCredentials?: string
      keyId?: string
    }) => Promise<DbSupabaseSelectResult>
    firestoreListDocuments: (options: {
      collection: string
      pageSize?: number
      pageToken?: string
      encryptedCredentials: string
      keyId: string
    }) => Promise<DbFirestoreListDocumentsResult>
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
  preview: {
    injectBridge: (options: { url: string }) => Promise<PreviewInjectBridgeResult>
    captureScreenshot: (options: { url: string; width?: number; height?: number }) => Promise<PreviewCaptureScreenshotResult>
  }
  project: {
    createFolder: (options: { slug: string; initGit?: boolean }) => Promise<CreateProjectFolderResult>
    getLocalPath: (slug: string) => Promise<string | null>
    exists: (slug: string) => Promise<boolean>
    writeFile: (options: { projectPath: string; filePath: string; content: string }) => Promise<WriteFileResult>
    readFile: (options: { projectPath: string; filePath: string }) => Promise<ReadFileResult>
    readFileBase64: (options: { projectPath: string; filePath: string }) => Promise<ReadFileBase64Result>
    listFiles: (options: { projectPath: string }) => Promise<ListFilesResult>
    watchStart: (options: { projectPath: string }) => Promise<WatchProjectResult>
    watchStop: (options: { projectPath: string }) => Promise<WatchProjectResult>
  }
  fs: {
    readDir: (path: string) => Promise<FileEntry[]>
    readFile: (path: string) => Promise<string | null>
  }
  sync: {
    hashFile: (options: { filePath: string }) => Promise<{ hash: string; size: number }>
    getLocalManifest: (options: { projectPath: string; excludePatterns?: string[] }) =>
      Promise<{ manifest: FileManifestEntry[]; totalFiles: number }>
    writeFiles: (options: { projectPath: string; files: SyncWriteFile[] }) =>
      Promise<SyncWriteFilesResult>
    deleteFiles: (options: { projectPath: string; paths: string[] }) =>
      Promise<SyncDeleteFilesResult>
  }
  yjs: {
    onExternalFileChange: (callback: (data: { filePath: string; content: string; origin?: string }) => void) => () => void
    onExternalFileDelete: (callback: (data: { filePath: string; origin?: string }) => void) => () => void
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
  contextMenu: {
    showTerminalSelection: (options: { selectedText: string; x: number; y: number }) => Promise<{ action: string | null }>
  }
}

declare global {
  interface Window {
    electronAPI: ElectronAPI
  }
}
