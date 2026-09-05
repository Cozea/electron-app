import {
  DESKTOP_BOOTSTRAP_VERSION,
  type DesktopBootstrapSnapshot,
  type DesktopWorkbenchLocator,
} from '@shared/desktopBootstrapTypes'
import { featureFlags } from '@/lib/featureFlags'

const LEGACY_LAST_WORKBENCH_ROUTE_STORAGE_KEY = 'cozea.lastWorkbenchRoute.v1'

interface LegacyLastWorkbenchRouteState {
  entriesByWorkspaceSelectionId?: Record<string, DesktopWorkbenchLocator>
}

let initialSnapshot: DesktopBootstrapSnapshot | null = null

function emptySnapshot(): DesktopBootstrapSnapshot {
  return {
    version: DESKTOP_BOOTSTRAP_VERSION,
    capturedAt: Date.now(),
    session: null,
    lastWorkbenchRoute: null,
  }
}

function readLegacyLastWorkbenchRoute(workspaceSelectionId: string): DesktopWorkbenchLocator | null {
  try {
    const raw = window.localStorage.getItem(LEGACY_LAST_WORKBENCH_ROUTE_STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as LegacyLastWorkbenchRouteState | null
    const entry = parsed?.entriesByWorkspaceSelectionId?.[workspaceSelectionId]
    if (!entry) return null
    if (
      typeof entry.workspaceSelectionId !== 'string' ||
      typeof entry.projectId !== 'string' ||
      typeof entry.laneId !== 'string' ||
      (entry.focusTileId !== null && typeof entry.focusTileId !== 'string') ||
      typeof entry.updatedAt !== 'number' ||
      !Number.isFinite(entry.updatedAt)
    ) {
      return null
    }
    return entry
  } catch {
    return null
  }
}

export function isDesktopBootstrapRootLocation(protocol: string, pathname: string): boolean {
  if (pathname === '/' || pathname === '/projects' || pathname === '/projects/') {
    return true
  }
  // Before TanStack owns history, a packaged renderer is still at the physical
  // file path (.../out/renderer/index.html). Treat that as the root bootstrap
  // location so packaged cold launch behaves the same as the dev server root.
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

  if (!snapshot.lastWorkbenchRoute && snapshot.session?.user.id) {
    const legacy = readLegacyLastWorkbenchRoute(snapshot.session.user.id)
    if (legacy) {
      snapshot = { ...snapshot, lastWorkbenchRoute: legacy }
      void window.cozeaBootstrap?.setLastWorkbenchRoute(legacy).catch((error) => {
        console.warn('[DesktopBootstrap] Failed to migrate the last workbench locator.', error)
      })
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
