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
      typeof entry.projectId !== 'string' ||
      typeof entry.laneId !== 'string' ||
      (entry.focusTileId !== null && typeof entry.focusTileId !== 'string')
    ) {
      return null
    }
    return entry
  } catch {
    return null
  }
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

  const pathname = window.location.pathname
  if (pathname !== '/' && pathname !== '/projects' && pathname !== '/projects/') return

  const params = new URLSearchParams()
  if (locator.laneId) params.set('lane', locator.laneId)
  if (locator.focusTileId) params.set('focusTile', locator.focusTileId)
  const query = params.toString()
  const path = `/projects/p/${encodeURIComponent(locator.projectId)}/workbench${query ? `?${query}` : ''}`
  window.history.replaceState(window.history.state, '', path)
}
