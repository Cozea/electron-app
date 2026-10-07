import type { DesktopBootstrapBridge } from '@cozea/app-contract/desktopBootstrap'

declare global {
  interface Window {
    cozeaBootstrap?: DesktopBootstrapBridge
  }
}

export {}
