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

  private emitState(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null

    const { webContents } = record.view
    record.state = {
      tileId,
      url: webContents.getURL() || record.state.url,
      title: webContents.getTitle() || record.state.title || 'Browser',
      isLoading: webContents.isLoading(),
      canGoBack: webContents.canGoBack(),
      canGoForward: webContents.canGoForward(),
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

    view.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      emit()
    })
    view.webContents.on('did-start-loading', emit)
    view.webContents.on('did-stop-loading', emit)
    view.webContents.on('did-finish-load', emit)
    view.webContents.on('did-navigate', emit)
    view.webContents.on('did-navigate-in-page', emit)
    view.webContents.on('did-fail-load', emit)
  }

  async ensureTile(tileId: string, initialUrl?: string): Promise<WorkbenchBrowserViewState> {
    const existing = this.records.get(tileId)
    if (existing) {
      if (initialUrl && initialUrl !== existing.state.url) {
        await existing.view.webContents.loadURL(initialUrl)
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
      },
    }

    this.records.set(tileId, record)
    this.attachView(tileId, view)

    if (initialUrl) {
      await view.webContents.loadURL(initialUrl)
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

    await record.view.webContents.loadURL(url)
    return this.emitState(tileId)
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
    if (record.view.webContents.canGoBack()) {
      record.view.webContents.goBack()
    }
    return this.emitState(tileId)
  }

  goForward(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    if (record.view.webContents.canGoForward()) {
      record.view.webContents.goForward()
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
