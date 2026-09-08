import {
  buildWorkbenchHref,
  readLastWorkbenchRoute,
} from "@/features/workbench/model/lastWorkbenchRoute"

const SETTINGS_RETURN_ROUTE_STORAGE_KEY = "cozea.settingsReturnRoute.v1"

let inMemoryReturnRoute: string | null = null

export function isSettingsModeRoute(pathname: string | null | undefined): boolean {
  if (!pathname) return false
  return (
    pathname.startsWith("/projects/settings/") ||
    pathname.startsWith("/settings/") ||
    pathname.startsWith("/projects/workspace/") ||
    pathname.startsWith("/projects/teams") ||
    pathname === "/settings"
  )
}

function getSessionStorage(): Storage | null {
  if (typeof window !== "undefined" && window.sessionStorage) {
    return window.sessionStorage
  }
  if (typeof globalThis !== "undefined" && globalThis.sessionStorage) {
    return globalThis.sessionStorage
  }
  return null
}

export function saveLastAppRoute(route: string | null | undefined): void {
  if (!route) return
  const pathname = route.split("?")[0]?.split("#")[0] ?? route
  if (isSettingsModeRoute(pathname) || pathname === "/") {
    return
  }

  inMemoryReturnRoute = route

  const storage = getSessionStorage()
  if (storage) {
    try {
      storage.setItem(SETTINGS_RETURN_ROUTE_STORAGE_KEY, route)
    } catch {
      // ignore storage quota or access errors
    }
  }
}

export function getLastAppRoute(fallbackWorkspaceSelectionId?: string | null): string {
  if (inMemoryReturnRoute) {
    const pathname = inMemoryReturnRoute.split("?")[0]?.split("#")[0] ?? inMemoryReturnRoute
    if (!isSettingsModeRoute(pathname) && pathname !== "/") {
      return inMemoryReturnRoute
    }
  }

  const storage = getSessionStorage()
  if (storage) {
    try {
      const stored = storage.getItem(SETTINGS_RETURN_ROUTE_STORAGE_KEY)
      if (stored) {
        const pathname = stored.split("?")[0]?.split("#")[0] ?? stored
        if (!isSettingsModeRoute(pathname) && pathname !== "/") {
          return stored
        }
      }
    } catch {
      // ignore storage errors
    }
  }

  const lastWorkbench = readLastWorkbenchRoute(fallbackWorkspaceSelectionId)
  if (lastWorkbench?.projectId) {
    return buildWorkbenchHref(lastWorkbench.projectId, lastWorkbench.laneId, {
      focusTileId: lastWorkbench.focusTileId,
    })
  }

  return "/projects"
}

export function clearLastAppRoute(): void {
  inMemoryReturnRoute = null
  const storage = getSessionStorage()
  if (storage) {
    try {
      storage.removeItem(SETTINGS_RETURN_ROUTE_STORAGE_KEY)
    } catch {
      // ignore
    }
  }
}
