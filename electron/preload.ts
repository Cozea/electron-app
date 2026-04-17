import { contextBridge, ipcRenderer } from 'electron'

import type {
  AppSettings,
  ElectronAPI,
  ElectronWindowContext,
  GpuAccelerationDiagnostics,
  RuntimeKind,
  SyncOp,
  SyncWriteFile,
  UpdateState,
} from '../shared/electronApiTypes'
import type { MessageBoxOptions } from 'electron'
import type { ContextMenuItem } from '../shared/assistant-contracts/ipc'

const WINDOW_CONTEXT_ARG_PREFIX = '--cozea-window='
const ASSISTANT_WS_URL_ARG_PREFIX = '--cozea-assistant-ws-url='
const DEFAULT_ASSISTANT_WS_URL = 'ws://127.0.0.1:3773'
const ASSISTANT_RUNTIME_STATUS_CHANNEL = 'assistantRuntime:status'
const ASSISTANT_RUNTIME_STATUS_HANDLE = 'assistantRuntime:getStatus'
const WORKBENCH_SESSION_STATE_CHANGED_CHANNEL = 'workbenchSession:stateChanged'

type AssistantRuntimeBridgeStatus = {
  phase: 'idle' | 'starting' | 'ready' | 'error'
  wsUrl: string
  lastError: string | null
  updatedAt: number
}

function resolveWindowContext(argv: readonly string[]): ElectronWindowContext {
  const contextArg = argv.find((value) => value.startsWith(WINDOW_CONTEXT_ARG_PREFIX))
  const rawContext = contextArg?.slice(WINDOW_CONTEXT_ARG_PREFIX.length)
  return rawContext === 'settings' ? 'settings' : 'main'
}

function resolveAssistantWsUrl(argv: readonly string[]): string | null {
  const contextArg = argv.find((value) => value.startsWith(ASSISTANT_WS_URL_ARG_PREFIX))
  const rawUrl = contextArg?.slice(ASSISTANT_WS_URL_ARG_PREFIX.length)?.trim()
  return rawUrl && rawUrl.length > 0 ? rawUrl : DEFAULT_ASSISTANT_WS_URL
}

const windowContext = resolveWindowContext(process.argv)
const assistantWsUrl = resolveAssistantWsUrl(process.argv)

type TerminalOutputPayload = { terminalId: string; data: string; runId?: string }

function createTerminalOutputBridge() {
  const wildcardSubscribers = new Set<(payload: TerminalOutputPayload) => void>()
  const byTerminalId = new Map<string, Set<(payload: TerminalOutputPayload) => void>>()
  let ipcAttached = false

  const dispatch = (_event: Electron.IpcRendererEvent, data: TerminalOutputPayload) => {
    byTerminalId.get(data.terminalId)?.forEach((cb) => {
      try {
        cb(data)
      } catch (err) {
        console.error('[preload] terminal:onOutput per-terminal subscriber failed', err)
      }
    })
    wildcardSubscribers.forEach((cb) => {
      try {
        cb(data)
      } catch (err) {
        console.error('[preload] terminal:onOutput wildcard subscriber failed', err)
      }
    })
  }

  function ensureIpcListener() {
    if (ipcAttached) return
    ipcAttached = true
    ipcRenderer.on('terminal:output', dispatch)
  }

  return {
    onOutput(callback: (payload: TerminalOutputPayload) => void) {
      ensureIpcListener()
      wildcardSubscribers.add(callback)
      return () => {
        wildcardSubscribers.delete(callback)
      }
    },
    onOutputForTerminal(terminalId: string, callback: (payload: TerminalOutputPayload) => void) {
      ensureIpcListener()
      let bucket = byTerminalId.get(terminalId)
      if (!bucket) {
        bucket = new Set()
        byTerminalId.set(terminalId, bucket)
      }
      bucket.add(callback)
      return () => {
        bucket.delete(callback)
        if (bucket.size === 0) {
          byTerminalId.delete(terminalId)
        }
      }
    },
  }
}

