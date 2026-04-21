import type { WorkbenchBrowserViewState } from "@shared/electronApiTypes"
import type {
  BrowserCreateOptions,
  BrowserFindInPageOptions,
  BrowserHostBounds,
  BrowserState,
} from "@shared/browserHostTypes"

type BrowserStateListener = (state: BrowserState) => void

const DEFAULT_BROWSER_STATE = (tileId: string, url = ""): BrowserState => ({
  tileId,
  url,
  title: "Browser",
  isLoading: false,
  canGoBack: false,
  canGoForward: false,
  favicon: null,
  focused: false,
  visible: false,
  isDevToolsOpen: false,
  storageScope: "workspace",
  zoomFactor: 1,
  canZoomIn: true,
  canZoomOut: true,
  find: {
    query: "",
    visible: false,
    matchCase: false,
    activeMatchOrdinal: 0,
    matches: 0,
    finalUpdate: false,
  },
  loadError: null,
})

function toBrowserState(state: WorkbenchBrowserViewState): BrowserState {
  return {
    tileId: state.tileId,
    url: state.url,
    title: state.title,
    isLoading: state.isLoading,
    canGoBack: state.canGoBack,
    canGoForward: state.canGoForward,
    favicon: state.favicon ?? null,
    focused: state.focused,
    visible: state.visible,
    isDevToolsOpen: state.isDevToolsOpen,
    storageScope: state.storageScope,
    zoomFactor: state.zoomFactor,
    canZoomIn: state.canZoomIn,
    canZoomOut: state.canZoomOut,
    find: state.find,
    loadError: state.loadError ?? null,
  }
}

interface BrowserTileModelRegistryEntry {
  model: BrowserTileModel
  refCount: number
  persistent: boolean
}

const browserTileModelRegistry = new Map<string, BrowserTileModelRegistryEntry>()

const stateChangeRouter = (() => {
  const subscribers = new Map<string, BrowserTileModel>()
  let unsubscribe: (() => void) | null = null

  function ensureGlobalListener() {
    if (unsubscribe) return
    unsubscribe = window.electronAPI.workbenchBrowser.onStateChange((nextState) => {
      const model = subscribers.get(nextState.tileId)
      if (!model) return
      model.handleStateUpdate(nextState)
    })
  }

  return {
    register(id: string, model: BrowserTileModel) {
      subscribers.set(id, model)
      ensureGlobalListener()
    },
    unregister(id: string) {
      subscribers.delete(id)
    },
  }
})()

export class BrowserTileModel {
  readonly id: string
  private stateValue: BrowserState
  private listeners = new Set<BrowserStateListener>()
  private initializePromise: Promise<void> | null = null
  private initialized = false
  private lastRequestedUrl = ""

  constructor(id: string) {
    this.id = id
    this.stateValue = DEFAULT_BROWSER_STATE(id)
    stateChangeRouter.register(id, this)
  }

  handleStateUpdate(nextState: WorkbenchBrowserViewState): void {
    this.stateValue = toBrowserState(nextState)
    this.emit()
  }

  get state(): BrowserState {
    return this.stateValue
  }

