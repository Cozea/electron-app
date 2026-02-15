import { contextBridge, ipcRenderer } from 'electron'

import type {
  AppSettings,
  ConflictResolutionRecord,
  ElectronAPI,
  MergeCacheRecord,
  OrganizationMembership,
  PerfBatch,
  ProviderAuthStatusChangedEvent,
  RuntimeKind,
  Session,
  SyncOp,
  SyncWriteFile,
  UpdateState,
} from '../shared/electronApiTypes'

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: () => ipcRenderer.invoke('auth:logout'),
    getSession: () => ipcRenderer.invoke('auth:getSession'),
    refresh: () => ipcRenderer.invoke('auth:refresh'),
    updateOrganizations: (organizations: OrganizationMembership[]) => ipcRenderer.invoke('auth:updateOrganizations', organizations),
    onSuccess: (callback: (session: Session) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, session: Session) => callback(session)
      ipcRenderer.on('auth:success', handler)
      // Return cleanup function
      return () => ipcRenderer.removeListener('auth:success', handler)
    },
    onError: (callback: (error: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, error: string) => callback(error)
      ipcRenderer.on('auth:error', handler)
      // Return cleanup function
      return () => ipcRenderer.removeListener('auth:error', handler)
    },
  },
  providerAuth: {
    listProviders: () => ipcRenderer.invoke('providerAuth:listProviders'),
    getStatus: (provider?: 'openai' | 'anthropic' | 'google') =>
      ipcRenderer.invoke('providerAuth:getStatus', provider),
    connect: (options: {
      provider: 'openai' | 'anthropic' | 'google'
      method?: 'oauth' | 'device' | 'manual_code' | 'vertex' | 'gemini'
      authorizationCode?: string
      credentialPath?: string
    }) => ipcRenderer.invoke('providerAuth:connect', options),
    disconnect: (provider: 'openai' | 'anthropic' | 'google') =>
      ipcRenderer.invoke('providerAuth:disconnect', provider),
    getRequestAuth: (options: {
      provider: 'openai' | 'anthropic' | 'google'
      modelId: string
      organizationId: string
    }) => ipcRenderer.invoke('providerAuth:getRequestAuth', options),
    onStatusChanged: (callback: (event: ProviderAuthStatusChangedEvent) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        event: ProviderAuthStatusChangedEvent
      ) => callback(event)
      ipcRenderer.on('providerAuth:statusChanged', handler)
      return () => ipcRenderer.removeListener('providerAuth:statusChanged', handler)
    },
  },
  integrations: {
    isEncryptionAvailable: () => ipcRenderer.invoke('integrations:isEncryptionAvailable'),
    generateKey: () => ipcRenderer.invoke('integrations:generateKey'),
    storeKey: (options: { keyId: string; keyData: string }) =>
      ipcRenderer.invoke('integrations:storeKey', options),
    getKey: (options: { keyId: string }) =>
      ipcRenderer.invoke('integrations:getKey', options),
    deleteKey: (options: { keyId: string }) =>
      ipcRenderer.invoke('integrations:deleteKey', options),
    keyExists: (options: { keyId: string }) =>
      ipcRenderer.invoke('integrations:keyExists', options),
    encrypt: (options: { credentials: Record<string, unknown>; keyId: string }) =>
      ipcRenderer.invoke('integrations:encrypt', options),
    decrypt: (options: { encrypted: string; keyId: string }) =>
      ipcRenderer.invoke('integrations:decrypt', options),
    onOAuthSuccess: (callback: (data: {
      provider: string
      accessToken?: string
      refreshToken?: string
      tokenExpiresAt?: number
      externalId?: string
      externalAccountName?: string
      scopes?: string[]
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: {
        provider: string
        accessToken?: string
        refreshToken?: string
        tokenExpiresAt?: number
        externalId?: string
        externalAccountName?: string
        scopes?: string[]
      }) => callback(data)
      ipcRenderer.on('integrations:oauthSuccess', handler)
      return () => ipcRenderer.removeListener('integrations:oauthSuccess', handler)
    },
    onOAuthError: (callback: (data: { provider: string; error: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { provider: string; error: string }) => callback(data)
      ipcRenderer.on('integrations:oauthError', handler)
      return () => ipcRenderer.removeListener('integrations:oauthError', handler)
    },
    startOAuth: (options: { provider: string; orgId: string }) =>
      ipcRenderer.invoke('integrations:startOAuth', options),
    runTool: (options: {
      toolName: string
      args: string[]
      workingDir: string
      encryptedCredentials: string
      keyId: string
      timeout?: number
    }) => ipcRenderer.invoke('integrations:runTool', options),
    isToolAvailable: (options: { toolName: string }) =>
      ipcRenderer.invoke('integrations:isToolAvailable', options),
    getToolDefinition: (options: { toolName: string }) =>
      ipcRenderer.invoke('integrations:getToolDefinition', options),
    listTools: () => ipcRenderer.invoke('integrations:listTools'),
  },
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
    }) => ipcRenderer.invoke('db:supabase:select', options),
    firestoreListDocuments: (options: {
      collection: string
      pageSize?: number
      pageToken?: string
      encryptedCredentials: string
      keyId: string
    }) => ipcRenderer.invoke('db:firestore:listDocuments', options),
  },
  tools: {
    run: (request: {
      name: string
      input: Record<string, unknown>
      projectPath?: string
      runId?: string
      toolCallId?: string
    }) =>
      ipcRenderer.invoke('tools:run', request),
    cancel: (request: { runId: string }) => ipcRenderer.invoke('tools:cancel', request),
  },
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
  },
  app: {
    onNavigate: (callback: (path: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, path: string) => callback(path)
      ipcRenderer.on('navigate', handler)
      return () => ipcRenderer.removeListener('navigate', handler)
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', settings),
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
  },
  storage: {
    getUsage: () => ipcRenderer.invoke('storage:getUsage'),
    listProjects: () => ipcRenderer.invoke('storage:listProjects'),
  },
  window: {
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    onFullScreenChange: (callback: (isFullScreen: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) => callback(isFullScreen)
      ipcRenderer.on('window:fullscreen-change', handler)
      return () => ipcRenderer.removeListener('window:fullscreen-change', handler)
    },
  },
  preview: {
    injectBridge: (options: { url: string; frameName?: string }) => ipcRenderer.invoke('preview:injectBridge', options),
    captureScreenshot: (options: { url: string; width?: number; height?: number }) =>
      ipcRenderer.invoke('preview:captureScreenshot', options),
  },
  project: {
    createFolder: (options: { slug: string; initGit?: boolean }) => ipcRenderer.invoke('project:createFolder', options),
    cloneRepository: (options: { slug: string; repoUrl: string; provider: string; branch?: string; accessToken?: string }) =>
      ipcRenderer.invoke('project:cloneRepository', options),
    getLocalPath: (slug: string) => ipcRenderer.invoke('project:getLocalPath', { slug }),
    exists: (slug: string) => ipcRenderer.invoke('project:exists', { slug }),
    pathExists: (projectPath: string) => ipcRenderer.invoke('project:pathExists', { projectPath }),
    writeFile: (options: { projectPath: string; filePath: string; content: string; encoding?: 'utf8' | 'base64' }) => ipcRenderer.invoke('project:writeFile', options),
    readFile: (options: { projectPath: string; filePath: string }) => ipcRenderer.invoke('project:readFile', options),
    readFileBase64: (options: { projectPath: string; filePath: string }) =>
      ipcRenderer.invoke('project:readFileBase64', options),
    listFiles: (options: { projectPath: string }) => ipcRenderer.invoke('project:listFiles', options),
    renameFile: (options: { projectPath: string; oldPath: string; newPath: string }) =>
      ipcRenderer.invoke('project:renameFile', options),
    deletePath: (options: { projectPath: string; targetPath: string }) =>
      ipcRenderer.invoke('project:deletePath', options),
    copyPath: (options: { projectPath: string; sourcePath: string; destinationPath: string }) =>
      ipcRenderer.invoke('project:copyPath', options),
    copyDirectorySnapshot: (options: { sourcePath: string; targetPath: string; mode?: 'relocation' | 'raw' }) =>
      ipcRenderer.invoke('project:copyDirectorySnapshot', options),
    preflightImportSource: (options: { projectPath: string; mode?: 'relocation' | 'raw' }) =>
      ipcRenderer.invoke('project:preflightImportSource', options),
    watchStart: (options: { projectPath: string }) => ipcRenderer.invoke('project:watchStart', options),
    watchStop: (options: { projectPath: string }) => ipcRenderer.invoke('project:watchStop', options),
  },
  runtime: {
    getProjectCapabilities: (options: { projectPath: string }) =>
      ipcRenderer.invoke('runtime:getProjectCapabilities', options),
    resolveCommand: (options: { projectPath: string; command: string }) =>
      ipcRenderer.invoke('runtime:resolveCommand', options),
    ensureCommandRuntime: (options: { projectPath: string; command: string }) =>
      ipcRenderer.invoke('runtime:ensureCommandRuntime', options),
    detectProjectRuntime: (options: { projectPath: string }) =>
      ipcRenderer.invoke('runtime:detectProjectRuntime', options),
    ensureForCommand: (options: { projectPath: string; command: string }) =>
      ipcRenderer.invoke('runtime:ensureForCommand', options),
    ensureRuntime: (options: {
      runtime: RuntimeKind
      target?: string
      cleanBrokenLocalFiles?: boolean
      forceReinstall?: boolean
    }) =>
      ipcRenderer.invoke('runtime:ensureRuntime', options),
    getRuntimeStatus: (options?: { projectPath?: string }) =>
      ipcRenderer.invoke('runtime:getRuntimeStatus', options ?? {}),
  },
  fs: {
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  },
  sync: {
    hashFile: (options: { filePath: string }) => ipcRenderer.invoke('sync:hashFile', options),
    getLocalManifest: (options: { projectPath: string; excludePatterns?: string[]; debugSource?: string; strict?: boolean }) =>
      ipcRenderer.invoke('sync:getLocalManifest', options),
    writeFiles: (options: {
      projectPath: string
      files: SyncWriteFile[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'monaco' | 'agent' | 'watcher' | 'remote'
      }
    }) =>
      ipcRenderer.invoke('sync:writeFiles', options),
    deleteFiles: (options: {
      projectPath: string
      paths: string[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'monaco' | 'agent' | 'watcher' | 'remote'
      }
    }) =>
      ipcRenderer.invoke('sync:deleteFiles', options),
    getGitRuntimeHealth: (options?: { force?: boolean }) =>
      ipcRenderer.invoke('sync:getGitRuntimeHealth', options ?? {}),
    mergePreview: (options: {
      baseContent: string
      localContent: string
      cloudContent: string
      strategy?: 'zdiff3' | 'diff3'
      labels?: { local?: string; base?: string; cloud?: string }
    }) => ipcRenderer.invoke('sync:mergePreview', options),
    mergeTreePreview: (options: {
      baseFiles: Array<{ path: string; content: string }>
      localFiles: Array<{ path: string; content: string }>
      cloudFiles: Array<{ path: string; content: string }>
      maxPreviewFiles?: number
      maxPreviewBytes?: number
    }) => ipcRenderer.invoke('sync:mergeTreePreview', options),
    mergeCacheGet: (options: { key: string }) =>
      ipcRenderer.invoke('sync:mergeCacheGet', options),
    mergeCacheSet: (options: { record: MergeCacheRecord }) =>
      ipcRenderer.invoke('sync:mergeCacheSet', options),
    mergeCacheDelete: (options: { key: string }) =>
      ipcRenderer.invoke('sync:mergeCacheDelete', options),
    mergeCacheGetResolved: (options: { fingerprint: string }) =>
      ipcRenderer.invoke('sync:mergeCacheGetResolved', options),
    mergeCacheSaveResolved: (options: { record: ConflictResolutionRecord }) =>
      ipcRenderer.invoke('sync:mergeCacheSaveResolved', options),
    mergeCachePrune: (options: { threshold: number; maxEntries?: number }) =>
      ipcRenderer.invoke('sync:mergeCachePrune', options),
    resolveConflict: (options: { fingerprint: string; resolvedContent: string }) =>
      ipcRenderer.invoke('sync:resolveConflict', options),
    enqueueOps: (options: { projectId: string; ops: SyncOp[] }) =>
      ipcRenderer.invoke('sync:enqueueOps', options),
    ackOps: (options: { projectId: string; opIds: string[] }) =>
      ipcRenderer.invoke('sync:ackOps', options),
    getReplicaState: (options: { projectId: string }) =>
      ipcRenderer.invoke('sync:getReplicaState', options),
    getHistory: (options: { projectId: string }) =>
      ipcRenderer.invoke('sync:getHistory', options),
    setHistory: (options: {
      projectId: string
      lastSyncAt: number
      cloudPaths: string[]
    }) => ipcRenderer.invoke('sync:setHistory', options),
    gitReplicaBootstrap: (options: {
      projectId: string
      projectPath: string
      sessionId?: string
    }) => ipcRenderer.invoke('sync:gitReplicaBootstrap', options),
    gitReplicaPlan: (options: {
      projectId: string
      projectPath: string
      sessionId?: string
    }) => ipcRenderer.invoke('sync:gitReplicaPlan', options),
    gitReplicaExecute: (options: {
      projectId: string
      projectPath: string
      sessionId: string
      conflictDecisions?: Record<string, 'local' | 'cloud'>
    }) => ipcRenderer.invoke('sync:gitReplicaExecute', options),
    gitReplicaStatus: (options: { projectId: string }) =>
      ipcRenderer.invoke('sync:gitReplicaStatus', options),
    gitReplicaEnqueueSnapshot: (options: {
      projectId: string
      projectPath: string
      source: 'agent' | 'user' | 'external' | 'remote' | 'system'
      reason: string
    }) => ipcRenderer.invoke('sync:gitReplicaEnqueueSnapshot', options),
    gitLfsPutObject: (options: {
      projectId: string
      oid: string
      size: number
      contentBase64: string
    }) => ipcRenderer.invoke('sync:gitLfsPutObject', options),
    gitLfsGetObject: (options: { projectId: string; oid: string }) =>
      ipcRenderer.invoke('sync:gitLfsGetObject', options),
  },
  yjs: {
    onExternalFileChange: (callback: (data: { filePath: string; content: string; origin?: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { filePath: string; content: string; origin?: string }
      ) => callback(data)
      ipcRenderer.on('yjs:external-file-change', handler)
      return () => ipcRenderer.removeListener('yjs:external-file-change', handler)
    },
    onExternalFileMetaChange: (callback: (data: {
      filePath: string
      origin?: string
      isBinary: boolean
      isDirectory?: boolean
      sizeBytes: number
      content?: string
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: {
        filePath: string
        origin?: string
        isBinary: boolean
        isDirectory?: boolean
        sizeBytes: number
        content?: string
      }) => callback(data)
      ipcRenderer.on('yjs:external-file-meta-change', handler)
      return () => ipcRenderer.removeListener('yjs:external-file-meta-change', handler)
    },
    onExternalFileDelete: (callback: (data: { filePath: string; origin?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { filePath: string; origin?: string }) =>
        callback(data)
      ipcRenderer.on('yjs:external-file-delete', handler)
      return () => ipcRenderer.removeListener('yjs:external-file-delete', handler)
    },
  },
  devServer: {
    start: (options: { projectPath: string; command: string; port: number; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('devServer:start', options),
    stop: (options: { projectPath: string }) =>
      ipcRenderer.invoke('devServer:stop', options),
    resize: (options: { projectPath: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('devServer:resize', options),
    isRunning: (options: { projectPath: string }) =>
      ipcRenderer.invoke('devServer:isRunning', options),
    onOutput: (callback: (data: { projectPath: string; output: string; stream: 'stdout' | 'stderr' }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { projectPath: string; output: string; stream: 'stdout' | 'stderr' }) => callback(data)
      ipcRenderer.on('devServer:output', handler)
      return () => ipcRenderer.removeListener('devServer:output', handler)
    },
    onExit: (callback: (data: { projectPath: string; code: number | null }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { projectPath: string; code: number | null }) => callback(data)
      ipcRenderer.on('devServer:exit', handler)
      return () => ipcRenderer.removeListener('devServer:exit', handler)
    },
    onError: (callback: (data: { projectPath: string; error: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { projectPath: string; error: string }) => callback(data)
      ipcRenderer.on('devServer:error', handler)
      return () => ipcRenderer.removeListener('devServer:error', handler)
    },
  },
  terminal: {
    create: (options: { projectPath: string; profileId?: string; cwd?: string; cols?: number; rows?: number }) =>
      ipcRenderer.invoke('terminal:create', options),
    input: (options: { terminalId: string; data: string }) =>
      ipcRenderer.invoke('terminal:input', options),
    resize: (options: { terminalId: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('terminal:resize', options),
    kill: (options: { terminalId: string }) =>
      ipcRenderer.invoke('terminal:kill', options),
    getProfiles: () =>
      ipcRenderer.invoke('terminal:getProfiles'),
    list: (options: { projectPath: string }) =>
      ipcRenderer.invoke('terminal:list', options),
    getInfo: (options: { terminalId: string }) =>
      ipcRenderer.invoke('terminal:getInfo', options),
    onOutput: (callback: (data: { terminalId: string; data: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; data: string }) => callback(data)
      ipcRenderer.on('terminal:output', handler)
      return () => ipcRenderer.removeListener('terminal:output', handler)
    },
    onExit: (callback: (data: { terminalId: string; exitCode: number | null }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; exitCode: number | null }) => callback(data)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
  },
  contextMenu: {
    showTerminalSelection: (options: { selectedText: string; x: number; y: number }) =>
      ipcRenderer.invoke('contextMenu:showTerminalSelection', options),
    showFileTreeMenu: (options: { targetPath: string; isDirectory: boolean; x: number; y: number }) =>
      ipcRenderer.invoke('contextMenu:showFileTreeMenu', options),
  },
  updates: {
    check: () => ipcRenderer.invoke('updates:check'),
    download: () => ipcRenderer.invoke('updates:download'),
    install: () => ipcRenderer.invoke('updates:install'),
    getState: () => ipcRenderer.invoke('updates:getState'),
    onStatus: (callback: (state: UpdateState) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, state: UpdateState) => callback(state)
      ipcRenderer.on('updates:status', handler)
      return () => ipcRenderer.removeListener('updates:status', handler)
    },
  },
  performance: {
    report: (payload: PerfBatch) => ipcRenderer.invoke('performance:report', payload),
  },
  dependencies: {
    inspect: (options: { projectPath: string }) => ipcRenderer.invoke('dependencies:inspect', options),
    run: (options: {
      projectPath: string
      action: 'add' | 'update' | 'remove'
      packageName: string
      version?: string
      dev?: boolean
      updateMode?: 'latest' | 'range'
    }) => ipcRenderer.invoke('dependencies:run', options),
    searchRegistry: (options: { query: string; size?: number }) =>
      ipcRenderer.invoke('dependencies:searchRegistry', options),
    fetchPackageMeta: (options: { names: string[] }) =>
      ipcRenderer.invoke('dependencies:fetchPackageMeta', options),
    onJobStatus: (callback: (payload: {
      projectPath: string
      job: {
        id: string
        action: 'add' | 'update' | 'remove'
        packageName: string
        status: 'running' | 'success' | 'error'
        startedAt: number
        finishedAt?: number
        stdout?: string
        stderr?: string
        error?: string
      }
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: {
        projectPath: string
        job: {
          id: string
          action: 'add' | 'update' | 'remove'
          packageName: string
          status: 'running' | 'success' | 'error'
          startedAt: number
          finishedAt?: number
          stdout?: string
          stderr?: string
          error?: string
        }
      }) => callback(payload)
      ipcRenderer.on('dependencies:job-status', handler)
      return () => ipcRenderer.removeListener('dependencies:job-status', handler)
    },
  },
  diagnostics: {
    start: (options: { projectPath: string }) =>
      ipcRenderer.invoke('diagnostics:start', options),
    stop: (options: { projectPath: string }) =>
      ipcRenderer.invoke('diagnostics:stop', options),
    openFile: (options: { projectPath: string; filePath: string; content: string }) =>
      ipcRenderer.invoke('diagnostics:openFile', options),
    updateFile: (options: { projectPath: string; filePath: string; content: string }) =>
      ipcRenderer.invoke('diagnostics:updateFile', options),
    closeFile: (options: { projectPath: string; filePath: string }) =>
      ipcRenderer.invoke('diagnostics:closeFile', options),
    refresh: (options: { projectPath: string }) =>
      ipcRenderer.invoke('diagnostics:refresh', options),
    getDiagnostics: (options: { projectPath: string; filePath?: string }) =>
      ipcRenderer.invoke('diagnostics:getDiagnostics', options),
    getSnapshot: (options: { projectPath: string; filePaths?: string[] }) =>
      ipcRenderer.invoke('diagnostics:getSnapshot', options),
    checkFiles: (options: { projectPath: string; filePaths: string[]; timeoutMs?: number }) =>
      ipcRenderer.invoke('diagnostics:checkFiles', options),
    onDiagnostics: (callback: (payload: {
      projectPath: string
      source: 'tsserver' | 'eslint' | 'runtime' | 'build'
      diagnostics: Array<{
        id?: string
        source: 'tsserver' | 'eslint' | 'runtime' | 'build'
        severity: 'error' | 'warning' | 'info'
        message: string
        file?: string
        line?: number
        column?: number
        endLine?: number
        endColumn?: number
        code?: string
        related?: Array<{ message: string; file?: string; line?: number; column?: number }>
      }>
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: {
        projectPath: string
        source: 'tsserver' | 'eslint' | 'runtime' | 'build'
        diagnostics: Array<{
          id?: string
          source: 'tsserver' | 'eslint' | 'runtime' | 'build'
          severity: 'error' | 'warning' | 'info'
          message: string
          file?: string
          line?: number
          column?: number
          endLine?: number
          endColumn?: number
          code?: string
          related?: Array<{ message: string; file?: string; line?: number; column?: number }>
        }>
      }) => callback(payload)
      ipcRenderer.on('diagnostics:publish', handler)
      return () => ipcRenderer.removeListener('diagnostics:publish', handler)
    },
    onDidChangeDiagnostics: (callback: (payload: {
      projectPath: string
      source: 'tsserver' | 'eslint' | 'runtime' | 'build'
      diagnostics: Array<{
        id?: string
        source: 'tsserver' | 'eslint' | 'runtime' | 'build'
        severity: 'error' | 'warning' | 'info'
        message: string
        file?: string
        line?: number
        column?: number
        endLine?: number
        endColumn?: number
        code?: string
        related?: Array<{ message: string; file?: string; line?: number; column?: number }>
      }>
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: {
        projectPath: string
        source: 'tsserver' | 'eslint' | 'runtime' | 'build'
        diagnostics: Array<{
          id?: string
          source: 'tsserver' | 'eslint' | 'runtime' | 'build'
          severity: 'error' | 'warning' | 'info'
          message: string
          file?: string
          line?: number
          column?: number
          endLine?: number
          endColumn?: number
          code?: string
          related?: Array<{ message: string; file?: string; line?: number; column?: number }>
        }>
      }) => callback(payload)
      ipcRenderer.on('diagnostics:publish', handler)
      return () => ipcRenderer.removeListener('diagnostics:publish', handler)
    },
  },
} satisfies ElectronAPI)
