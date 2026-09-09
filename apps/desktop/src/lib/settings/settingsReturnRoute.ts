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
  if (typeof window !== "undefined" && window.sessionStorage) return window.sessionStorage
  if (typeof globalThis !== "undefined" && globalThis.sessionStorage) return globalThis.sessionStorage
  return null
}

export function saveLastAppRoute(route: string | null | undefined): void {
  if (!route) return
  const pathname = route.split("?")[0]?.split("#")[0] ?? route
  if (isSettingsModeRoute(pathname) || pathname === "/") return

  inMemoryReturnRoute = route
  try {
    getSessionStorage()?.setItem(SETTINGS_RETURN_ROUTE_STORAGE_KEY, route)
  } catch {
    // The in-memory route remains authoritative for this window.
  }
}

export function getLastAppRoute(fallbackWorkspaceSelectionId?: string | null): string {
  if (inMemoryReturnRoute) return inMemoryReturnRoute

  try {
    const stored = getSessionStorage()?.getItem(SETTINGS_RETURN_ROUTE_STORAGE_KEY)
    if (stored) {
      const pathname = stored.split("?")[0]?.split("#")[0] ?? stored
      if (!isSettingsModeRoute(pathname) && pathname !== "/") return stored
    }
  } catch {
    // Fall through to the durable workbench locator.
  }

  const lastWorkbench = readLastWorkbenchRoute(fallbackWorkspaceSelectionId)
  return lastWorkbench?.projectId
    ? buildWorkbenchHref(lastWorkbench.projectId, lastWorkbench.laneId, {
        focusTileId: lastWorkbench.focusTileId,
      })
    : "/projects"
}

export function clearLastAppRoute(): void {
  inMemoryReturnRoute = null
  try {
    getSessionStorage()?.removeItem(SETTINGS_RETURN_ROUTE_STORAGE_KEY)
  } catch {
    // Nothing else to clear.
  }
}
