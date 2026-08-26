import { BrowserWindow, WebContentsView, session, shell, type Rectangle } from 'electron'

import type { WorkbenchBrowserViewState } from '../../shared/electronApiTypes'
import type {
  BrowserFindInPageOptions,
  BrowserFindState,
  BrowserStorageScope,
  BrowserUiCommand,
} from '../../shared/browserHostTypes'

interface WorkbenchBrowserRecord {
  view: WebContentsView
  state: WorkbenchBrowserViewState
  storageScope: BrowserStorageScope
  workspaceId: string | null
  /** Monotonic per-record navigation counter; see loadUrlIntoRecord. */
  navigationId: number
}

interface WorkbenchBrowserServiceOptions {
  getMainWindow: () => BrowserWindow | null
}

interface EnsureWorkbenchBrowserTileOptions {
  initialUrl?: string
  storageScope?: BrowserStorageScope
  workspaceId?: string
}

const BROWSER_ZOOM_FACTORS = [0.25, 1 / 3, 0.5, 2 / 3, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5, 3, 4, 5] as const
const DEFAULT_BROWSER_ZOOM_FACTOR = 1
const MIN_BROWSER_ZOOM_FACTOR = BROWSER_ZOOM_FACTORS[0]
const MAX_BROWSER_ZOOM_FACTOR = BROWSER_ZOOM_FACTORS[BROWSER_ZOOM_FACTORS.length - 1]
const IS_MAC = process.platform === 'darwin'

export class WorkbenchBrowserService {
  private readonly records = new Map<string, WorkbenchBrowserRecord>()
  private readonly sessions = new Map<string, Electron.Session>()
  private readonly pendingEmits = new Set<string>()
  private emitScheduled = false
  private readonly options: WorkbenchBrowserServiceOptions

  constructor(options: WorkbenchBrowserServiceOptions) {
    this.options = options
  }

  private getMainWindow(): BrowserWindow | null {
    return this.options.getMainWindow()
  }

  private getNavigationHistory(view: WebContentsView) {
    return view.webContents.navigationHistory
  }

  private normalizeSessionSegment(value: string): string {
    const normalized = value.trim().replace(/[^a-z0-9_-]+/gi, '-')
    return normalized.length > 0 ? normalized.slice(0, 120) : 'default'
  }

  private buildSessionKey(
    tileId: string,
    storageScope: BrowserStorageScope,
    workspaceId?: string | null,
  ): string {
    if (storageScope === 'global') {
      return 'persist:cozea-browser-global'
    }

    if (storageScope === 'workspace' && workspaceId) {
      return `persist:cozea-browser-workspace-${this.normalizeSessionSegment(workspaceId)}`
    }

    return `cozea-browser-ephemeral-${this.normalizeSessionSegment(tileId)}`
  }

  private resolveSession(
    tileId: string,
    storageScope: BrowserStorageScope,
    workspaceId?: string | null,
  ): Electron.Session {
    const key = this.buildSessionKey(tileId, storageScope, workspaceId)
    const existing = this.sessions.get(key)
    if (existing) {
      return existing
    }

    const nextSession = session.fromPartition(key)
    this.sessions.set(key, nextSession)
    return nextSession
  }

  private createInitialFindState(): BrowserFindState {
    return {
      query: '',
      visible: false,
      matchCase: false,
      activeMatchOrdinal: 0,
      matches: 0,
      finalUpdate: false,
    }
  }

  private emitCommand(command: BrowserUiCommand): void {
    this.getMainWindow()?.webContents.send('workbenchBrowser:command', command)
  }

  private isPrimaryModifier(input: Electron.Input): boolean {
    return IS_MAC ? Boolean(input.meta) : Boolean(input.control)
  }

  private async readSelectedText(record: WorkbenchBrowserRecord): Promise<string> {
    try {
      const result = await record.view.webContents.executeJavaScript(
        'String(window.getSelection() ?? "")',
      )
      return typeof result === 'string' ? result : ''
    } catch {
      return ''
    }
  }

