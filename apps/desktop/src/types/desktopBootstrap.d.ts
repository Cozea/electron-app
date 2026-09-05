import type { DesktopBootstrapBridge } from '@shared/desktopBootstrapTypes'

declare global {
  interface Window {
    cozeaBootstrap?: DesktopBootstrapBridge
  }
}

export {}
