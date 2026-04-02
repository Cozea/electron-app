export * from '@shared/electronApiTypes'

interface DesktopBridgeSurface {
  getAssistantRuntimeStatus: () => Promise<{
    phase: 'idle' | 'starting' | 'ready' | 'error'
    wsUrl: string
    lastError: string | null
    updatedAt: number
  }>
  getWsUrl: () => string | null
  pickFolder: () => Promise<string | null>
  confirm: (message: string) => Promise<boolean>
  showContextMenu: <T extends string>(
    items: readonly Array<{ id: T; label?: string; destructive?: boolean }>,
    position?: { x: number; y: number },
  ) => Promise<T | null>
  openExternal: (url: string) => Promise<boolean>
  onAssistantRuntimeStatus?: (
    listener: (status: {
      phase: 'idle' | 'starting' | 'ready' | 'error'
      wsUrl: string
      lastError: string | null
      updatedAt: number
    }) => void,
  ) => () => void
}

declare global {
  interface Window {
    electronAPI: import('@shared/electronApiTypes').ElectronAPI
    desktopBridge?: DesktopBridgeSurface
    nativeApi?: import('@cozea/assistant-contracts').NativeApi
  }
}