  subscribe(listener: BrowserStateListener): () => void {
    this.listeners.add(listener)
    listener(this.stateValue)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async initialize(options: BrowserCreateOptions = {}): Promise<void> {
    if (this.initialized) {
      const existingState = await window.electronAPI.workbenchBrowser.getState({ tileId: this.id })
      if (!existingState) {
        this.initialized = false
      } else {
        this.stateValue = toBrowserState(existingState)
        this.lastRequestedUrl = existingState.url
        this.emit()
      }

      if (this.initialized) {
        return
      }
    }

    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        const ensuredState = await window.electronAPI.workbenchBrowser.ensureTile({
          tileId: this.id,
          initialUrl: options.initialUrl,
          storageScope: options.storageScope,
          workspaceId: options.workspaceId,
        })

        this.stateValue = toBrowserState(ensuredState)
        this.initialized = true
        this.lastRequestedUrl = options.initialUrl ?? ensuredState.url
        this.emit()
      })().finally(() => {
        this.initializePromise = null
      })
    }

    await this.initializePromise
  }

  async setVisible(visible: boolean): Promise<void> {
    await this.initialize()
    await window.electronAPI.workbenchBrowser.setBounds(
      visible
        ? { tileId: this.id, visible: true as const }
        : { tileId: this.id, visible: false as const },
    )
  }

  async layout(bounds: BrowserHostBounds): Promise<void> {
    await this.initialize()
    await window.electronAPI.workbenchBrowser.setBounds({
      tileId: this.id,
      visible: true as const,
      bounds,
    })
  }

  async loadURL(url: string): Promise<BrowserState> {
    await this.initialize({ initialUrl: url })

    if (!url) {
      return this.stateValue
    }

    if (
      this.lastRequestedUrl === url &&
      this.stateValue.url === url &&
      !this.stateValue.loadError
    ) {
      return this.stateValue
    }

    this.lastRequestedUrl = url
    const nextState = await window.electronAPI.workbenchBrowser.navigate({
      tileId: this.id,
      url,
    })

    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }

    return this.stateValue
  }

  async goBack(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.goBack({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async goForward(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.goForward({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async reload(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.reload({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async hardReload(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.reload({
      tileId: this.id,
      hard: true,
    })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async focus(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.focus({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async toggleDevTools(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.toggleDevTools({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async zoomIn(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.zoomIn({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async zoomOut(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.zoomOut({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async resetZoom(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.resetZoom({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async findInPage(text: string, options: BrowserFindInPageOptions = {}): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.findInPage({
      tileId: this.id,
      text,
      ...options,
    })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async stopFindInPage(keepSelection = false): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.stopFindInPage({
      tileId: this.id,
      keepSelection,
    })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async getSelectedText(): Promise<string> {
    return window.electronAPI.workbenchBrowser.getSelectedText({ tileId: this.id })
  }

  async captureScreenshot(): Promise<string | null> {
    return window.electronAPI.workbenchBrowser.captureScreenshot({ tileId: this.id })
  }

  async openExternal(): Promise<{ success: boolean; error?: string }> {
    return window.electronAPI.workbenchBrowser.openExternal({ tileId: this.id })
  }

  async refreshState(): Promise<BrowserState> {
    const nextState = await window.electronAPI.workbenchBrowser.getState({ tileId: this.id })
    if (nextState) {
      this.stateValue = toBrowserState(nextState)
      this.emit()
    }
    return this.stateValue
  }

  async dispose(): Promise<void> {
    this.listeners.clear()
    stateChangeRouter.unregister(this.id)
    await window.electronAPI.workbenchBrowser.destroyTile({ tileId: this.id })
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.stateValue)
    }
  }
}

export function acquireBrowserTileModel(
  id: string,
  options: { persistent?: boolean } = {},
): BrowserTileModel {
  const existing = browserTileModelRegistry.get(id)
  if (existing) {
    existing.refCount += 1
    if (options.persistent) {
      existing.persistent = true
    }
    return existing.model
  }

  const entry: BrowserTileModelRegistryEntry = {
    model: new BrowserTileModel(id),
    refCount: 1,
    persistent: Boolean(options.persistent),
  }
  browserTileModelRegistry.set(id, entry)
  return entry.model
}

export async function releaseBrowserTileModel(id: string): Promise<void> {
  const entry = browserTileModelRegistry.get(id)
  if (!entry) return

  entry.refCount = Math.max(0, entry.refCount - 1)
  if (entry.refCount > 0 || entry.persistent) {
    return
  }

  browserTileModelRegistry.delete(id)
  await entry.model.dispose()
}

export async function disposeBrowserTileModel(id: string): Promise<void> {
  const entry = browserTileModelRegistry.get(id)
  if (!entry) return

  browserTileModelRegistry.delete(id)
  await entry.model.dispose()
}
