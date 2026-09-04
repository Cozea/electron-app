import { contextBridge, ipcRenderer, webUtils } from 'electron'

import type {
  AppSettings,
  ElectronAPI,
  ElectronWindowContext,
  GpuAccelerationDiagnostics,
  RuntimeKind,
  SyncOp,
  SyncWriteFile,
  TerminalAttachViewResult,
  TerminalCreateOptions,
  TerminalOutputEvent,
  UpdateState,
} from '../../../shared/electronApiTypes'
import type { WorkspaceCatalogSnapshot } from '../../../shared/workspaceTypes'
import type { MessageBoxOptions } from 'electron'
import type { ContextMenuItem } from '../../../shared/assistant-contracts/ipc'
import { BROWSER_SURFACE_IPC } from '../../../shared/browserSurfaceIpc'
import type {
  BrowserSurfaceDescriptor,
  CozeaBrowserSurfaceState,
  CozeaDesktopPreviewBridge,
} from '../../../shared/browserSurfaceTypes'
import type { DesktopPreviewPointerEvent, DesktopPreviewRecordingFrame } from '@cozea/contracts/t3/ipc'

const WINDOW_CONTEXT_ARG_PREFIX = '--cozea-window='
const ASSISTANT_WS_URL_ARG_PREFIX = '--cozea-assistant-ws-url='
const DEFAULT_ASSISTANT_WS_URL: string | null = null
const ASSISTANT_RUNTIME_STATUS_CHANNEL = 'assistantRuntime:status'
const ASSISTANT_RUNTIME_STATUS_HANDLE = 'assistantRuntime:getStatus'
const SUBSTRATE_SHADOW_STATUS_HANDLE = 'substrateShadow:getStatus'
const SUBSTRATE_VCS_INVALIDATE_HANDLE = 'substrate:vcs:invalidate'
const SUBSTRATE_VCS_CAPABILITIES_HANDLE = 'substrate:vcs:capabilities'
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

type TerminalOutputPayload = TerminalOutputEvent
type TerminalOutputIpcPayload =
  | TerminalOutputPayload
  | {
      terminalId: string
      events: TerminalOutputPayload[]
    }

function createTerminalOutputBridge() {
  const wildcardSubscribers = new Set<(payload: TerminalOutputPayload) => void>()
  const byTerminalId = new Map<string, Set<(payload: TerminalOutputPayload) => void>>()
  let ipcAttached = false

  const dispatchOne = (data: TerminalOutputPayload) => {
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

  const dispatch = (_event: Electron.IpcRendererEvent, payload: TerminalOutputIpcPayload) => {
    if ('events' in payload) {
      for (const event of payload.events) {
        dispatchOne(event)
      }
      return
    }

    dispatchOne(payload)
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

const previewBridge: CozeaDesktopPreviewBridge = {
  prepareSurface: (descriptor: BrowserSurfaceDescriptor) =>
    ipcRenderer.invoke(BROWSER_SURFACE_IPC.prepareSurface, descriptor),
  releaseSurface: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.releaseSurface, tabId),
  getSurfaceState: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.getSurfaceState, tabId),
  listSurfaces: () => ipcRenderer.invoke(BROWSER_SURFACE_IPC.listSurfaces),
  setSurfaceActive: (tabId, active) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.setSurfaceActive, { tabId, active }),
  findInPage: (tabId, query, options) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.findInPage, { tabId, query, options }),
  stopFindInPage: (tabId, action) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.stopFindInPage, { tabId, action }),
  createTab: (tabId, defaults) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.createTab, { tabId, defaults }),
  closeTab: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.closeTab, tabId),
  registerWebview: (tabId, webContentsId) =>
    ipcRenderer.invoke(BROWSER_SURFACE_IPC.registerWebview, { tabId, webContentsId }),
  navigate: (tabId, url) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.navigate, { tabId, url }),
  goBack: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.goBack, tabId),
  goForward: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.goForward, tabId),
  refresh: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.refresh, tabId),
  zoomIn: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.zoomIn, tabId),
  zoomOut: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.zoomOut, tabId),
  resetZoom: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.resetZoom, tabId),
  hardReload: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.hardReload, tabId),
  setColorScheme: (tabId, colorScheme) =>
    ipcRenderer.invoke(BROWSER_SURFACE_IPC.setColorScheme, { tabId, colorScheme }),
  setAudioMuted: (tabId, audioMuted) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.setAudioMuted, { tabId, audioMuted }),
  openDevTools: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.openDevTools, tabId),
  clearCookies: () => ipcRenderer.invoke(BROWSER_SURFACE_IPC.clearCookies),
  clearCache: () => ipcRenderer.invoke(BROWSER_SURFACE_IPC.clearCache),
  getPreviewConfig: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.getPreviewConfig, tabId),
  setAnnotationTheme: (theme) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.setAnnotationTheme, theme),
  pickElement: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.pickElement, tabId),
  cancelPickElement: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.cancelPickElement, tabId),
  captureScreenshot: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.captureScreenshot, tabId),
  revealArtifact: (artifactPath) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.revealArtifact, artifactPath),
  copyArtifactToClipboard: (artifactPath) =>
    ipcRenderer.invoke(BROWSER_SURFACE_IPC.copyArtifactToClipboard, artifactPath),
  pictureInPicture: {
    open: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.pictureInPictureOpen, tabId),
    close: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.pictureInPictureClose, tabId),
  },
  recording: {
    startScreencast: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.recordingStart, tabId),
    stopScreencast: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.recordingStop, tabId),
    save: (tabId, mimeType, data) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.recordingSave, { tabId, mimeType, data }),
    onFrame: (listener) => {
      const wrapped = (_event: Electron.IpcRendererEvent, frame: unknown) => {
        if (typeof frame === 'object' && frame !== null) {
          listener(frame as DesktopPreviewRecordingFrame)
        }
      }
      ipcRenderer.on(BROWSER_SURFACE_IPC.recordingFrame, wrapped)
      return () => ipcRenderer.removeListener(BROWSER_SURFACE_IPC.recordingFrame, wrapped)
    },
  },
  automation: {
    status: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.automationStatus, tabId),
    snapshot: (tabId) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.automationSnapshot, tabId),
    click: (tabId, input) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.automationClick, { tabId, input }),
    type: (tabId, input) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.automationType, { tabId, input }),
    press: (tabId, input) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.automationPress, { tabId, input }),
    scroll: (tabId, input) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.automationScroll, { tabId, input }),
    evaluate: (tabId, input) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.automationEvaluate, { tabId, input }),
    waitFor: (tabId, input) => ipcRenderer.invoke(BROWSER_SURFACE_IPC.automationWaitFor, { tabId, input }),
  },
  onStateChange: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, tabId: unknown, state: unknown) => {
      if (typeof tabId === 'string' && typeof state === 'object' && state !== null) {
        listener(tabId, state as CozeaBrowserSurfaceState)
      }
    }
    ipcRenderer.on(BROWSER_SURFACE_IPC.stateChanged, wrapped)
    return () => ipcRenderer.removeListener(BROWSER_SURFACE_IPC.stateChanged, wrapped)
  },
  onSurfaceStateChange: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, tabId: unknown, state: unknown) => {
      if (typeof tabId === 'string' && typeof state === 'object' && state !== null) {
        listener(tabId, state as CozeaBrowserSurfaceState)
      }
    }
    ipcRenderer.on(BROWSER_SURFACE_IPC.stateChanged, wrapped)
    return () => ipcRenderer.removeListener(BROWSER_SURFACE_IPC.stateChanged, wrapped)
  },
  onPointerEvent: (listener) => {
    const wrapped = (_event: Electron.IpcRendererEvent, pointerEvent: unknown) => {
      if (typeof pointerEvent === 'object' && pointerEvent !== null) {
        listener(pointerEvent as DesktopPreviewPointerEvent)
      }
    }
    ipcRenderer.on(BROWSER_SURFACE_IPC.pointerEvent, wrapped)
    return () => ipcRenderer.removeListener(BROWSER_SURFACE_IPC.pointerEvent, wrapped)
  },
}