  private async emitShowFindWithSelection(
    tileId: string,
    record: WorkbenchBrowserRecord,
  ): Promise<void> {
    const selectedText = (await this.readSelectedText(record)).trim()
    // Tile may have been torn down while the selection read was in flight.
    if (!this.records.has(tileId)) return
    this.emitCommand({
      tileId,
      type: 'show-find',
      query: selectedText && !/[\r\n]/.test(selectedText) ? selectedText : undefined,
    })
  }

  private triggerFindNavigation(
    tileId: string,
    record: WorkbenchBrowserRecord,
    forward: boolean,
  ): void {
    if (!record.state.find.query) return
    this.findInPage(tileId, record.state.find.query, {
      forward,
      recompute: false,
      matchCase: record.state.find.matchCase,
    })
  }

  private createInitialState(
    tileId: string,
    initialUrl: string | undefined,
    storageScope: BrowserStorageScope,
  ): WorkbenchBrowserViewState {
    return {
      tileId,
      url: initialUrl ?? '',
      title: 'Browser',
      isLoading: false,
      canGoBack: false,
      canGoForward: false,
      favicon: null,
      focused: false,
      visible: false,
      isDevToolsOpen: false,
      storageScope,
      zoomFactor: DEFAULT_BROWSER_ZOOM_FACTOR,
      canZoomIn: true,
      canZoomOut: true,
      find: this.createInitialFindState(),
      loadError: null,
    }
  }

  private clampZoomFactor(value: number): number {
    return Math.min(MAX_BROWSER_ZOOM_FACTOR, Math.max(MIN_BROWSER_ZOOM_FACTOR, value))
  }

  private resolveZoomFactor(view: WebContentsView): number {
    return this.clampZoomFactor(view.webContents.getZoomFactor() || DEFAULT_BROWSER_ZOOM_FACTOR)
  }

  private resolveNextZoomFactor(current: number, direction: 1 | -1): number {
    const currentIndex = BROWSER_ZOOM_FACTORS.findIndex((factor) => factor >= current - 0.001 && factor <= current + 0.001)
    if (currentIndex >= 0) {
      const nextIndex = Math.min(
        BROWSER_ZOOM_FACTORS.length - 1,
        Math.max(0, currentIndex + direction),
      )
      return BROWSER_ZOOM_FACTORS[nextIndex]
    }

    if (direction > 0) {
      return BROWSER_ZOOM_FACTORS.find((factor) => factor > current) ?? MAX_BROWSER_ZOOM_FACTOR
    }

    for (let index = BROWSER_ZOOM_FACTORS.length - 1; index >= 0; index -= 1) {
      if (BROWSER_ZOOM_FACTORS[index] < current) {
        return BROWSER_ZOOM_FACTORS[index]
      }
    }

    return MIN_BROWSER_ZOOM_FACTOR
  }

  private emitState(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null

    this.refreshRecordState(tileId, record)
    this.getMainWindow()?.webContents.send('workbenchBrowser:state', record.state)
    return record.state
  }

