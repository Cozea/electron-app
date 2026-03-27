import { contextBridge, ipcRenderer } from 'electron'

import type {
  AppSettings,
  ElectronAPI,
  ElectronWindowContext,
  OrganizationMembership,
  RuntimeKind,
  Session,
  SyncOp,
  SyncWriteFile,
  UpdateState,
} from '../shared/electronApiTypes'
import type { MessageBoxOptions } from 'electron'

const WINDOW_CONTEXT_ARG_PREFIX = '--cozea-window='

function resolveWindowContext(argv: readonly string[]): ElectronWindowContext {
  const contextArg = argv.find((value) => value.startsWith(WINDOW_CONTEXT_ARG_PREFIX))
  const rawContext = contextArg?.slice(WINDOW_CONTEXT_ARG_PREFIX.length)
  return rawContext === 'settings' ? 'settings' : 'main'
}

const windowContext = resolveWindowContext(process.argv)

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  windowContext,
  auth: {
    login: () => ipcRenderer.invoke('auth:login'),
    logout: (options?: { accessToken?: string | null }) => ipcRenderer.invoke('auth:logout', options),
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
  integrations: {
    isEncryptionAvailable: () => ipcRenderer.invoke('integrations:isEncryptionAvailable'),
    generateKey: () => ipcRenderer.invoke('integrations:generateKey'),
    storeKey: (options: { keyId: string; keyData: string }) =>
      ipcRenderer.invoke('integrations:storeKey', options),
    deleteKey: (options: { keyId: string }) =>
      ipcRenderer.invoke('integrations:deleteKey', options),
    keyExists: (options: { keyId: string }) =>
      ipcRenderer.invoke('integrations:keyExists', options),
    encrypt: (options: { credentials: Record<string, unknown>; keyId: string }) =>
      ipcRenderer.invoke('integrations:encrypt', options),
    onOAuthSuccess: (callback: (data: {
      provider: string
      accessToken?: string
      refreshToken?: string
      tokenExpiresAt?: number
      externalId?: string
      externalAccountName?: string
      scopes?: string[]
      metadata?: Record<string, unknown>
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: {
        provider: string
        accessToken?: string
        refreshToken?: string
        tokenExpiresAt?: number
        externalId?: string
        externalAccountName?: string
        scopes?: string[]
        metadata?: Record<string, unknown>
      }) => callback(data)
      ipcRenderer.on('integrations:oauthSuccess', handler)
      return () => ipcRenderer.removeListener('integrations:oauthSuccess', handler)
    },
    onOAuthError: (callback: (data: { provider: string; error: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { provider: string; error: string }) => callback(data)
      ipcRenderer.on('integrations:oauthError', handler)
      return () => ipcRenderer.removeListener('integrations:oauthError', handler)
    },
    startOAuth: (options: { provider: string; orgId: string; metadata?: Record<string, unknown> }) =>
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
  sourceControl: {
    onOAuthSuccess: (callback: (data: {
      provider: string
      accessToken?: string
      refreshToken?: string
      tokenExpiresAt?: number
      externalId?: string
      externalAccountName?: string
      scopes?: string[]
      metadata?: Record<string, unknown>
    }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: {
        provider: string
        accessToken?: string
        refreshToken?: string
        tokenExpiresAt?: number
        externalId?: string
        externalAccountName?: string
        scopes?: string[]
        metadata?: Record<string, unknown>
      }) => callback(data)
      ipcRenderer.on('sourceControl:oauthSuccess', handler)
      return () => ipcRenderer.removeListener('sourceControl:oauthSuccess', handler)
    },
    onOAuthError: (callback: (data: { provider: string; error: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { provider: string; error: string }) => callback(data)
      ipcRenderer.on('sourceControl:oauthError', handler)
      return () => ipcRenderer.removeListener('sourceControl:oauthError', handler)
    },
    startOAuth: (options: { provider: 'github' | 'gitlab'; orgId: string; metadata?: Record<string, unknown> }) =>
      ipcRenderer.invoke('sourceControl:startOAuth', options),
    listRepositoryOwners: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      bypassCache?: boolean
    }) => ipcRenderer.invoke('sourceControl:listRepositoryOwners', options),
    listRepositoriesPage: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      ownerId?: string
      ownerLogin?: string
      ownerKind?: 'user' | 'organization' | 'group'
      search?: string
      page: number
      pageSize: number
      bypassCache?: boolean
    }) => ipcRenderer.invoke('sourceControl:listRepositoriesPage', options),
    listBranches: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repositoryId?: string
      repositoryFullName: string
      defaultBranch?: string
      bypassCache?: boolean
    }) => ipcRenderer.invoke('sourceControl:listBranches', options),
    listRepositoryLanguages: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repoUrl: string
      repositoryId?: string
      bypassCache?: boolean
    }) => ipcRenderer.invoke('sourceControl:listRepositoryLanguages', options),
    getRepositoryReadmeSnippet: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      repoUrl: string
      repositoryId?: string
      branch?: string
      bypassCache?: boolean
    }) => ipcRenderer.invoke('sourceControl:getRepositoryReadmeSnippet', options),
    createRepository: (options: {
      provider: 'github' | 'gitlab'
      accessToken?: string
      providerHost?: string
      authStrategy?: 'oauth' | 'github_app_installation'
      name: string
      description?: string
      private?: boolean
      autoInit?: boolean
      ownerId?: string
      ownerLogin?: string
      ownerKind?: 'user' | 'organization' | 'group'
    }) => ipcRenderer.invoke('sourceControl:createRepository', options),
    syncRepositoryAccess: (options: {
      projectId?: string
      provider: 'github' | 'gitlab'
      repoUrl: string
      providerHost?: string
      accessToken?: string
      action?: 'grant' | 'revoke'
      role?: string
      inviteEmail?: string
      providerAccountHandle?: string
    }) => ipcRenderer.invoke('sourceControl:syncRepositoryAccess', options),
    invalidateProviderCache: (options?: {
      provider?: 'github' | 'gitlab'
    }) => ipcRenderer.invoke('sourceControl:invalidateProviderCache', options),
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
    listAvailableBrowsers: () => ipcRenderer.invoke('shell:listAvailableBrowsers'),
    openInBrowser: (options: { url: string; browserId?: import('../shared/electronApiTypes').ExternalBrowserId }) =>
      ipcRenderer.invoke('shell:openInBrowser', options),
  },
  editor: {
    listAvailableEditors: () => ipcRenderer.invoke('editor:listAvailableEditors'),
    openInEditor: (options: {
      editorId: import('../shared/electronApiTypes').ExternalEditorId
      filePath: string
      line?: number
      column?: number
    }) => ipcRenderer.invoke('editor:openInEditor', options),
  },
  app: {
    onNavigate: (callback: (path: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, path: string) => callback(path)
      ipcRenderer.on('navigate', handler)
      return () => ipcRenderer.removeListener('navigate', handler)
    },
    onOpenSettings: (callback: (route: string) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, route: string) => callback(route)
      ipcRenderer.on('settings:open', handler)
      return () => ipcRenderer.removeListener('settings:open', handler)
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', settings),
  },
  dialog: {
    selectDirectory: () => ipcRenderer.invoke('dialog:selectDirectory'),
    selectFile: (options?: {
      title?: string
      filters?: Array<{ name: string; extensions: string[] }>
    }) => ipcRenderer.invoke('dialog:selectFile', options ?? {}),
    showMessageBox: (options: MessageBoxOptions) =>
      ipcRenderer.invoke('dialog:showMessageBox', options),
  },
  storage: {
    getSnapshot: (options?: { page?: number; pageSize?: number; forceRefresh?: boolean }) =>
      ipcRenderer.invoke('storage:getSnapshot', options),
    getUsage: () => ipcRenderer.invoke('storage:getUsage'),
    listProjects: () => ipcRenderer.invoke('storage:listProjects'),
    openProjectsDirectory: () => ipcRenderer.invoke('storage:openProjectsDirectory'),
    clearCache: () => ipcRenderer.invoke('storage:clearCache'),
    clearLogs: () => ipcRenderer.invoke('storage:clearLogs'),
    deleteProject: (options: { projectPath: string }) => ipcRenderer.invoke('storage:deleteProject', options),
    clearAll: () => ipcRenderer.invoke('storage:clearAll'),
  },
  window: {
    isFullScreen: () => ipcRenderer.invoke('window:isFullScreen'),
    onFullScreenChange: (callback: (isFullScreen: boolean) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, isFullScreen: boolean) => callback(isFullScreen)
      ipcRenderer.on('window:fullscreen-change', handler)
      return () => ipcRenderer.removeListener('window:fullscreen-change', handler)
    },
    openSettings: (route = '/settings/account') => ipcRenderer.invoke('window:openSettings', { route }),
  },
  preview: {
    injectBridge: (options: { url: string; frameName?: string }) => ipcRenderer.invoke('preview:injectBridge', options),
    probePort: (options: { port: number; timeoutMs?: number }) => ipcRenderer.invoke('preview:probePort', options),
    probeUrl: (options: { url: string; timeoutMs?: number }) => ipcRenderer.invoke('preview:probeUrl', options),
    captureScreenshot: (options: { url: string; width?: number; height?: number }) =>
      ipcRenderer.invoke('preview:captureScreenshot', options),
    captureVisibleRegion: (options: { x: number; y: number; width: number; height: number }) =>
      ipcRenderer.invoke('preview:captureVisibleRegion', options),
    inspectSelection: (options: {
      url: string
      frameName?: string
      bridgeInstanceId?: string
      selector?: string
      path?: number[]
    }) => ipcRenderer.invoke('preview:inspectSelection', options),
    updateSelectionStyles: (options: {
      url: string
      frameName?: string
      bridgeInstanceId?: string
      selector?: string
      path?: number[]
      styles: Record<string, string>
    }) => ipcRenderer.invoke('preview:updateSelectionStyles', options),
    updateSelectionText: (options: {
      url: string
      frameName?: string
      bridgeInstanceId?: string
      selector?: string
      path?: number[]
      text: string
    }) => ipcRenderer.invoke('preview:updateSelectionText', options),
  },
  nativePreview: {
    startSession: (options: import('../shared/nativePreviewTypes').NativePreviewStartSessionRequest) =>
      ipcRenderer.invoke('nativePreview:startSession', options),
    stopSession: (options: import('../shared/nativePreviewTypes').NativePreviewStopSessionRequest) =>
      ipcRenderer.invoke('nativePreview:stopSession', options),
    getSessionState: (options: import('../shared/nativePreviewTypes').NativePreviewSessionLocator) =>
      ipcRenderer.invoke('nativePreview:getSessionState', options),
    sendTouches: (options: import('../shared/nativePreviewTypes').NativePreviewSendTouchesRequest) =>
      ipcRenderer.invoke('nativePreview:sendTouches', options),
    sendWheel: (options: import('../shared/nativePreviewTypes').NativePreviewSendWheelRequest) =>
      ipcRenderer.invoke('nativePreview:sendWheel', options),
    sendKey: (options: import('../shared/nativePreviewTypes').NativePreviewSendKeyRequest) =>
      ipcRenderer.invoke('nativePreview:sendKey', options),
    sendButton: (options: import('../shared/nativePreviewTypes').NativePreviewSendButtonRequest) =>
      ipcRenderer.invoke('nativePreview:sendButton', options),
    rotate: (options: import('../shared/nativePreviewTypes').NativePreviewRotateRequest) =>
      ipcRenderer.invoke('nativePreview:rotate', options),
    captureScreenshot: (options: import('../shared/nativePreviewTypes').NativePreviewCaptureScreenshotRequest) =>
      ipcRenderer.invoke('nativePreview:captureScreenshot', options),
    copyLastScreenshot: (options: import('../shared/nativePreviewTypes').NativePreviewCaptureScreenshotRequest) =>
      ipcRenderer.invoke('nativePreview:copyLastScreenshot', options),
    onStateChanged: (callback: (event: import('../shared/nativePreviewTypes').NativePreviewStateChangedEvent) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: import('../shared/nativePreviewTypes').NativePreviewStateChangedEvent) => {
        callback(payload)
      }
      ipcRenderer.on('nativePreview:stateChanged', handler)
      return () => ipcRenderer.removeListener('nativePreview:stateChanged', handler)
    },
  },
  project: {
    createFolder: (options: { slug: string; initGit?: boolean }) => ipcRenderer.invoke('project:createFolder', options),
    cloneRepository: (options: {
      slug: string
      repoUrl: string
      provider: string
      branch?: string
      accessToken?: string
    }) =>
      ipcRenderer.invoke('project:cloneRepository', options),
    getLocalPath: (options: string | { slug: string; projectId?: string }) =>
      ipcRenderer.invoke('project:getLocalPath', options),
    openFolder: (options: { projectPath: string }) =>
      ipcRenderer.invoke('project:openFolder', options),
    exists: (options: string | { slug: string; projectId?: string }) =>
      ipcRenderer.invoke('project:exists', options),
    pathExists: (projectPath: string) => ipcRenderer.invoke('project:pathExists', { projectPath }),
    writeFile: (options: {
      projectPath: string
      filePath: string
      content: string
      encoding?: 'utf8' | 'base64'
      origin?: 'agent' | 'remote' | 'sync'
    }) => ipcRenderer.invoke('project:writeFile', options),
    readFile: (options: { projectPath: string; filePath: string }) => ipcRenderer.invoke('project:readFile', options),
    readFileBase64: (options: { projectPath: string; filePath: string }) =>
      ipcRenderer.invoke('project:readFileBase64', options),
    listFiles: (options: { projectPath: string }) => ipcRenderer.invoke('project:listFiles', options),
    renameFile: (options: {
      projectPath: string
      oldPath: string
      newPath: string
      origin?: 'agent' | 'remote' | 'sync'
    }) =>
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
    gitEnsureRepo: (options: {
      projectPath: string
      branch?: string
      repoUrl?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitEnsureRepo', options),
    gitCloneIfMissing: (options: {
      projectPath: string
      repoUrl: string
      branch?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitCloneIfMissing', options),
    gitFetchMain: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitFetchMain', options),
    gitStatus: (options: {
      projectPath: string
      remote?: string
      branch?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitStatus', options),
    gitPullMain: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      strategy?: 'merge' | 'ff-only'
      allowUnrelatedHistories?: boolean
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitPullMain', options),
    gitReplayLocalCommits: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitReplayLocalCommits', options),
    gitClassifyRepoHealth: (options: {
      projectPath: string
      remote?: string
      branch?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitClassifyRepoHealth', options),
    gitSalvageReclone: (options: {
      projectPath: string
      repoUrl: string
      branch?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitSalvageReclone', options),
    gitReadConflictFile: (options: {
      projectPath: string
      filePath: string
    }) => ipcRenderer.invoke('sync:gitReadConflictFile', options),
    gitResolveConflictFile: (options: {
      projectPath: string
      filePath: string
      resolvedContent: string
    }) => ipcRenderer.invoke('sync:gitResolveConflictFile', options),
    gitRestoreMain: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitRestoreMain', options),
    gitAdoptWorkspace: (options: {
      projectPath: string
      branch?: string
      repoUrl?: string
      debug?: boolean
    }) => ipcRenderer.invoke('sync:gitAdoptWorkspace', options),
    gitCommitAll: (options: {
      projectPath: string
      message: string
      addAll?: boolean
    }) => ipcRenderer.invoke('sync:gitCommitAll', options),
    gitPushMain: (options: {
      projectPath: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
    }) => ipcRenderer.invoke('sync:gitPushMain', options),
    gitCommitAndPush: (options: {
      projectPath: string
      message: string
      remote?: string
      branch?: string
      repoUrl?: string
      addAll?: boolean
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
    }) => ipcRenderer.invoke('sync:gitCommitAndPush', options),
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
    enqueueOps: (options: { projectId: string; ops: SyncOp[] }) =>
      ipcRenderer.invoke('sync:enqueueOps', options),
    ackOps: (options: { projectId: string; opIds: string[] }) =>
      ipcRenderer.invoke('sync:ackOps', options),
    getJournalState: (options: { projectId: string }) =>
      ipcRenderer.invoke('sync:getJournalState', options),
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
    start: (options: { projectPath: string; command: string; port: number; cols?: number; rows?: number; runId?: string }) =>
      ipcRenderer.invoke('devServer:start', options),
    stop: (options: { projectPath: string }) =>
      ipcRenderer.invoke('devServer:stop', options),
    resize: (options: { projectPath: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('devServer:resize', options),
    isRunning: (options: { projectPath: string }) =>
      ipcRenderer.invoke('devServer:isRunning', options),
    onOutput: (callback: (data: { projectPath: string; output: string; stream: 'stdout' | 'stderr'; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { projectPath: string; output: string; stream: 'stdout' | 'stderr'; runId?: string }) => callback(data)
      ipcRenderer.on('devServer:output', handler)
      return () => ipcRenderer.removeListener('devServer:output', handler)
    },
    onExit: (callback: (data: { projectPath: string; code: number | null; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { projectPath: string; code: number | null; runId?: string }) => callback(data)
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
    create: (options: { projectPath: string; profileId?: string; cwd?: string; cols?: number; rows?: number; runId?: string; env?: Record<string, string> }) =>
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
    onOutput: (callback: (data: { terminalId: string; data: string; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; data: string; runId?: string }) => callback(data)
      ipcRenderer.on('terminal:output', handler)
      return () => ipcRenderer.removeListener('terminal:output', handler)
    },
    onExit: (callback: (data: { terminalId: string; exitCode: number | null; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; exitCode: number | null; runId?: string }) => callback(data)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
    onActivity: (callback: (data: { terminalId: string; hasRunningSubprocess: boolean; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; hasRunningSubprocess: boolean; runId?: string }) => callback(data)
      ipcRenderer.on('terminal:activity', handler)
      return () => ipcRenderer.removeListener('terminal:activity', handler)
    },
  },
  agentTools: {
    getStatus: (options: { toolId: import('../shared/electronApiTypes').AgentToolId }) =>
      ipcRenderer.invoke('agentTools:getStatus', options),
    prepare: (options: { toolId: import('../shared/electronApiTypes').AgentToolId }) =>
      ipcRenderer.invoke('agentTools:prepare', options),
  },
  contextMenu: {
    showTerminalSelection: (options: { selectedText: string; x: number; y: number }) =>
      ipcRenderer.invoke('contextMenu:showTerminalSelection', options),
    showFileTreeMenu: (options: { targetPath: string; isDirectory: boolean; x: number; y: number }) =>
      ipcRenderer.invoke('contextMenu:showFileTreeMenu', options),
    showVisualEditorMenu: (options: { hasReactSource: boolean; hasReactStack: boolean; x: number; y: number }) =>
      ipcRenderer.invoke('contextMenu:showVisualEditorMenu', options),
    showNative: (options: {
      x: number
      y: number
      editable?: boolean
      selectionText?: string
      linkUrl?: string
    }) => ipcRenderer.invoke('contextMenu:showNative', options),
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
  dependencies: {
    inspect: (options: { projectPath: string }) => ipcRenderer.invoke('dependencies:inspect', options),
    run: (options: {
      projectPath: string
      action: 'install' | 'add' | 'update' | 'remove'
      packageName?: string
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
        action: 'install' | 'add' | 'update' | 'remove'
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
          action: 'install' | 'add' | 'update' | 'remove'
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
    onPublish: (callback: (payload: import('../shared/electronApiTypes').DiagnosticPublishPayload) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, payload: import('../shared/electronApiTypes').DiagnosticPublishPayload) =>
        callback(payload)
      ipcRenderer.on('diagnostics:publish', handler)
      return () => ipcRenderer.removeListener('diagnostics:publish', handler)
    },
  },
} satisfies ElectronAPI)