const terminalOutputBridge = createTerminalOutputBridge()

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  windowContext,
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
  collab: {
    isEncryptionAvailable: () => ipcRenderer.invoke('collab:isEncryptionAvailable'),
    ensureDeviceIdentity: () => ipcRenderer.invoke('collab:ensureDeviceIdentity'),
    getStoredDeviceIdentity: () => ipcRenderer.invoke('collab:getStoredDeviceIdentity'),
    wrapRoomKey: (options: { roomKeyBase64: string; recipientPublicKeyJwk: string }) =>
      ipcRenderer.invoke('collab:wrapRoomKey', options),
    unwrapRoomKey: (options: { senderPublicKeyJwk: string; wrappedKey: string; wrapAlgorithm?: string }) =>
      ipcRenderer.invoke('collab:unwrapRoomKey', options),
    createRecoveryKit: (options: { roomKeyBase64: string; recoveryCode?: string }) =>
      ipcRenderer.invoke('collab:createRecoveryKit', options),
    unwrapRecoveryKit: (options: {
      recoveryCode: string
      wrappedKey: string
      salt: string
      iterations: number
      wrapAlgorithm?: string
    }) => ipcRenderer.invoke('collab:unwrapRecoveryKit', options),
    deleteDeviceIdentity: () => ipcRenderer.invoke('collab:deleteDeviceIdentity'),
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
    getGpuDiagnostics: () => ipcRenderer.invoke('app:getGpuDiagnostics') as Promise<GpuAccelerationDiagnostics>,
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', settings),
  },
  dialog: {
    selectDirectory: (options?: { title?: string }) => ipcRenderer.invoke('dialog:selectDirectory', options ?? {}),
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
  workbenchBrowser: {
    ensureTile: (options: {
      tileId: string
      initialUrl?: string
      storageScope?: import("../shared/browserHostTypes").BrowserStorageScope
      workspaceId?: string
    }) =>
      ipcRenderer.invoke('workbenchBrowser:ensureTile', options),
    destroyTile: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:destroyTile', options),
    setBounds: (options: {
      tileId: string
      bounds?: { x: number; y: number; width: number; height: number }
      visible?: boolean
    }) => ipcRenderer.invoke('workbenchBrowser:setBounds', options),
    navigate: (options: { tileId: string; url: string }) =>
      ipcRenderer.invoke('workbenchBrowser:navigate', options),
    getState: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:getState', options),
    goBack: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:goBack', options),
    goForward: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:goForward', options),
    reload: (options: { tileId: string; hard?: boolean }) =>
      ipcRenderer.invoke('workbenchBrowser:reload', options),
    focus: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:focus', options),
    toggleDevTools: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:toggleDevTools', options),
    openExternal: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:openExternal', options),
    zoomIn: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:zoomIn', options),
    zoomOut: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:zoomOut', options),
    resetZoom: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:resetZoom', options),
    findInPage: (options: {
      tileId: string
      text: string
      forward?: boolean
      recompute?: boolean
      matchCase?: boolean
    }) => ipcRenderer.invoke('workbenchBrowser:findInPage', options),
    stopFindInPage: (options: { tileId: string; keepSelection?: boolean }) =>
      ipcRenderer.invoke('workbenchBrowser:stopFindInPage', options),
    getSelectedText: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:getSelectedText', options),
    captureScreenshot: (options: { tileId: string }) =>
      ipcRenderer.invoke('workbenchBrowser:captureScreenshot', options),
    onStateChange: (callback: (state: import('../shared/electronApiTypes').WorkbenchBrowserViewState) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        state: import('../shared/electronApiTypes').WorkbenchBrowserViewState,
      ) => callback(state)
      ipcRenderer.on('workbenchBrowser:state', handler)
      return () => ipcRenderer.removeListener('workbenchBrowser:state', handler)
    },
    onNewPageRequest: (callback: (request: import('../shared/browserHostTypes').BrowserNewPageRequest) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        request: import('../shared/browserHostTypes').BrowserNewPageRequest,
      ) => callback(request)
      ipcRenderer.on('workbenchBrowser:new-page-request', handler)
      return () => ipcRenderer.removeListener('workbenchBrowser:new-page-request', handler)
    },
    onCommand: (callback: (command: import('../shared/browserHostTypes').BrowserUiCommand) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        command: import('../shared/browserHostTypes').BrowserUiCommand,
      ) => callback(command)
      ipcRenderer.on('workbenchBrowser:command', handler)
      return () => ipcRenderer.removeListener('workbenchBrowser:command', handler)
    },
  },
  workbenchSession: {
    ensureSession: (options: { sessionKey?: string | null; projectId: string; laneId: string; projectPath?: string | null }) =>
      ipcRenderer.invoke('workbenchSession:ensureSession', options),
    activateSession: (options: { sessionKey?: string | null; projectId: string; laneId: string; projectPath?: string | null }) =>
      ipcRenderer.invoke('workbenchSession:activateSession', options),
    backgroundSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      mode?: 'backgroundWarm' | 'backgroundFrozen'
    }) => ipcRenderer.invoke('workbenchSession:backgroundSession', options),
    closeSession: (options: { sessionKey?: string | null; projectId: string; laneId: string }) =>
      ipcRenderer.invoke('workbenchSession:closeSession', options),
    getSession: (options: { sessionKey?: string | null; projectId: string; laneId: string }) =>
      ipcRenderer.invoke('workbenchSession:getSession', options),
    listSessions: () => ipcRenderer.invoke('workbenchSession:listSessions'),
    setPinned: (options: { sessionKey?: string | null; projectId: string; laneId: string; pinned: boolean }) =>
      ipcRenderer.invoke('workbenchSession:setPinned', options),
    getTerminalBinding: (options: { sessionKey?: string | null; projectId: string; laneId: string; tileId: string }) =>
      ipcRenderer.invoke('workbenchSession:getTerminalBinding', options),
    bindTerminal: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      terminalId: string
      projectPath?: string | null
    }) => ipcRenderer.invoke('workbenchSession:bindTerminal', options),
    releaseTerminal: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      close?: boolean
    }) => ipcRenderer.invoke('workbenchSession:releaseTerminal', options),
    getBrowserBinding: (options: { sessionKey?: string | null; projectId: string; laneId: string; tileId: string }) =>
      ipcRenderer.invoke('workbenchSession:getBrowserBinding', options),
    bindBrowser: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      browserTileId: string
      projectPath?: string | null
    }) => ipcRenderer.invoke('workbenchSession:bindBrowser', options),
    releaseBrowser: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      destroy?: boolean
    }) => ipcRenderer.invoke('workbenchSession:releaseBrowser', options),
    setNativePreviewSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      locator: import('../shared/nativePreviewTypes').NativePreviewSessionLocator | null
      stopPrevious?: boolean
    }) => ipcRenderer.invoke('workbenchSession:setNativePreviewSession', options),
    onStateChanged: (callback: (session: import('../shared/electronApiTypes').WorkbenchSessionSnapshot) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        session: import('../shared/electronApiTypes').WorkbenchSessionSnapshot,
      ) => callback(session)
      ipcRenderer.on(WORKBENCH_SESSION_STATE_CHANGED_CHANNEL, handler)
      return () => ipcRenderer.removeListener(WORKBENCH_SESSION_STATE_CHANGED_CHANNEL, handler)
    },
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
    listIosSimulators: () => ipcRenderer.invoke('nativePreview:listIosSimulators'),
    resolveLaunchConfig: (options: import('../shared/nativePreviewTypes').NativePreviewResolveLaunchConfigRequest) =>
      ipcRenderer.invoke('nativePreview:resolveLaunchConfig', options),
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
    createFolder: (options: { slug: string; initGit?: boolean; projectId?: string; baseDirectory?: string }) =>
      ipcRenderer.invoke('project:createFolder', options),
    cloneRepository: (options: {
      slug: string
      repoUrl: string
      provider: string
      branch?: string
      accessToken?: string
      projectId?: string
      baseDirectory?: string
    }) =>
      ipcRenderer.invoke('project:cloneRepository', options),
    getLocalPath: (options: string | { slug: string; projectId?: string; localPathHint?: string | null; attachedPathHint?: string | null }) =>
      ipcRenderer.invoke('project:getLocalPath', options),
    rememberLocalPath: (options: { projectId: string; projectPath: string }) =>
      ipcRenderer.invoke('project:rememberLocalPath', options),
    clearLocalPath: (options: { projectId: string }) =>
      ipcRenderer.invoke('project:clearLocalPath', options),
    listGitBranches: (options: { projectPath: string }) =>
      ipcRenderer.invoke('project:listGitBranches', options),
    checkoutGitBranch: (options: { projectPath: string; branch: string }) =>
      ipcRenderer.invoke('project:checkoutGitBranch', options),
    createGitWorktree: (options: {
      projectPath: string
      branch: string
      newBranch?: string
      path?: string | null
    }) => ipcRenderer.invoke('project:createGitWorktree', options),
    mergeLaneIntoCollab: (options: {
      collabProjectPath: string
      collabBranch: string
      sourceBranch: string
    }) => ipcRenderer.invoke('project:mergeLaneIntoCollab', options),
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
    getPathNativeIcon: (options: { projectPath: string }) =>
      ipcRenderer.invoke('project:getPathNativeIcon', options),
    checkGhCliStatus: () =>
      ipcRenderer.invoke('project:checkGhCliStatus'),
    createGitHubRepo: (options: { name: string; localPath: string; visibility?: 'private' | 'public' }) =>
      ipcRenderer.invoke('project:createGitHubRepo', options),
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
    gitCaptureCheckpoint: (options: {
      projectPath: string
      checkpointId: string
      authorName: string
      authorEmail?: string
    }) => ipcRenderer.invoke('sync:gitCaptureCheckpoint', options),
    gitDiffCheckpoints: (options: {
      projectPath: string
      fromCheckpointId?: string | null
      toCheckpointId: string
      filePath?: string
    }) => ipcRenderer.invoke('sync:gitDiffCheckpoints', options),
    gitReadCheckpointFilePair: (options: {
      projectPath: string
      fromCheckpointId?: string | null
      toCheckpointId: string
      filePath: string
    }) => ipcRenderer.invoke('sync:gitReadCheckpointFilePair', options),
    gitDeleteCheckpointRefs: (options: {
      projectPath: string
      checkpointIds: string[]
    }) => ipcRenderer.invoke('sync:gitDeleteCheckpointRefs', options),
    gitDeleteAllCheckpointRefs: (options: {
      projectPath: string
    }) => ipcRenderer.invoke('sync:gitDeleteAllCheckpointRefs', options),
    gitGetHeadDiffStats: (options: {
      projectPath: string
      authorName?: string
    }) => ipcRenderer.invoke('sync:gitGetHeadDiffStats', options),
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
    setInterestRoots: (options: { roots: string[] }) =>
      ipcRenderer.invoke('yjs:setInterestRoots', options),
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
    start: (options: {
      projectPath: string
      command: string
      bootstrapCommand?: string | null
      port: number
      sessionKey?: string | null
      framework?: string | null
      terminalId: string
      cols?: number
      rows?: number
      runId?: string
    }) =>
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
    getSnapshot: (options: { terminalId: string }) =>
      ipcRenderer.invoke('terminal:getSnapshot', options),
    onOutput: (callback: (data: { terminalId: string; data: string; runId?: string }) => void) =>
      terminalOutputBridge.onOutput(callback),
    onOutputForTerminal: (
      terminalId: string,
      callback: (data: { terminalId: string; data: string; runId?: string }) => void,
    ) => terminalOutputBridge.onOutputForTerminal(terminalId, callback),
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
    showOpenInEditorPicker: (options: {
      x: number
      y: number
      editors: ReadonlyArray<{ id: import('../shared/electronApiTypes').ExternalEditorId; name: string }>
      selectedEditorId: import('../shared/electronApiTypes').ExternalEditorId | null
    }) => ipcRenderer.invoke('contextMenu:showOpenInEditorPicker', options),
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

