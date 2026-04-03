export type BrowserStorageScope = 'global' | 'workspace' | 'ephemeral'

export interface BrowserHostBounds {
  x: number
  y: number
  width: number
  height: number
}

export interface BrowserLoadError {
  message: string
}

export interface BrowserState {
  tileId: string
  url: string
  title: string
  isLoading: boolean
  canGoBack: boolean
  canGoForward: boolean
  loadError?: string | null
}

export interface BrowserCreateOptions {
  initialUrl?: string
  storageScope?: BrowserStorageScope
}
