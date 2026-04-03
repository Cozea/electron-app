import type { WorkbenchBrowserViewState } from "@shared/electronApiTypes"
import type {
  BrowserCreateOptions,
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
    loadError: state.loadError ?? null,
  }
}

export class BrowserTileModel {
  private stateValue: BrowserState
  private listeners = new Set<BrowserStateListener>()
  private unsubscribeStateChange: (() => void) | null = null
  private initializePromise: Promise<void> | null = null
  private initialized = false
  private lastRequestedUrl = ""
  private lastBoundsSignature: string | null = null

  constructor(readonly id: string) {
    this.stateValue = DEFAULT_BROWSER_STATE(id)
    this.unsubscribeStateChange = window.electronAPI.workbenchBrowser.onStateChange((nextState) => {
      if (nextState.tileId !== this.id) return
      this.stateValue = toBrowserState(nextState)
      this.emit()
    })
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
      if (options.initialUrl) {
        this.lastRequestedUrl = options.initialUrl
      }
      return
    }

    if (!this.initializePromise) {
      this.initializePromise = (async () => {
        const ensuredState = await window.electronAPI.workbenchBrowser.ensureTile({
          tileId: this.id,
          initialUrl: options.initialUrl,
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
    const payload = visible
      ? { tileId: this.id, visible: true as const }
      : { tileId: this.id, visible: false as const }
    const signature = JSON.stringify(payload)
    if (signature === this.lastBoundsSignature) return
    this.lastBoundsSignature = signature
    await window.electronAPI.workbenchBrowser.setBounds(payload)
  }

  async layout(bounds: BrowserHostBounds): Promise<void> {
    const payload = {
      tileId: this.id,
      visible: true as const,
      bounds,
    }
    const signature = JSON.stringify(payload)
    if (signature === this.lastBoundsSignature) return
    this.lastBoundsSignature = signature
    await window.electronAPI.workbenchBrowser.setBounds(payload)
  }

  async loadURL(url: string): Promise<BrowserState> {
    await this.initialize({ initialUrl: url })

    if (!url || this.lastRequestedUrl === url) {
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
    this.unsubscribeStateChange?.()
    this.unsubscribeStateChange = null
    this.lastBoundsSignature = null
    await window.electronAPI.workbenchBrowser.destroyTile({ tileId: this.id })
  }

  private emit() {
    for (const listener of this.listeners) {
      listener(this.stateValue)
    }
  }
}