contextBridge.exposeInMainWorld('desktopBridge', {
  getWsUrl: () => assistantWsUrl,
  getAssistantRuntimeStatus: () =>
    ipcRenderer.invoke(ASSISTANT_RUNTIME_STATUS_HANDLE) as Promise<AssistantRuntimeBridgeStatus>,
  pickFolder: () => ipcRenderer.invoke('dialog:selectDirectory'),
  confirm: async (message: string) => {
    const result = await ipcRenderer.invoke('dialog:showMessageBox', {
      type: 'question',
      buttons: ['Cancel', 'OK'],
      defaultId: 1,
      cancelId: 0,
      title: 'Confirm',
      message,
      noLink: true,
    } satisfies MessageBoxOptions)
    return result?.response === 1
  },
  setTheme: async (_theme: 'light' | 'dark' | 'system') => undefined,
  showContextMenu: async <T extends string>(
    items: readonly ContextMenuItem<T>[],
    position?: { x: number; y: number },
  ): Promise<T | null> => {
    const result = await ipcRenderer.invoke('contextMenu:showGeneric', {
      items,
      x: position?.x,
      y: position?.y,
    })
    return (result?.action as T | null | undefined) ?? null
  },
  openExternal: async (url: string) => {
    const result = await ipcRenderer.invoke('shell:openExternal', url)
    return Boolean(result?.success)
  },
  onAssistantRuntimeStatus: (listener: (status: AssistantRuntimeBridgeStatus) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, status: AssistantRuntimeBridgeStatus) =>
      listener(status)
    ipcRenderer.on(ASSISTANT_RUNTIME_STATUS_CHANNEL, handler)
    return () => ipcRenderer.removeListener(ASSISTANT_RUNTIME_STATUS_CHANNEL, handler)
  },
  onMenuAction: (_listener: (action: string) => void) => () => undefined,
  getUpdateState: () => ipcRenderer.invoke('updates:getState'),
  downloadUpdate: async () => {
    const state = await ipcRenderer.invoke('updates:download')
    return {
      accepted: true,
      completed: true,
      state,
    }
  },
  installUpdate: async () => {
    const result = await ipcRenderer.invoke('updates:install')
    const state = await ipcRenderer.invoke('updates:getState')
    return {
      accepted: Boolean(result?.success),
      completed: Boolean(result?.success),
      state,
    }
  },
  onUpdateState: (listener: (state: unknown) => void) => {
    const handler = (_event: Electron.IpcRendererEvent, state: unknown) => listener(state)
    ipcRenderer.on('updates:status', handler)
    return () => ipcRenderer.removeListener('updates:status', handler)
  },
})