  private refreshRecordState(tileId: string, record: WorkbenchBrowserRecord): void {
    const { webContents } = record.view
    const navigationHistory = this.getNavigationHistory(record.view)
    const currentUrl = webContents.getURL()
    const isLoading = webContents.isLoading()
    const zoomFactor = this.resolveZoomFactor(record.view)
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
      favicon: record.state.favicon ?? null,
      focused: record.state.focused,
      visible: record.state.visible,
      isDevToolsOpen: record.state.isDevToolsOpen,
      storageScope: record.storageScope,
      zoomFactor,
      canZoomIn: zoomFactor < MAX_BROWSER_ZOOM_FACTOR,
      canZoomOut: zoomFactor > MIN_BROWSER_ZOOM_FACTOR,
      find: record.state.find,
      loadError: record.state.loadError ?? null,
    }
  }

  private scheduleEmit(tileId: string): void {
    this.pendingEmits.add(tileId)
    if (this.emitScheduled) return
    this.emitScheduled = true
    queueMicrotask(() => {
      this.emitScheduled = false
      const pending = Array.from(this.pendingEmits)
      this.pendingEmits.clear()
      for (const id of pending) {
        this.emitState(id)
      }
    })
  }

  private attachView(tileId: string, view: WebContentsView): void {
    const mainWindow = this.getMainWindow()
    if (!mainWindow || mainWindow.isDestroyed()) return

    mainWindow.contentView.addChildView(view)
    view.webContents.setWindowOpenHandler(({ url }) => {
      mainWindow.webContents.send('workbenchBrowser:new-page-request', {
        sourceTileId: tileId,
        url,
      })
      return { action: 'deny' }
    })

    const coalesce = () => {
      this.scheduleEmit(tileId)
    }

    view.webContents.on('did-start-loading', () => {
      const record = this.records.get(tileId)
      if (record) {
        record.state.loadError = null
      }
      coalesce()
    })

    view.webContents.on('devtools-opened', () => {
      const record = this.records.get(tileId)
      if (!record) return
      record.state.isDevToolsOpen = true
      coalesce()
    })

    view.webContents.on('devtools-closed', () => {
      const record = this.records.get(tileId)
      if (!record) return
      record.state.isDevToolsOpen = false
      coalesce()
    })

    view.webContents.on('focus', () => {
      const record = this.records.get(tileId)
      if (!record) return
      record.state.focused = true
      coalesce()
    })

    view.webContents.on('blur', () => {
      const record = this.records.get(tileId)
      if (!record) return
      record.state.focused = false
      coalesce()
    })

    view.webContents.on('page-title-updated', (event) => {
      event.preventDefault()
      coalesce()
    })

    view.webContents.on('page-favicon-updated', (_event, favicons) => {
      const record = this.records.get(tileId)
      if (!record) return
      record.state.favicon = favicons[0] ?? null
      coalesce()
    })

    view.webContents.on('found-in-page', (_event, result) => {
      const record = this.records.get(tileId)
      if (!record) return
      record.state.find = {
        ...record.state.find,
        activeMatchOrdinal: result.activeMatchOrdinal,
        matches: result.matches,
        finalUpdate: result.finalUpdate,
      }
      coalesce()
    })

    view.webContents.on('before-input-event', (event, input) => {
      const record = this.records.get(tileId)
      if (!record) return

      // Forward Alt+Shift and Arrow keys for split controls
      if (input.type === 'keyDown' || input.type === 'rawKeyDown') {
        if (input.alt && input.shift) {
          if (['ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight'].includes(input.key)) {
            event.preventDefault()
            this.emitCommand({ tileId, type: 'split-control-key', key: input.key })
            return
          }
          if (input.key === 'Alt' || input.key === 'Shift') {
            this.emitCommand({ tileId, type: 'split-control-activate' })
          }
        }
      }

      if (input.type === 'keyUp') {
        if (input.key === 'Alt' || input.key === 'Shift') {
          this.emitCommand({ tileId, type: 'split-control-deactivate' })
        }
      }

      if (input.type !== 'keyDown' && input.type !== 'rawKeyDown') {
        return
      }

      const primaryModifier = this.isPrimaryModifier(input)
      const code = input.code

      if (primaryModifier && !input.alt) {
        if (code === 'KeyL') {
          event.preventDefault()
          this.emitCommand({ tileId, type: 'focus-url' })
          return
        }

        if (code === 'KeyF') {
          event.preventDefault()
          // preventDefault must run synchronously within the listener, so read
          // the selection asynchronously and emit show-find once it resolves.
          // executeJavaScript may reject (e.g. crashed/destroyed frame); in that
          // case fall back to opening find with no prefilled query.
          void this.emitShowFindWithSelection(tileId, record)
          return
        }

        if (code === 'KeyR') {
          event.preventDefault()
          this.reload(tileId, Boolean(input.shift))
          return
        }

        if (code === 'KeyG') {
          event.preventDefault()
          this.triggerFindNavigation(tileId, record, !input.shift)
          return
        }

        if (code === 'Minus') {
          event.preventDefault()
          this.zoomOut(tileId)
          return
        }

        if (code === 'Equal') {
          event.preventDefault()
          if (input.shift || input.key === '+' || input.key === '=') {
            this.zoomIn(tileId)
          }
          return
        }

        if (code === 'Digit0') {
          event.preventDefault()
          this.resetZoom(tileId)
          return
        }
      }

      if (input.alt && !primaryModifier && !input.shift) {
        if (code === 'ArrowLeft') {
          event.preventDefault()
          this.goBack(tileId)
          return
        }

        if (code === 'ArrowRight') {
          event.preventDefault()
          this.goForward(tileId)
          return
        }
      }

      if (input.key === 'F3') {
        event.preventDefault()
        this.triggerFindNavigation(tileId, record, !input.shift)
        return
      }

      if (input.key === 'Escape' && record.state.find.visible) {
        event.preventDefault()
        this.emitCommand({ tileId, type: 'hide-find' })
      }
    })

    view.webContents.on('did-stop-loading', coalesce)
    view.webContents.on('did-finish-load', coalesce)
    view.webContents.on('did-navigate', coalesce)
    view.webContents.on('did-navigate-in-page', coalesce)
    view.webContents.on(
      'did-fail-load',
      (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
        if (!isMainFrame || errorCode === -3) {
          coalesce()
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
        coalesce()
      },
    )
  }

  private async loadUrlIntoRecord(
    tileId: string,
    record: WorkbenchBrowserRecord,
    url: string,
  ): Promise<WorkbenchBrowserViewState> {
    const navigationId = record.navigationId + 1
    record.navigationId = navigationId
    record.state = {
      ...record.state,
      url,
      isLoading: true,
      find: {
        ...record.state.find,
        activeMatchOrdinal: 0,
        matches: 0,
        finalUpdate: false,
      },
      loadError: null,
    }
    this.emitState(tileId)

    try {
      await record.view.webContents.loadURL(url)
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Failed to load page.'
      // A rejection from a navigation that was superseded by a newer one must
      // not clobber the newer navigation's state — that poisoned the record
      // with a stale loadError (which also gates the view's visibility in the
      // renderer). ERR_ABORTED is likewise not a user-facing failure: it is
      // how Chromium reports a load replaced by another load; the did-fail-load
      // handler already ignores errorCode -3 for the same reason.
      const superseded = record.navigationId !== navigationId
      const aborted = message.includes('ERR_ABORTED')
      if (!superseded && !aborted) {
        record.state = {
          ...record.state,
          url,
          isLoading: false,
          loadError: message,
        }
      }
    }

    return this.emitState(tileId) ?? record.state
  }

  async ensureTile(
    tileId: string,
    options: EnsureWorkbenchBrowserTileOptions = {},
  ): Promise<WorkbenchBrowserViewState> {
    const { initialUrl, storageScope = 'workspace', workspaceId } = options
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
        backgroundThrottling: true,
        session: this.resolveSession(tileId, storageScope, workspaceId ?? null),
      },
    })
    view.setBackgroundColor('#00000000')
    // Native views ignore DOM clipping; round to nest inside the workbench
    // tile card (12px --dv-border-radius minus the 1px host inset).
    view.setBorderRadius(11)
    view.setVisible(false)

    const record: WorkbenchBrowserRecord = {
      view,
      state: this.createInitialState(tileId, initialUrl, storageScope),
      storageScope,
      workspaceId: workspaceId ?? null,
      navigationId: 0,
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
      await this.ensureTile(tileId, { initialUrl: url })
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
    record.state.visible = visible
    return true
  }

  getState(tileId: string): WorkbenchBrowserViewState | null {
    return this.emitState(tileId)
  }

  /** Ids of browser tiles currently owned by the host (already open). */
  listOpenTileIds(): string[] {
    return Array.from(this.records.keys())
  }

  /**
   * Run a script in an already-open tile's main frame.
   * Used by agent automation (flag-gated at the IPC / adapter layer).
   */
  async executeJavaScript(tileId: string, script: string): Promise<unknown> {
    const record = this.records.get(tileId)
    if (!record) {
      throw new Error(`Browser tile "${tileId}" is not open.`)
    }
    if (record.view.webContents.isDestroyed()) {
      throw new Error(`Browser tile "${tileId}" webContents is destroyed.`)
    }
    return record.view.webContents.executeJavaScript(script, true)
  }

  /** Actual native view geometry — diagnostic ground truth for bounds-sync issues. */
  getViewBounds(tileId: string): { bounds: Rectangle; visible: boolean } | null {
    const record = this.records.get(tileId)
    if (!record) return null
    return { bounds: record.view.getBounds(), visible: record.view.getVisible() }
  }

  private applyZoomFactor(tileId: string, nextZoomFactor: number): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null

    record.view.webContents.setZoomFactor(this.clampZoomFactor(nextZoomFactor))
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

  reload(tileId: string, hard = false): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    if (hard) {
      record.view.webContents.reloadIgnoringCache()
    } else {
      record.view.webContents.reload()
    }
    return this.emitState(tileId)
  }

  focus(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    record.view.webContents.focus()
    return this.emitState(tileId)
  }

  toggleDevTools(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    if (record.view.webContents.isDevToolsOpened()) {
      record.view.webContents.closeDevTools()
    } else {
      record.view.webContents.openDevTools({ mode: 'detach', activate: false })
    }
    return this.emitState(tileId)
  }

  async openExternal(tileId: string): Promise<{ success: boolean; error?: string }> {
    const record = this.records.get(tileId)
    if (!record) {
      return { success: false, error: 'Browser tile not found.' }
    }

    const targetUrl = record.view.webContents.getURL() || record.state.url
    if (!targetUrl) {
      return { success: false, error: 'No URL loaded.' }
    }

    try {
      await shell.openExternal(targetUrl)
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to open external browser.',
      }
    }
  }

  zoomIn(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    return this.applyZoomFactor(
      tileId,
      this.resolveNextZoomFactor(this.resolveZoomFactor(record.view), 1),
    )
  }

  zoomOut(tileId: string): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null
    return this.applyZoomFactor(
      tileId,
      this.resolveNextZoomFactor(this.resolveZoomFactor(record.view), -1),
    )
  }

  resetZoom(tileId: string): WorkbenchBrowserViewState | null {
    return this.applyZoomFactor(tileId, DEFAULT_BROWSER_ZOOM_FACTOR)
  }

  findInPage(
    tileId: string,
    text: string,
    options: BrowserFindInPageOptions = {},
  ): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null

    const query = text.trim()
    if (!query) {
      return this.stopFindInPage(tileId, false)
    }

    record.state.find = {
      query,
      visible: true,
      matchCase: Boolean(options.matchCase),
      activeMatchOrdinal: options.recompute ? 0 : record.state.find.activeMatchOrdinal,
      matches: options.recompute ? 0 : record.state.find.matches,
      finalUpdate: false,
    }
    record.view.webContents.findInPage(query, {
      forward: options.forward ?? true,
      findNext: options.recompute ?? false,
      matchCase: options.matchCase ?? false,
    })
    return this.emitState(tileId)
  }

  stopFindInPage(tileId: string, keepSelection = false): WorkbenchBrowserViewState | null {
    const record = this.records.get(tileId)
    if (!record) return null

    record.view.webContents.stopFindInPage(keepSelection ? 'keepSelection' : 'clearSelection')
    record.state.find = this.createInitialFindState()
    return this.emitState(tileId)
  }

  getSelectedText(tileId: string): string {
    const record = this.records.get(tileId)
    if (!record) return ''

    // WebContents exposes no synchronous selection accessor; reading the live
    // DOM selection requires async executeJavaScript (see readSelectedText,
    // used by the show-find prefill). This IPC entry point is synchronous, so
    // it returns '' — which matches prior runtime behavior, where the
    // nonexistent webContents.getSelectedText() always threw into the catch.
    return ''
  }

  async captureScreenshot(tileId: string): Promise<string | null> {
    const record = this.records.get(tileId)
    if (!record) return null

    try {
      const image = await record.view.webContents.capturePage(undefined, { stayHidden: true })
      const buffer = image.toJPEG(100)
      return `data:image/jpeg;base64,${buffer.toString('base64')}`
    } catch {
      return null
    }
  }

  destroyTile(tileId: string): boolean {
    const record = this.records.get(tileId)
    if (!record) return false

    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.contentView.removeChildView(record.view)
    }

    if (!record.view.webContents.isDestroyed()) {
      // WebContents has no destroy(); close() tears the page down as if the
      // content had called window.close(), releasing the renderer. The view is
      // already detached from contentView above, so it is fully torn down.
      record.view.webContents.close()
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
