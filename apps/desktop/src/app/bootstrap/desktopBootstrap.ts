import {
  DESKTOP_BOOTSTRAP_VERSION,
  type DesktopBootstrapSnapshot,
} from '@shared/desktopBootstrapTypes'
import { featureFlags } from '@/lib/featureFlags'

let initialSnapshot: DesktopBootstrapSnapshot | null = null

function emptySnapshot(): DesktopBootstrapSnapshot {
  return {
    version: DESKTOP_BOOTSTRAP_VERSION,
    capturedAt: Date.now(),
    session: null,
    lastWorkbenchRoute: null,
  }
}

export function isDesktopBootstrapRootLocation(protocol: string, pathname: string): boolean {
  if (pathname === '/' || pathname === '/projects' || pathname === '/projects/') return true
  return protocol === 'file:' && /\/index\.html$/i.test(pathname)
}

export async function initializeDesktopBootstrap(): Promise<DesktopBootstrapSnapshot> {
  let snapshot = emptySnapshot()
  if (featureFlags.desktopBootstrap && window.cozeaBootstrap) {
    try {
      snapshot = await window.cozeaBootstrap.getInitialSnapshot()
    } catch (error) {
      console.warn('[DesktopBootstrap] Failed to read the local bootstrap snapshot.', error)
    }
  }

  initialSnapshot = snapshot
  return snapshot
}

export function getInitialDesktopBootstrap(): DesktopBootstrapSnapshot | null {
  return initialSnapshot
}

export function applyDesktopBootstrapRoute(snapshot: DesktopBootstrapSnapshot): void {
  const locator = snapshot.lastWorkbenchRoute
  if (!featureFlags.desktopBootstrap || !locator) return
  if (window.electronAPI?.windowContext === 'settings') return
  if (!isDesktopBootstrapRootLocation(window.location.protocol, window.location.pathname)) return

  const params = new URLSearchParams()
  if (locator.laneId) params.set('lane', locator.laneId)
  if (locator.focusTileId) params.set('focusTile', locator.focusTileId)
  const query = params.toString()
  const path = `/projects/p/${encodeURIComponent(locator.projectId)}/workbench${query ? `?${query}` : ''}`
  window.history.replaceState(window.history.state, '', path)
}
