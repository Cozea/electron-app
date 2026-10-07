export * from '@cozea/app-contract/electronApi'

declare global {
  interface Window {
    electronAPI: import('@cozea/app-contract/electronApi').ElectronAPI
    desktopBridge?: import('@cozea/app-contract/desktopBridge').DesktopBridgeSurface
    nativeApi?: import('@cozea/assistant-contracts').NativeApi
  }
}
