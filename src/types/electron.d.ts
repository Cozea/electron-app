import type { ContextMenuItem } from '@cozea/assistant-contracts'

export * from '@shared/electronApiTypes'

interface DesktopBridgeSurface {
  getAssistantRuntimeStatus: () => Promise<{
    phase: 'idle' | 'starting' | 'ready' | 'error'
    wsUrl: string
    lastError: string | null
    updatedAt: number
  }>
  getSubstrateShadowStatus?: () => Promise<import('@/lib/desktopBridgeClient').SubstrateShadowBridgeStatus>
  substrateVcs?: {
    invalidate: (
      cwd: string,
    ) => Promise<import('@/substrate/vcsClient').SubstrateVcsInvalidateResult>
    getCapabilities: () => Promise<import('@/substrate/vcsClient').SubstrateVcsCapabilities>
  }
  getWsUrl: () => string | null
  pickFolder: () => Promise<string | null>
  confirm: (message: string) => Promise<boolean>
  showContextMenu: <T extends string>(
    items: readonly ContextMenuItem<T>[],
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
