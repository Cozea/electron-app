import type {
  AddPanelOptions,
  DockviewApi,
  IDockviewPanel,
} from "dockview"

import type {
  WorkbenchProjectState,
  WorkbenchSelectionTile,
  WorkbenchTile,
  WorkbenchTileType,
} from "@/stores/useProjectWorkbenchStore"
import type { WorkbenchDockPanelParams } from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext"

export function getDockComponentName(
  type: WorkbenchTileType,
): "selection" | "browser" | "terminal" | "devServer" | "mobileSimulator" | "assistantChat" {
  switch (type) {
    case "browser":
    case "selection":
    case "terminal":
    case "devServer":
    case "mobileSimulator":
    case "assistantChat":
      return type
    default:
      return "assistantChat"
  }
}

export function getPanelParams(
  projectId: string,
  laneId: string,
  tileId: string,
): WorkbenchDockPanelParams {
  return { projectId, laneId, tileId }
}

export function isObsoleteWorkbenchTile(tile: WorkbenchTile | undefined | null): boolean {
  return !tile || tile.type === "changes" || tile.type === "tasks"
}

export function isSelectionTile(
  tile: WorkbenchTile | undefined | null,
): tile is WorkbenchSelectionTile {
  return Boolean(tile && tile.type === "selection")
}

export function buildAddPanelOptions(
  api: DockviewApi,
  tile: WorkbenchTile,
  projectId: string,
  laneId: string,
): AddPanelOptions<WorkbenchDockPanelParams> {
  const base: AddPanelOptions<WorkbenchDockPanelParams> = {
    id: tile.id,
    title: tile.title,
    component: getDockComponentName(tile.type),
    params: getPanelParams(projectId, laneId, tile.id),
  }

  if (api.totalPanels === 0) {
    return base
  }

  const activePanel = api.activePanel
  switch (tile.type) {
    case "browser":
    case "devServer":
    case "mobileSimulator":
    case "terminal":
      if (activePanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: activePanel.id,
            direction: "right",
          },
        }
      }
      return base
    case "assistantChat":
      if (activePanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: activePanel.id,
            direction: "right",
          },
        }
      }
      break
    default:
      break
  }

  if (activePanel) {
    return {
      ...base,
      floating: false,
      position: {
        referencePanel: activePanel.id,
        direction: "right",
      },
    }
  }

  return base
}

export function buildDefaultDockview(
  api: DockviewApi,
  project: WorkbenchProjectState,
  projectId: string,
  laneId: string,
) {
  api.clear()

  for (const tileId of project.order) {
    const tile = project.tiles[tileId]
    if (isObsoleteWorkbenchTile(tile)) continue
    api.addPanel(buildAddPanelOptions(api, tile, projectId, laneId))
  }
}

export function syncPanelTitles(api: DockviewApi, project: WorkbenchProjectState) {
  for (const tileId of project.order) {
    const tile = project.tiles[tileId]
    const panel = api.getPanel(tileId)
    if (isObsoleteWorkbenchTile(tile) || !panel) continue
    if (panel.api.title !== tile.title) {
      panel.api.setTitle(tile.title)
    }
  }
}

export function reconcilePanels(
  api: DockviewApi,
  project: WorkbenchProjectState,
  projectId: string,
  laneId: string,
  addPanel: (options: AddPanelOptions<WorkbenchDockPanelParams>) => IDockviewPanel | undefined = (
    options,
  ) => api.addPanel(options),
  preservePanelIds: ReadonlySet<string> = new Set<string>(),
) {
  const nextTileIds = new Set(project.order)

  for (const panel of api.panels) {
    if (!nextTileIds.has(panel.id) && !preservePanelIds.has(panel.id)) {
      api.removePanel(panel)
    }
  }

  for (const tileId of project.order) {
    const tile = project.tiles[tileId]
    if (isObsoleteWorkbenchTile(tile)) continue
    const existingPanel = api.getPanel(tileId)
    if (existingPanel) {
      if (existingPanel.api.title !== tile.title) {
        existingPanel.api.setTitle(tile.title)
      }
      continue
    }
    addPanel(buildAddPanelOptions(api, tile, projectId, laneId))
  }

  syncPanelTitles(api, project)
}
