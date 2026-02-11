export * from '@shared/electronApiTypes'

declare global {
  interface Window {
    electronAPI: import('@shared/electronApiTypes').ElectronAPI
  }
}

