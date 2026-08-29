export type BrowserStorageScope = 'global' | 'workspace' | 'ephemeral' | 'orgDevApp'
export type BrowserNavigationPolicy = 'open' | 'orgDevApp'

export interface BrowserHostBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserLoadError {
  message: string
}

export interface BrowserFindInPageOptions {
  forward?: boolean
  recompute?: boolean
  matchCase?: boolean
}

export interface BrowserFindState {
  query: string
  visible: boolean
  matchCase: boolean
  activeMatchOrdinal: number
  matches: number
  finalUpdate: boolean
}

export interface BrowserUiCommand {
  tileId: string
  type: 'focus-url' | 'show-find' | 'hide-find' | 'split-control-activate' | 'split-control-deactivate' | 'split-control-key'
  query?: string
  key?: string
}

export interface BrowserState {
  tileId: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  favicon?: string | null
  focused: boolean
  visible: boolean
  isDevToolsOpen: boolean
  storageScope: BrowserStorageScope
  zoomFactor: number
  canZoomIn: boolean
  canZoomOut: boolean
  find: BrowserFindState
  loadError?: string | null
  httpStatusCode?: number | null
  httpStatusText?: string | null
  httpError?: string | null
}

export interface BrowserCreateOptions {
  initialUrl?: string
  storageScope?: BrowserStorageScope
  workspaceId?: string
  partitionKey?: string
  navigationPolicy?: BrowserNavigationPolicy
}

export interface BrowserNewPageRequest {
  sourceTileId: string
  url: string
}
