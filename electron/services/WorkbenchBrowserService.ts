import { BrowserWindow, WebContentsView, shell, type Rectangle } from 'electron'

import type { WorkbenchBrowserViewState } from '../../shared/electronApiTypes'

interface WorkbenchBrowserRecord {
  view: WebContentsView
  state: WorkbenchBrowserViewState
}

interface WorkbenchBrowserServiceOptions {
  getMainWindow: () => BrowserWindow | null
}

export class WorkbenchBrowserService {
  private readonly records = new Map<string, WorkbenchBrowserRecord>()

  constructor(private readonly options: WorkbenchBrowserServiceOptions) {}

  private getMainWindow(): BrowserWindow | null {
    return this.options.getMainWindow()
  }

  private getNavigationHistory(view: WebContentsView) {
    return view.webContents.navigationHistory
  }

  private emitState(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null

    const { webContents } = record.view
    const navigationHistory = this.getNavigationHistory(record.view)
    const currentUrl = webContents.getURL()
    const isLoading = webContents.isLoading()
    const resolvedUrl =
      isLoading && record.state.url
        ? record.state.url
        : currentUrl || record.state.url

    record.state = {
      tileId,
      url: resolvedUrl,
      title: webContents.getTitle() || record.state.title || 'Browser',
      isLoading,
      canGoBack: navigationHistory.canGoBack(),
      canGoForward: navigationHistory.canGoForward(),
      loadError: record.state.loadError ?? null,
    }

    this.getMainWindow()?.webContents.send('workbenchBrowser:state', record.state)
    return record.state
  }

  private attachView(tileId: string, view: WebContentsView): void {
    const mainWindow = this.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return

    mainWindow.contentView.addChildView(view)
    view.webContents.setWindowOpenHandler(({ url }) => {
      void shell.openExternal(url)
      return { action: 'deny' }
    })

    const emit = () => {
      this.emitState(tileId)
    }

    view.webContents.on('did-start-loading', () => {
      const record = this.records.get(tileId)
      if (record) {
        record.state.loadError = null
      }
      emit()
    })

    view.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      emit()
    })
    view.webContents.on('did-stop-loading', emit)
    view.webContents.on('did-finish-load', emit)
    view.webContents.on('did-navigate', emit)
    view.webContents.on('did-navigate-in-page', emit)
    view.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) {
          emit()
          return
        }

        const record = this.records.get(tileId)
        if (record) {
          record.state = {
            ...record.state,
            url: validatedURL || record.state.url,
            isLoading: false,
            loadError: `${errorDescription} (${errorCode})`,
          }
        }
        emit()
      },
    )
  }

  private async loadUrlIntoRecord(
    tileId: string,
    record: WorkbenchBrowserRecord,
    url: string,
  ): Promise<WorkbenchBrowserViewState> {
    record.state = {
      ...record.state,
      url,
      isLoading: true,
      loadError: null,
    }
    this.emitState(tileId)

    try {
      await record.view.webContents.loadURL(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load page.'
      record.state = {
        ...record.state,
        url,
        isLoading: false,
        loadError: message,
      }
    }

    return this.emitState(tileId) ?? record.state
  }

  async ensureTile(tileId: string, initialUrl?: string): Promise<WorkbenchBrowserViewState> {
    const existing = this.records.get(tileId)
    if (existing) {
      if (initialUrl && initialUrl !== existing.state.url) {
        return this.loadUrlIntoRecord(tileId, existing, initialUrl)
      }
      return this.emitState(tileId) ?? existing.state
    }

    const view = new WebContentsView({
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
      },
    })
    view.setBackgroundColor('#00000000')
    view.setVisible(false)

    const record: WorkbenchBrowserRecord = {
      view,
      state: {
        tileId,
        url: initialUrl ?? '',
        title: 'Browser',
        isLoading: false,
        canGoBack: false,
        canGoForward: false,
        loadError: null,
      },
    }

    this.records.set(tileId, record)
    this.attachView(tileId, view)

    if (initialUrl) {
      return this.loadUrlIntoRecord(tileId, record, initialUrl)
    } else {
      this.emitState(tileId)
    }

    return this.emitState(tileId) ?? record.state
  }

  async navigate(tileId: string, url: string): Promise<WorkbenchBrowserViewState | null> {
    const record = this.records.get(tileId)
    if (!record) {
      await this.ensureTile(tileId, url)
      return this.emitState(tileId)
    }

    return this.loadUrlIntoRecord(tileId, record, url)
  }

  setBounds(tileId: string, bounds: Rectangle | null, visible: boolean): boolean {
    const record = this.records.get(tileId)
    if (!record) return false

    if (bounds) {
      record.view.setBounds(bounds)
    }
    record.view.setVisible(visible)
    return true
  }

  getState(tileId: string): WorkbenchBrowserViewState | null {
    return this.emitState(tileId)
  }

  goBack(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    const navigationHistory = this.getNavigationHistory(record.view)
    if (navigationHistory.canGoBack()) {
      navigationHistory.goBack()
    }
    return this.emitState(tileId)
  }

  goForward(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    const navigationHistory = this.getNavigationHistory(record.view)
    if (navigationHistory.canGoForward()) {
      navigationHistory.goForward()
    }
    return this.emitState(tileId)
  }

  reload(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    record.view.webContents.reload()
    return this.emitState(tileId)
  }

  destroyTile(tileId: string): boolean {
    const record = this.records.get(tileId)
    if (!record) return false

    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.contentView.removeChildView(record.view)
    }

    if (!record.view.webContents.isDestroyed()) {
      record.view.webContents.destroy()
    }

    this.records.delete(tileId)
    return true
  }

  dispose(): void {
    for (const tileId of Array.from(this.records.keys())) {
      this.destroyTile(tileId)
    }
  }
}