// Expose protected methods that allow the renderer process to use
// the ipcRenderer without exposing the entire object
contextBridge.exposeInMainWorld('electronAPI', {
  platform: process.platform,
  windowContext,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  integrations: {
    isEncryptionAvailable: () => ipcRenderer.invoke('integrations:isEncryptionAvailable'),
    generateKey: () => ipcRenderer.invoke('integrations:generateKey'),
    storeKey: (options: { keyId: string; keyData: string }) => ipcRenderer.invoke('integrations:storeKey', options),
    deleteKey: (options: { keyId: string }) => ipcRenderer.invoke('integrations:deleteKey', options),
    keyExists: (options: { keyId: string }) => ipcRenderer.invoke('integrations:keyExists', options),
    encrypt: (options: { credentials: Record<string, unknown>; keyId: string }) =>
      ipcRenderer.invoke('integrations:encrypt', options),
    onOAuthSuccess: (
      callback: (data: {
        provider: string
        accessToken?: string
        refreshToken?: string
        tokenExpiresAt?: number
        externalId?: string
        externalAccountName?: string
        scopes?: string[]
        metadata?: Record<string, unknown>
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          provider: string
          accessToken?: string
          refreshToken?: string
          tokenExpiresAt?: number
          externalId?: string
          externalAccountName?: string
          scopes?: string[]
          metadata?: Record<string, unknown>
        },
      ) => callback(data)
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
      workspaceId: string
      laneId: string
      cwd?: { kind: 'projectRoot' } | { kind: 'relative'; path: string }
      encryptedCredentials: string
      keyId: string
      timeout?: number
    }) => ipcRenderer.invoke('integrations:runTool', options),
    isToolAvailable: (options: { toolName: string }) => ipcRenderer.invoke('integrations:isToolAvailable', options),
    getToolDefinition: (options: { toolName: string }) => ipcRenderer.invoke('integrations:getToolDefinition', options),
    listTools: () => ipcRenderer.invoke('integrations:listTools'),
  },
  collab: {
    isEncryptionAvailable: () => ipcRenderer.invoke('collab:isEncryptionAvailable'),
    ensureDeviceIdentity: () => ipcRenderer.invoke('collab:ensureDeviceIdentity'),
    getStoredDeviceIdentity: () => ipcRenderer.invoke('collab:getStoredDeviceIdentity'),
    signDeviceChallenge: (challenge: string) => ipcRenderer.invoke('collab:signDeviceChallenge', challenge),
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
  shell: {
    openExternal: (url: string) => ipcRenderer.invoke('shell:openExternal', url),
    listAvailableBrowsers: () => ipcRenderer.invoke('shell:listAvailableBrowsers'),
    openInBrowser: (options: {
      url: string
      browserId?: import('../../../shared/electronApiTypes').ExternalBrowserId
    }) => ipcRenderer.invoke('shell:openInBrowser', options),
  },
  editor: {
    listAvailableEditors: () => ipcRenderer.invoke('editor:listAvailableEditors'),
    openInEditor: (options: {
      editorId?: string
      workspaceId?: string
      filePath?: string
      path?: string
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
    setNativeThemeSource: (source) => ipcRenderer.invoke('app:setNativeThemeSource', source),
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    set: (settings: Partial<AppSettings>) => ipcRenderer.invoke('settings:set', settings),
  },
  dialog: {
    selectDirectory: (options?: { title?: string }) => ipcRenderer.invoke('dialog:selectDirectory', options ?? {}),
    selectFile: (options?: { title?: string; filters?: Array<{ name: string; extensions: string[] }> }) =>
      ipcRenderer.invoke('dialog:selectFile', options ?? {}),
    showMessageBox: (options: MessageBoxOptions) => ipcRenderer.invoke('dialog:showMessageBox', options),
  },
  storage: {
    getSnapshot: (options?: { page?: number; pageSize?: number; forceRefresh?: boolean }) =>
      ipcRenderer.invoke('storage:getSnapshot', options),
    getUsage: () => ipcRenderer.invoke('storage:getUsage'),
    listProjects: () => ipcRenderer.invoke('storage:listProjects'),
    openProjectsDirectory: () => ipcRenderer.invoke('storage:openProjectsDirectory'),
    clearCache: () => ipcRenderer.invoke('storage:clearCache'),
    clearLogs: () => ipcRenderer.invoke('storage:clearLogs'),
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
  orgDevApp: {
    listInstallations: () => ipcRenderer.invoke('orgDevApp:listInstallations'),
    getInstallation: (options: { ref: string }) => ipcRenderer.invoke('orgDevApp:getInstallation', options),
    install: (request: import('../../../shared/orgDevAppInstallation').OrgDevAppInstallRequest) =>
      ipcRenderer.invoke('orgDevApp:install', request),
    prepareInstalled: (options: { ref: string }) => ipcRenderer.invoke('orgDevApp:prepareInstalled', options),
    uninstallPublication: (options: { publicationId: string }) =>
      ipcRenderer.invoke('orgDevApp:uninstallPublication', options),
    removeInstalledVersion: (options: { ref: string }) =>
      ipcRenderer.invoke('orgDevApp:removeInstalledVersion', options),
    onInstallationsChanged: (
      listener: (installations: import('../../../shared/orgDevAppInstallation').OrgDevAppInstallation[]) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        installations: import('../../../shared/orgDevAppInstallation').OrgDevAppInstallation[],
      ) => listener(installations)
      ipcRenderer.on('orgDevApp:installationsChanged', handler)
      return () => ipcRenderer.removeListener('orgDevApp:installationsChanged', handler)
    },
    buildAndUpload: (options: {
      workspaceId: string
      laneId?: string | null
      operationId?: string
      uploadUrl: string
    }) => ipcRenderer.invoke('orgDevApp:buildAndUpload', options),
    startRuntimeBuild: (options: {
      workspaceId: string
      laneId?: string | null
      projectId: string
      uploadReservationId: string
      accessToken: string
    }) => ipcRenderer.invoke('orgDevApp:startRuntimeBuild', options),
    getRuntimeBuild: (options: { buildId: string; accessToken: string }) =>
      ipcRenderer.invoke('orgDevApp:getRuntimeBuild', options),
    getPublishedWorkerApproval: (options: { ref: string; workspaceId: string }) =>
      ipcRenderer.invoke('orgDevApp:getPublishedWorkerApproval', options),
    approvePublishedWorker: (options: { ref: string; workspaceId: string; agentInvocable: boolean }) =>
      ipcRenderer.invoke('orgDevApp:approvePublishedWorker', options),
    revokePublishedWorker: (options: { ref: string; workspaceId: string }) =>
      ipcRenderer.invoke('orgDevApp:revokePublishedWorker', options),
    listFolderGrants: (options: { ref: string }) => ipcRenderer.invoke('orgDevApp:listFolderGrants', options),
    grantFolder: (options: { ref: string; access: 'read' | 'readWrite' }) =>
      ipcRenderer.invoke('orgDevApp:grantFolder', options),
    revokeFolderGrant: (options: { ref: string; grantId: string }) =>
      ipcRenderer.invoke('orgDevApp:revokeFolderGrant', options),
    stopPublishedRuntime: (options: { ref: string; workspaceId: string }) =>
      ipcRenderer.invoke('orgDevApp:stopPublishedRuntime', options),
    releasePublishedRuntime: (options: { ref: string; workspaceId: string; leaseId: string }) =>
      ipcRenderer.invoke('orgDevApp:releasePublishedRuntime', options),
    getPublishedToolStatus: (options: { ref: string; workspaceId: string; laneId?: string | null }) =>
      ipcRenderer.invoke('orgDevApp:getPublishedToolStatus', options),
    invokePublishedTool: (options: {
      ref: string
      workspaceId: string
      laneId?: string | null
      name: string
      input: unknown
      timeoutMs?: number
    }) => ipcRenderer.invoke('orgDevApp:invokePublishedTool', options),
    ensurePublishedRuntime: (options: {
      ref: string
      workspaceId: string
      laneId?: string | null
      leaseId: string
      accessToken: string
    }) => ipcRenderer.invoke('orgDevApp:ensurePublishedRuntime', options),
    cancelBuild: (options: { operationId: string }) => ipcRenderer.invoke('orgDevApp:cancelBuild', options),
    prepareArtifact: (options: {
      downloadUrl: string
      contentHash: string
      entryPath?: string
      runtimeKind?: 'static' | 'service'
    }) => ipcRenderer.invoke('orgDevApp:prepareArtifact', options),
    getRuntimeTrust: (options: { contentHash: string; publicationId: string; permissionSetHash: string }) =>
      ipcRenderer.invoke('orgDevApp:getRuntimeTrust', options),
    approveRuntime: (options: { contentHash: string; publicationId: string; permissionSetHash: string }) =>
      ipcRenderer.invoke('orgDevApp:approveRuntime', options),
    getRuntimeEnvironment: (options: { contentHash: string; publicationId: string }) =>
      ipcRenderer.invoke('orgDevApp:getRuntimeEnvironment', options),
    setRuntimeEnvironment: (options: {
      contentHash: string
      publicationId: string
      values: Record<string, string | null>
    }) => ipcRenderer.invoke('orgDevApp:setRuntimeEnvironment', options),
    startRuntime: (options: {
      ref: string
      contentHash: string
      publicationId: string
      permissionSetHash: string
      leaseId: string
      workspaceId: string
      laneId?: string | null
      accessToken: string
    }) => ipcRenderer.invoke('orgDevApp:startRuntime', options),
    releaseRuntime: (options: { contentHash: string; publicationId: string; leaseId: string }) =>
      ipcRenderer.invoke('orgDevApp:releaseRuntime', options),
    stopRuntime: (options: { contentHash: string; publicationId: string }) =>
      ipcRenderer.invoke('orgDevApp:stopRuntime', options),
    getRuntimeState: (options: { contentHash: string; publicationId: string }) =>
      ipcRenderer.invoke('orgDevApp:getRuntimeState', options),
  },
  devAppPreview: {
    // The renderer names a workspace and a path inside it, never a directory: main joins
    // the two against the root that authorization returns.
    open: (options: { workspaceId: string; laneId?: string | null; relativePath: string; leaseId: string }) =>
      ipcRenderer.invoke('devAppPreview:open', options),
    approve: (options: { sourceId: string; approvalFingerprint: string }) =>
      ipcRenderer.invoke('devAppPreview:approve', options),
    status: (options: { sourceId: string }) => ipcRenderer.invoke('devAppPreview:status', options),
    invokeTool: (options: { sourceId: string; name: string; input: unknown; timeoutMs?: number }) =>
      ipcRenderer.invoke('devAppPreview:invokeTool', options),
    close: (options: { sourceId: string; leaseId: string }) => ipcRenderer.invoke('devAppPreview:close', options),
    onStatus: (
      listener: (payload: {
        sourceId: string
        status: import('@shared/devAppPreviewTypes').DevAppPreviewStatus
      }) => void,
    ) => {
      const wrapped = (
        _event: unknown,
        payload: {
          sourceId: string
          status: import('@shared/devAppPreviewTypes').DevAppPreviewStatus
        },
      ) => listener(payload)
      ipcRenderer.on('devAppPreview:status', wrapped)
      return () => {
        ipcRenderer.removeListener('devAppPreview:status', wrapped)
      }
    },
  },
  devAppAuthoring: {
    inspectWorkspace: (options: { workspaceId: string; relativePath?: string }) =>
      ipcRenderer.invoke('devAppAuthoring:inspectWorkspace', options),
    inspectFolder: (options: { folderPath: string }) => ipcRenderer.invoke('devAppAuthoring:inspectFolder', options),
    listDevelopmentSources: () => ipcRenderer.invoke('devAppAuthoring:listDevelopmentSources'),
    scaffold: (options: {
      workspaceId: string
      name: string
      starter: import('@shared/devAppAuthoringTypes').DevAppScaffoldStarter
    }) => ipcRenderer.invoke('devAppAuthoring:scaffold', options),
  },
  workbenchSession: {
    ensureSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      workspaceId?: string | null
    }) => ipcRenderer.invoke('workbenchSession:ensureSession', options),
    activateSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      workspaceId?: string | null
    }) => ipcRenderer.invoke('workbenchSession:activateSession', options),
    backgroundSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      mode?: 'backgroundWarm' | 'backgroundFrozen'
    }) => ipcRenderer.invoke('workbenchSession:backgroundSession', options),
    closeSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      workspaceId?: string | null
    }) => ipcRenderer.invoke('workbenchSession:closeSession', options),
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
      workspaceId?: string | null
    }) => ipcRenderer.invoke('workbenchSession:bindTerminal', options),
    releaseTerminal: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      tileId: string
      close?: boolean
    }) => ipcRenderer.invoke('workbenchSession:releaseTerminal', options),
    setNativePreviewSession: (options: {
      sessionKey?: string | null
      projectId: string
      laneId: string
      locator: import('../../../shared/nativePreviewTypes').NativePreviewSessionLocator | null
      stopPrevious?: boolean
    }) => ipcRenderer.invoke('workbenchSession:setNativePreviewSession', options),
    onStateChanged: (
      callback: (session: import('../../../shared/electronApiTypes').WorkbenchSessionSnapshot) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        session: import('../../../shared/electronApiTypes').WorkbenchSessionSnapshot,
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
    resolveLaunchConfig: (
      options: import('../../../shared/nativePreviewTypes').NativePreviewResolveLaunchConfigRequest,
    ) => ipcRenderer.invoke('nativePreview:resolveLaunchConfig', options),
    startSession: (options: import('../../../shared/nativePreviewTypes').NativePreviewStartSessionRequest) =>
      ipcRenderer.invoke('nativePreview:startSession', options),
    stopSession: (options: import('../../../shared/nativePreviewTypes').NativePreviewStopSessionRequest) =>
      ipcRenderer.invoke('nativePreview:stopSession', options),
    getSessionState: (options: import('../../../shared/nativePreviewTypes').NativePreviewSessionLocator) =>
      ipcRenderer.invoke('nativePreview:getSessionState', options),
    sendTouches: (options: import('../../../shared/nativePreviewTypes').NativePreviewSendTouchesRequest) =>
      ipcRenderer.invoke('nativePreview:sendTouches', options),
    sendWheel: (options: import('../../../shared/nativePreviewTypes').NativePreviewSendWheelRequest) =>
      ipcRenderer.invoke('nativePreview:sendWheel', options),
    sendKey: (options: import('../../../shared/nativePreviewTypes').NativePreviewSendKeyRequest) =>
      ipcRenderer.invoke('nativePreview:sendKey', options),
    sendButton: (options: import('../../../shared/nativePreviewTypes').NativePreviewSendButtonRequest) =>
      ipcRenderer.invoke('nativePreview:sendButton', options),
    rotate: (options: import('../../../shared/nativePreviewTypes').NativePreviewRotateRequest) =>
      ipcRenderer.invoke('nativePreview:rotate', options),
    captureScreenshot: (options: import('../../../shared/nativePreviewTypes').NativePreviewCaptureScreenshotRequest) =>
      ipcRenderer.invoke('nativePreview:captureScreenshot', options),
    copyLastScreenshot: (options: import('../../../shared/nativePreviewTypes').NativePreviewCaptureScreenshotRequest) =>
      ipcRenderer.invoke('nativePreview:copyLastScreenshot', options),
    onStateChanged: (
      callback: (event: import('../../../shared/nativePreviewTypes').NativePreviewStateChangedEvent) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: import('../../../shared/nativePreviewTypes').NativePreviewStateChangedEvent,
      ) => {
        callback(payload)
      }
      ipcRenderer.on('nativePreview:stateChanged', handler)
      return () => ipcRenderer.removeListener('nativePreview:stateChanged', handler)
    },
  },
  project: {
    listGitBranches: (options: { workspaceId: string }) => ipcRenderer.invoke('project:listGitBranches', options),
    checkoutGitBranch: (options: { workspaceId: string; branch: string }) =>
      ipcRenderer.invoke('project:checkoutGitBranch', options),
    createGitWorktree: (options: { workspaceId: string; branch: string; newBranch?: string; path?: string | null }) =>
      ipcRenderer.invoke('project:createGitWorktree', options),
    mergeLaneIntoCollab: (options: { collabProjectPath: string; collabBranch: string; sourceBranch: string }) =>
      ipcRenderer.invoke('project:mergeLaneIntoCollab', options),
    openFolder: (options: { workspaceId: string }) => ipcRenderer.invoke('project:openFolder', options),
    pathExists: (workspaceId: string) => ipcRenderer.invoke('project:pathExists', { workspaceId }),
    resolveRoot: (workspaceId: string) => ipcRenderer.invoke('project:resolveRoot', { workspaceId }),
    writeFile: (options: {
      workspaceId: string
      filePath: string
      content: string
      encoding?: 'utf8' | 'base64'
      origin?: 'agent' | 'remote' | 'sync' | import('../../../shared/electronApiTypes').FileChangeAttribution
    }) => ipcRenderer.invoke('project:writeFile', options),
    readFile: (options: { workspaceId: string; filePath: string }) => ipcRenderer.invoke('project:readFile', options),
    readFileBase64: (options: { workspaceId: string; filePath: string }) =>
      ipcRenderer.invoke('project:readFileBase64', options),
    listDirectory: (options: { workspaceId: string; directory?: string | null }) =>
      ipcRenderer.invoke('project:listDirectory', options),
    listFiles: (options: { workspaceId: string }) => ipcRenderer.invoke('project:listFiles', options),
    getContextOptions: (options: {
      workspaceId: string
      frameworkInfo?: import('../../../shared/electronApiTypes').ProjectStoredFrameworkInfo | null
    }) => ipcRenderer.invoke('project:getContextOptions', options),
    renameFile: (options: {
      workspaceId: string
      oldPath: string
      newPath: string
      origin?: 'agent' | 'remote' | 'sync' | import('../../../shared/electronApiTypes').FileChangeAttribution
    }) => ipcRenderer.invoke('project:renameFile', options),
    deletePath: (options: {
      workspaceId: string
      targetPath: string
      origin?: 'agent' | 'remote' | 'sync' | import('../../../shared/electronApiTypes').FileChangeAttribution
    }) => ipcRenderer.invoke('project:deletePath', options),
    copyPath: (options: { workspaceId: string; sourcePath: string; destinationPath: string }) =>
      ipcRenderer.invoke('project:copyPath', options),
    copyDirectorySnapshot: (options: { sourcePath: string; targetPath: string; mode?: 'relocation' | 'raw' }) =>
      ipcRenderer.invoke('project:copyDirectorySnapshot', options),
    preflightImportSource: (options: { workspaceId: string; mode?: 'relocation' | 'raw' }) =>
      ipcRenderer.invoke('project:preflightImportSource', options),
    watchStart: (options: { workspaceId: string }) => ipcRenderer.invoke('project:watchStart', options),
    watchStop: (options: { workspaceId: string }) => ipcRenderer.invoke('project:watchStop', options),
    getPathNativeIcon: (options: { workspaceId: string }) => ipcRenderer.invoke('project:getPathNativeIcon', options),
    checkGhCliStatus: () => ipcRenderer.invoke('project:checkGhCliStatus'),
    createGitHubRepo: (options: { workspaceId: string; name: string; visibility?: 'private' | 'public' }) =>
      ipcRenderer.invoke('project:createGitHubRepo', options),
  },
  runtime: {
    getProjectCapabilities: (options: { workspaceId: string }) =>
      ipcRenderer.invoke('runtime:getProjectCapabilities', options),
    resolveCommand: (options: { workspaceId: string; command: string }) =>
      ipcRenderer.invoke('runtime:resolveCommand', options),
    ensureCommandRuntime: (options: { workspaceId: string; command: string }) =>
      ipcRenderer.invoke('runtime:ensureCommandRuntime', options),
    detectProjectRuntime: (options: { workspaceId: string }) =>
      ipcRenderer.invoke('runtime:detectProjectRuntime', options),
    ensureForCommand: (options: { workspaceId: string; command: string }) =>
      ipcRenderer.invoke('runtime:ensureForCommand', options),
    ensureRuntime: (options: {
      runtime: RuntimeKind
      target?: string
      cleanBrokenLocalFiles?: boolean
      forceReinstall?: boolean
    }) => ipcRenderer.invoke('runtime:ensureRuntime', options),
    getRuntimeStatus: (options?: { workspaceId?: string }) =>
      ipcRenderer.invoke('runtime:getRuntimeStatus', options ?? {}),
  },
  fs: {
    readDir: (path: string) => ipcRenderer.invoke('fs:readDir', path),
    readFile: (path: string) => ipcRenderer.invoke('fs:readFile', path),
  },
  workspaceSync: {
    hashFile: (options: { workspaceId: string; laneId?: string | null; path: string }) =>
      ipcRenderer.invoke('workspaceSync:hashFile', options),
    writeFiles: (options: {
      workspaceId: string
      files: SyncWriteFile[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'editor' | 'agent' | 'watcher' | 'remote'
      }
    }) => ipcRenderer.invoke('workspaceSync:writeFiles', options),
    deleteFiles: (options: {
      workspaceId: string
      paths: string[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'editor' | 'agent' | 'watcher' | 'remote'
      }
    }) => ipcRenderer.invoke('workspaceSync:deleteFiles', options),
    getGitRuntimeHealth: (options?: { force?: boolean }) =>
      ipcRenderer.invoke('workspaceSync:getGitRuntimeHealth', options ?? {}),
    gitEnsureRepo: (options: { workspaceId: string; branch?: string; repoUrl?: string; debug?: boolean }) =>
      ipcRenderer.invoke('workspaceSync:gitEnsureRepo', options),
    gitCloneIfMissing: (options: {
      workspaceId: string
      repoUrl: string
      branch?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('workspaceSync:gitCloneIfMissing', options),
    gitFetchMain: (options: {
      workspaceId: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('workspaceSync:gitFetchMain', options),
    gitStatus: (options: { workspaceId: string; remote?: string; branch?: string; debug?: boolean }) =>
      ipcRenderer.invoke('workspaceSync:gitStatus', options),
    gitPullMain: (options: {
      workspaceId: string
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
    }) => ipcRenderer.invoke('workspaceSync:gitPullMain', options),
    gitReplayLocalCommits: (options: {
      workspaceId: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('workspaceSync:gitReplayLocalCommits', options),
    gitClassifyRepoHealth: (options: { workspaceId: string; remote?: string; branch?: string; debug?: boolean }) =>
      ipcRenderer.invoke('workspaceSync:gitClassifyRepoHealth', options),
    gitSalvageReclone: (options: {
      workspaceId: string
      repoUrl: string
      branch?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('workspaceSync:gitSalvageReclone', options),
    gitReadConflictFile: (options: { workspaceId: string; filePath: string }) =>
      ipcRenderer.invoke('workspaceSync:gitReadConflictFile', options),
    gitResolveConflictFile: (options: { workspaceId: string; filePath: string; resolvedContent: string }) =>
      ipcRenderer.invoke('workspaceSync:gitResolveConflictFile', options),
    gitRestoreMain: (options: {
      workspaceId: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
      debug?: boolean
    }) => ipcRenderer.invoke('workspaceSync:gitRestoreMain', options),
    gitAdoptWorkspace: (options: { workspaceId: string; branch?: string; repoUrl?: string; debug?: boolean }) =>
      ipcRenderer.invoke('workspaceSync:gitAdoptWorkspace', options),
    gitCommitAll: (options: { workspaceId: string; message: string; addAll?: boolean }) =>
      ipcRenderer.invoke('workspaceSync:gitCommitAll', options),
    gitPushMain: (options: {
      workspaceId: string
      remote?: string
      branch?: string
      repoUrl?: string
      extraHeader?: string
      provider?: string
      accessToken?: string
      encryptedCredentials?: string
      keyId?: string
    }) => ipcRenderer.invoke('workspaceSync:gitPushMain', options),
    gitCommitAndPush: (options: {
      workspaceId: string
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
    }) => ipcRenderer.invoke('workspaceSync:gitCommitAndPush', options),
    gitCaptureCheckpoint: (options: {
      workspaceId: string
      checkpointId: string
      authorName: string
      authorEmail?: string
    }) => ipcRenderer.invoke('workspaceSync:gitCaptureCheckpoint', options),
    gitDiffCheckpoints: (options: {
      workspaceId: string
      fromCheckpointId?: string | null
      toCheckpointId: string
      filePath?: string
    }) => ipcRenderer.invoke('workspaceSync:gitDiffCheckpoints', options),
    gitReadCheckpointFilePair: (options: {
      workspaceId: string
      fromCheckpointId?: string | null
      toCheckpointId: string
      filePath: string
    }) => ipcRenderer.invoke('workspaceSync:gitReadCheckpointFilePair', options),
    gitDeleteCheckpointRefs: (options: { workspaceId: string; checkpointIds: string[] }) =>
      ipcRenderer.invoke('workspaceSync:gitDeleteCheckpointRefs', options),
    gitDeleteAllCheckpointRefs: (options: { workspaceId: string }) =>
      ipcRenderer.invoke('workspaceSync:gitDeleteAllCheckpointRefs', options),
    gitGetHeadDiffStats: (options: { workspaceId: string; authorName?: string }) =>
      ipcRenderer.invoke('workspaceSync:gitGetHeadDiffStats', options),
    gitListChanges: (options: { workspaceId: string; scope: 'current' | 'branch'; authorName?: string }) =>
      ipcRenderer.invoke('workspaceSync:gitListChanges', options),
    gitReadChangesPatch: (options: {
      workspaceId: string
      scope: 'current' | 'branch'
      filePath?: string
      authorName?: string
    }) => ipcRenderer.invoke('workspaceSync:gitReadChangesPatch', options),
    gitReadChanges: (options: { workspaceId: string; scope: 'current' | 'branch'; authorName?: string }) =>
      ipcRenderer.invoke('workspaceSync:gitReadChanges', options),
    subscribeGitChanges: (options: { workspaceId: string; scope: 'current' | 'branch' }) =>
      ipcRenderer.invoke('workspaceSync:subscribeGitChanges', options),
    unsubscribeGitChanges: (options: { workspaceId: string; scope: 'current' | 'branch' }) =>
      ipcRenderer.invoke('workspaceSync:unsubscribeGitChanges', options),
    onGitChangesUpdated: (
      callback: (snapshot: import('../../../shared/electronApiTypes').GitChangesSnapshot) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        snapshot: import('../../../shared/electronApiTypes').GitChangesSnapshot,
      ) => callback(snapshot)
      ipcRenderer.on('workspaceSync:gitChangesUpdated', handler)
      return () => ipcRenderer.removeListener('workspaceSync:gitChangesUpdated', handler)
    },
    subscribeGitDirtyState: (options: { workspaceId: string; authorName?: string }) =>
      ipcRenderer.invoke('workspaceSync:subscribeGitDirtyState', options),
    unsubscribeGitDirtyState: (options: { workspaceId: string }) =>
      ipcRenderer.invoke('workspaceSync:unsubscribeGitDirtyState', options),
    onGitDirtyStateChange: (
      callback: (snapshot: import('../../../shared/electronApiTypes').GitDirtyStateSnapshot) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        snapshot: import('../../../shared/electronApiTypes').GitDirtyStateSnapshot,
      ) => callback(snapshot)
      ipcRenderer.on('workspaceSync:gitDirtyStateChanged', handler)
      return () => ipcRenderer.removeListener('workspaceSync:gitDirtyStateChanged', handler)
    },
    mergePreview: (options: {
      baseContent: string
      localContent: string
      cloudContent: string
      strategy?: 'zdiff3' | 'diff3'
      labels?: { local?: string; base?: string; cloud?: string }
    }) => ipcRenderer.invoke('workspaceSync:mergePreview', options),
    mergeTreePreview: (options: {
      baseFiles: Array<{ path: string; content: string }>
      localFiles: Array<{ path: string; content: string }>
      cloudFiles: Array<{ path: string; content: string }>
      maxPreviewFiles?: number
      maxPreviewBytes?: number
    }) => ipcRenderer.invoke('workspaceSync:mergeTreePreview', options),
    enqueueOps: (options: { projectId: string; ops: SyncOp[] }) =>
      ipcRenderer.invoke('workspaceSync:enqueueOps', options),
    ackOps: (options: { projectId: string; opIds: string[] }) => ipcRenderer.invoke('workspaceSync:ackOps', options),
    getJournalState: (options: { projectId: string }) => ipcRenderer.invoke('workspaceSync:getJournalState', options),
  },
  yjs: {
    setInterestRoots: (options: { roots: string[] }) => ipcRenderer.invoke('yjs:setInterestRoots', options),
    onExternalFileChange: (
      callback: (data: {
        filePath: string
        workspaceId?: string
        projectRootPath?: string
        relativePath?: string
        content: string
        origin?: string | import('../../../shared/electronApiTypes').FileChangeAttribution
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          filePath: string
          workspaceId?: string
          projectRootPath?: string
          relativePath?: string
          content: string
          origin?: string | import('../../../shared/electronApiTypes').FileChangeAttribution
        },
      ) => callback(data)
      ipcRenderer.on('yjs:external-file-change', handler)
      return () => ipcRenderer.removeListener('yjs:external-file-change', handler)
    },
    onExternalFileMetaChange: (
      callback: (data: {
        filePath: string
        workspaceId?: string
        projectRootPath?: string
        relativePath?: string
        origin?: string | import('../../../shared/electronApiTypes').FileChangeAttribution
        isBinary: boolean
        isDirectory?: boolean
        sizeBytes: number
        content?: string
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          filePath: string
          workspaceId?: string
          projectRootPath?: string
          relativePath?: string
          origin?: string | import('../../../shared/electronApiTypes').FileChangeAttribution
          isBinary: boolean
          isDirectory?: boolean
          sizeBytes: number
          content?: string
        },
      ) => callback(data)
      ipcRenderer.on('yjs:external-file-meta-change', handler)
      return () => ipcRenderer.removeListener('yjs:external-file-meta-change', handler)
    },
    onExternalFileDelete: (
      callback: (data: {
        filePath: string
        workspaceId?: string
        projectRootPath?: string
        relativePath?: string
        origin?: string | import('../../../shared/electronApiTypes').FileChangeAttribution
      }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: {
          filePath: string
          workspaceId?: string
          projectRootPath?: string
          relativePath?: string
          origin?: string | import('../../../shared/electronApiTypes').FileChangeAttribution
        },
      ) => callback(data)
      ipcRenderer.on('yjs:external-file-delete', handler)
      return () => ipcRenderer.removeListener('yjs:external-file-delete', handler)
    },
  },
  devServer: {
    start: (options: {
      workspaceId: string
      laneId?: string | null
      command: string
      bootstrapCommand?: string | null
      auxiliaryProcesses?: import('../../../shared/electronApiTypes').DevServerAuxiliaryProcessConfig[]
      port: number
      sessionKey?: string | null
      framework?: string | null
      terminalId: string
      cols?: number
      rows?: number
      runId?: string
    }) => ipcRenderer.invoke('devServer:start', options),
    ensure: (options: {
      workspaceId: string
      laneId?: string | null
      command: string
      bootstrapCommand?: string | null
      auxiliaryProcesses?: import('../../../shared/electronApiTypes').DevServerAuxiliaryProcessConfig[]
      port: number
      sessionKey?: string | null
      framework?: string | null
      terminalId: string
      cols?: number
      rows?: number
      runId?: string
    }) => ipcRenderer.invoke('devServer:ensure', options),
    detachSurface: (options: { workspaceId: string; laneId?: string | null; terminalId: string }) =>
      ipcRenderer.invoke('devServer:detachSurface', options),
    attachSurface: (options: { workspaceId: string; laneId?: string | null; terminalId: string }) =>
      ipcRenderer.invoke('devServer:attachSurface', options),
    stop: (options: { workspaceId: string; laneId?: string | null }) => ipcRenderer.invoke('devServer:stop', options),
    resize: (options: { workspaceId: string; laneId?: string | null; cols: number; rows: number }) =>
      ipcRenderer.invoke('devServer:resize', options),
    isRunning: (options: { workspaceId: string; laneId?: string | null }) =>
      ipcRenderer.invoke('devServer:isRunning', options),
    getState: (options: { workspaceId: string; laneId?: string | null }) =>
      ipcRenderer.invoke('devServer:getState', options),
    onStateChange: (
      callback: (data: import('../../../shared/electronApiTypes').DevServerProcessStateEvent) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: import('../../../shared/electronApiTypes').DevServerProcessStateEvent,
      ) => callback(data)
      ipcRenderer.on('devServer:state', handler)
      return () => ipcRenderer.removeListener('devServer:state', handler)
    },
    onOutput: (
      callback: (data: { workspaceId: string; output: string; stream: 'stdout' | 'stderr'; runId?: string }) => void,
    ) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { workspaceId: string; output: string; stream: 'stdout' | 'stderr'; runId?: string },
      ) => callback(data)
      ipcRenderer.on('devServer:output', handler)
      return () => ipcRenderer.removeListener('devServer:output', handler)
    },
    onExit: (callback: (data: { workspaceId: string; code: number | null; runId?: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { workspaceId: string; code: number | null; runId?: string },
      ) => callback(data)
      ipcRenderer.on('devServer:exit', handler)
      return () => ipcRenderer.removeListener('devServer:exit', handler)
    },
  },
  terminal: {
    create: (options: TerminalCreateOptions) => ipcRenderer.invoke('terminal:create', options),
    attachView: (options: { terminalId: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('terminal:attachView', options) as Promise<TerminalAttachViewResult>,
    detachView: (options: { terminalId: string }) => ipcRenderer.invoke('terminal:detachView', options),
    input: (options: { terminalId: string; data: string }) => ipcRenderer.invoke('terminal:input', options),
    resize: (options: { terminalId: string; cols: number; rows: number }) =>
      ipcRenderer.invoke('terminal:resize', options),
    kill: (options: { terminalId: string }) => ipcRenderer.invoke('terminal:kill', options),
    getProfiles: () => ipcRenderer.invoke('terminal:getProfiles'),
    list: (options: { workspaceId: string }) => ipcRenderer.invoke('terminal:list', options),
    getInfo: (options: { terminalId: string }) => ipcRenderer.invoke('terminal:getInfo', options),
    getSnapshot: (options: { terminalId: string }) => ipcRenderer.invoke('terminal:getSnapshot', options),
    getOutputEventsSince: (options: { terminalId: string; afterSequence: number }) =>
      ipcRenderer.invoke('terminal:getOutputEventsSince', options),
    onOutput: (callback: (data: TerminalOutputEvent) => void) => terminalOutputBridge.onOutput(callback),
    onOutputForTerminal: (terminalId: string, callback: (data: TerminalOutputEvent) => void) =>
      terminalOutputBridge.onOutputForTerminal(terminalId, callback),
    onExit: (callback: (data: { terminalId: string; exitCode: number | null; runId?: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { terminalId: string; exitCode: number | null; runId?: string },
      ) => callback(data)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
    onActivity: (callback: (data: { terminalId: string; hasRunningSubprocess: boolean; runId?: string }) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        data: { terminalId: string; hasRunningSubprocess: boolean; runId?: string },
      ) => callback(data)
      ipcRenderer.on('terminal:activity', handler)
      return () => ipcRenderer.removeListener('terminal:activity', handler)
    },
  },
  agentTools: {
    getStatus: (options: { toolId: import('../../../shared/electronApiTypes').AgentToolId }) =>
      ipcRenderer.invoke('agentTools:getStatus', options),
    prepare: (options: { toolId: import('../../../shared/electronApiTypes').AgentToolId }) =>
      ipcRenderer.invoke('agentTools:prepare', options),
    loginStart: (options: { toolId: import('../../../shared/electronApiTypes').AgentToolId }) =>
      ipcRenderer.invoke('agentTools:loginStart', options),
    loginInput: (options: { sessionId: string; value: string }) => ipcRenderer.invoke('agentTools:loginInput', options),
    loginCancel: (options: { sessionId: string }) => ipcRenderer.invoke('agentTools:loginCancel', options),
    onLoginEvent: (callback: (event: import('../../../shared/electronApiTypes').AgentToolLoginEvent) => void) => {
      const handler = (
        _event: Electron.IpcRendererEvent,
        payload: import('../../../shared/electronApiTypes').AgentToolLoginEvent,
      ) => callback(payload)
      ipcRenderer.on('agentTools:login-event', handler)
      return () => ipcRenderer.removeListener('agentTools:login-event', handler)
    },
  },
  projectMemory: {
    getStatus: (options: { workspaceId: string; laneId?: string | null }) =>
      ipcRenderer.invoke('projectMemory:getStatus', options),
    getGraph: (options: { workspaceId: string; laneId?: string | null }) =>
      ipcRenderer.invoke('projectMemory:getGraph', options),
    getNodeDetail: (options: { workspaceId: string; laneId?: string | null; nodeId: string }) =>
      ipcRenderer.invoke('projectMemory:getNodeDetail', options),
  },
  agentSkills: {
    list: () => ipcRenderer.invoke('agentSkills:list'),
    save: (draft: import('../../../shared/electronApiTypes').AgentSkillDraft) =>
      ipcRenderer.invoke('agentSkills:save', draft),
    setProviderEnabled: (options: {
      skillId: string
      provider: import('../../../shared/electronApiTypes').AgentSkillProvider
      enabled: boolean
    }) => ipcRenderer.invoke('agentSkills:setProviderEnabled', options),
    setEnabled: (options: { skillId: string; enabled: boolean }) =>
      ipcRenderer.invoke('agentSkills:setEnabled', options),
    update: (options: { skillId: string }) => ipcRenderer.invoke('agentSkills:update', options),
    install: (options: { skillId: string }) => ipcRenderer.invoke('agentSkills:install', options),
    saveBuild: (options: { buildId?: string; name: string; skillIds: string[] }) =>
      ipcRenderer.invoke('agentSkills:saveBuild', options),
    deleteBuild: (options: { buildId: string }) =>
      ipcRenderer.invoke('agentSkills:deleteBuild', options),
    applyBuild: (options: { buildId: string }) =>
      ipcRenderer.invoke('agentSkills:applyBuild', options),
    copyToLibrary: (options: { skillId: string }) =>
      ipcRenderer.invoke('agentSkills:copyToLibrary', options),
    remove: (options: { skillId: string }) =>
      ipcRenderer.invoke('agentSkills:remove', options),
    importDirectory: () => ipcRenderer.invoke('agentSkills:importDirectory'),
    openSetupPack: () => ipcRenderer.invoke('agentSkills:openSetupPack'),
    copyFromSetupPack: (options: {
      pack: import('../../../shared/electronApiTypes').AgentSkillSetupPack
      packSkillId: string
    }) => ipcRenderer.invoke('agentSkills:copyFromSetupPack', options),
    exportSetupPack: (options: { setupName: string; authorName: string }) =>
      ipcRenderer.invoke('agentSkills:exportSetupPack', options),
  },
  contextMenu: {
    showTerminalSelection: (options: { selectedText: string; x: number; y: number }) =>
      ipcRenderer.invoke('contextMenu:showTerminalSelection', options),
    showFileTreeMenu: (options: { targetPath: string; isDirectory: boolean; x: number; y: number }) =>
      ipcRenderer.invoke('contextMenu:showFileTreeMenu', options),
    showVisualEditorMenu: (options: { hasReactSource: boolean; hasReactStack: boolean; x: number; y: number }) =>
      ipcRenderer.invoke('contextMenu:showVisualEditorMenu', options),
    showNative: (options: { x: number; y: number; editable?: boolean; selectionText?: string; linkUrl?: string }) =>
      ipcRenderer.invoke('contextMenu:showNative', options),
    showOpenInEditorPicker: (options: {
      x: number
      y: number
      editors: ReadonlyArray<{ id: import('../../../shared/electronApiTypes').ExternalEditorId; name: string }>
      selectedEditorId: import('../../../shared/electronApiTypes').ExternalEditorId | null
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
  workspace: {
    resolveProject: (req: unknown) => ipcRenderer.invoke('workspace:resolveProject', req),
    listForProject: (projectId: string) => ipcRenderer.invoke('workspace:listForProject', projectId),
    getActiveForProject: (projectId: string) => ipcRenderer.invoke('workspace:getActiveForProject', projectId),
    setActiveForProject: (req: unknown) => ipcRenderer.invoke('workspace:setActiveForProject', req),
    bindExistingFolder: (req: unknown) => ipcRenderer.invoke('workspace:bindExistingFolder', req),
    preflightExistingFolder: (req: unknown) => ipcRenderer.invoke('workspace:preflightExistingFolder', req),
    attachExistingFolder: (req: unknown) => ipcRenderer.invoke('workspace:attachExistingFolder', req),
    importExistingFolder: (req: unknown) => ipcRenderer.invoke('workspace:importExistingFolder', req),
    createForProject: (req: unknown) => ipcRenderer.invoke('workspace:createForProject', req),
    cloneForProject: (req: unknown) => ipcRenderer.invoke('workspace:cloneForProject', req),
    verify: (workspaceId: string) => ipcRenderer.invoke('workspace:verify', workspaceId),
    findByPath: (folderPath: string) => ipcRenderer.invoke('workspace:findByPath', folderPath),
    trashManagedWorkspace: (workspaceId: string) => ipcRenderer.invoke('workspace:trashManagedWorkspace', workspaceId),
    forget: (workspaceId: string) => ipcRenderer.invoke('workspace:forget', workspaceId),
    listCandidates: (req: unknown) => ipcRenderer.invoke('workspace:listCandidates', req),
    openInFinder: (folderPath: string) => ipcRenderer.invoke('workspace:openInFinder', folderPath),
    getCatalogSnapshot: () => ipcRenderer.invoke('workspace:getCatalogSnapshot'),
    onCatalogSnapshotChanged: (callback: (snapshot: WorkspaceCatalogSnapshot) => void) => {
      const handler = (_event: unknown, snapshot: unknown) => callback(snapshot as WorkspaceCatalogSnapshot)
      ipcRenderer.on('workspace:catalogSnapshotChanged', handler)
      return () => {
        ipcRenderer.removeListener('workspace:catalogSnapshotChanged', handler)
      }
    },
  },
} satisfies ElectronAPI)

contextBridge.exposeInMainWorld('desktopBridge', {
  preview: previewBridge,
  getWsUrl: () => assistantWsUrl,
  getAssistantRuntimeStatus: () =>
    ipcRenderer.invoke(ASSISTANT_RUNTIME_STATUS_HANDLE) as Promise<AssistantRuntimeBridgeStatus>,
  getSubstrateShadowStatus: () => ipcRenderer.invoke(SUBSTRATE_SHADOW_STATUS_HANDLE),
  substrateVcs: {
    invalidate: (cwd: string) => ipcRenderer.invoke(SUBSTRATE_VCS_INVALIDATE_HANDLE, cwd),
    getCapabilities: () => ipcRenderer.invoke(SUBSTRATE_VCS_CAPABILITIES_HANDLE),
  },
  pickFolder: async () => {
    const res = await ipcRenderer.invoke('dialog:selectDirectory')
    return res.success ? res.path : null
  },
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
    const handler = (_event: Electron.IpcRendererEvent, status: AssistantRuntimeBridgeStatus) => listener(status)
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
