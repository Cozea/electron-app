import { buildProjectPath } from "@/contexts/project/projectRoutes"

const LAST_WORKBENCH_ROUTE_STORAGE_KEY = "cozea.lastWorkbenchRoute.v1"

export interface LastWorkbenchRouteEntry {
  workspaceSelectionId: string
  projectId: string
  laneId: string
  focusTileId: string | null
  updatedAt: number
}

interface PersistedLastWorkbenchRouteState {
  entriesByWorkspaceSelectionId: Record<string, LastWorkbenchRouteEntry>
}

function canUseStorage(): boolean {
  return typeof window !== "undefined" && typeof window.localStorage !== "undefined"
}

function readPersistedState(): PersistedLastWorkbenchRouteState {
  if (!canUseStorage()) {
    return { entriesByWorkspaceSelectionId: {} }
  }

  try {
    const raw = window.localStorage.getItem(LAST_WORKBENCH_ROUTE_STORAGE_KEY)
    if (!raw) {
      return { entriesByWorkspaceSelectionId: {} }
    }

    const parsed = JSON.parse(raw) as PersistedLastWorkbenchRouteState | null
    if (!parsed || typeof parsed !== "object") {
      return { entriesByWorkspaceSelectionId: {} }
    }

    return {
      entriesByWorkspaceSelectionId:
        parsed.entriesByWorkspaceSelectionId && typeof parsed.entriesByWorkspaceSelectionId === "object"
          ? parsed.entriesByWorkspaceSelectionId
          : {},
    }
  } catch {
    return { entriesByWorkspaceSelectionId: {} }
  }
}

function writePersistedState(state: PersistedLastWorkbenchRouteState) {
  if (!canUseStorage()) {
    return
  }

  try {
    window.localStorage.setItem(LAST_WORKBENCH_ROUTE_STORAGE_KEY, JSON.stringify(state))
  } catch {
    // ignore storage write failures
  }
}

export function buildWorkbenchHref(
  projectId: string,
  laneId?: string | null,
  options?: { openTile?: "assistantChat" | "terminal"; focusTileId?: string | null },
): string {
  const params = new URLSearchParams()
  if (laneId) {
    params.set("lane", laneId)
  }
  if (options?.openTile) {
    params.set("openTile", options.openTile)
  }
  if (options?.focusTileId) {
    params.set("focusTile", options.focusTileId)
  }
  const basePath = `${buildProjectPath(projectId)}/workbench`
  const search = params.toString()
  return search ? `${basePath}?${search}` : basePath
}

export function readLastWorkbenchRoute(
  workspaceSelectionId: string | null | undefined,
): LastWorkbenchRouteEntry | null {
  if (!workspaceSelectionId) {
    return null
  }

  const state = readPersistedState()
  const entry = state.entriesByWorkspaceSelectionId[workspaceSelectionId]
  if (!entry) {
    return null
  }

  if (
    typeof entry.projectId !== "string" ||
    typeof entry.laneId !== "string" ||
    (entry.focusTileId !== null && typeof entry.focusTileId !== "string")
  ) {
    return null
  }

  return entry
}

export function writeLastWorkbenchRoute(entry: LastWorkbenchRouteEntry) {
  if (!entry.workspaceSelectionId) {
    return
  }

  const state = readPersistedState()
  writePersistedState({
    entriesByWorkspaceSelectionId: {
      ...state.entriesByWorkspaceSelectionId,
      [entry.workspaceSelectionId]: entry,
    },
  })
  void window.cozeaBootstrap?.setLastWorkbenchRoute(entry).catch((error) => {
    console.warn('[DesktopBootstrap] Failed to persist the last workbench locator.', error)
  })
}

export function clearLastWorkbenchRoute(workspaceSelectionId: string | null | undefined) {
  if (!workspaceSelectionId) {
    return
  }

  const state = readPersistedState()
  if (state.entriesByWorkspaceSelectionId[workspaceSelectionId]) {
    const { [workspaceSelectionId]: _removed, ...remainingEntries } = state.entriesByWorkspaceSelectionId
    writePersistedState({ entriesByWorkspaceSelectionId: remainingEntries })
  }

  void window.cozeaBootstrap?.clearLastWorkbenchRoute(workspaceSelectionId).catch((error) => {
    console.warn('[DesktopBootstrap] Failed to clear the last workbench locator.', error)
  })
}

export function clearLastWorkbenchRoutesForProject(projectId: string): void {
  const normalizedProjectId = projectId.trim()
  if (!normalizedProjectId) return

  const state = readPersistedState()
  const entriesByWorkspaceSelectionId = Object.fromEntries(
    Object.entries(state.entriesByWorkspaceSelectionId).filter(
      ([, entry]) => entry.projectId !== normalizedProjectId,
    ),
  )
  if (
    Object.keys(entriesByWorkspaceSelectionId).length !==
    Object.keys(state.entriesByWorkspaceSelectionId).length
  ) {
    writePersistedState({ entriesByWorkspaceSelectionId })
  }

  void window.cozeaBootstrap?.clearLastWorkbenchRoutesForProject(normalizedProjectId).catch((error) => {
    console.warn('[DesktopBootstrap] Failed to clear the project workbench locator.', error)
  })
}
