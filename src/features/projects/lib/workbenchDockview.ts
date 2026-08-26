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
import { markCozeaInteractionEnd, markCozeaInteractionStart } from "@/lib/performance/marks"

const RUNTIME_PANEL_CONSTRAINTS = {
  minimumWidth: 280,
  minimumHeight: 180,
} as const

const ASSISTANT_PANEL_CONSTRAINTS = {
  minimumWidth: 320,
  minimumHeight: 240,
} as const

const SELECTION_PANEL_CONSTRAINTS = {
  minimumWidth: 260,
  minimumHeight: 180,
} as const

const RESERVED_DOCKVIEW_PANEL_IDS = new Set(["cozea-changes-panel"])

function getPanelPlacementReference(api: DockviewApi): IDockviewPanel | undefined {
  if (api.activePanel && !RESERVED_DOCKVIEW_PANEL_IDS.has(api.activePanel.id)) {
    return api.activePanel
  }

  return api.panels.find((panel) => !RESERVED_DOCKVIEW_PANEL_IDS.has(panel.id))
}

function placePanelLeftOfChanges(
  base: AddPanelOptions<WorkbenchDockPanelParams>,
  changesPanel: IDockviewPanel | undefined,
): AddPanelOptions<WorkbenchDockPanelParams> {
  if (!changesPanel) return base

  return {
    ...base,
    floating: false,
    position: {
      referencePanel: changesPanel.id,
      direction: "left",
    },
  }
}

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

export function getPanelRendererForTile(
  type: WorkbenchTileType,
): "always" | "onlyWhenVisible" {
  switch (type) {
    case "browser":
    case "devServer":
    case "mobileSimulator":
    case "terminal":
      return "always"
    case "assistantChat":
    case "selection":
    case "tasks":
    default:
      return "onlyWhenVisible"
  }
}

export function getPanelConstraintsForTile(
  type: WorkbenchTileType,
): Pick<AddPanelOptions<WorkbenchDockPanelParams>, "minimumWidth" | "minimumHeight"> {
  switch (type) {
    case "browser":
    case "terminal":
    case "devServer":
    case "mobileSimulator":
      return RUNTIME_PANEL_CONSTRAINTS
    case "assistantChat":
      return ASSISTANT_PANEL_CONSTRAINTS
    case "selection":
    case "tasks":
    default:
      return SELECTION_PANEL_CONSTRAINTS
  }
}

export function isObsoleteWorkbenchTile(tile: WorkbenchTile | undefined | null): boolean {
  return !tile || tile.type === "tasks"
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
    renderer: getPanelRendererForTile(tile.type),
    ...getPanelConstraintsForTile(tile.type),
  }

  if (api.totalPanels === 0) {
    return base
  }

  const referencePanel = getPanelPlacementReference(api)
  const changesPanel = api.getPanel("cozea-changes-panel")

  switch (tile.type) {
    case "browser":
    case "devServer":
    case "mobileSimulator":
    case "terminal":
      if (referencePanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: referencePanel.id,
            direction: "right",
          },
        }
      }
      return placePanelLeftOfChanges(base, changesPanel)
    case "assistantChat":
      if (referencePanel) {
        return {
          ...base,
          floating: false,
          position: {
            referencePanel: referencePanel.id,
            direction: "right",
          },
        }
      }
      break
    default:
      break
  }

  if (referencePanel) {
    return {
      ...base,
      floating: false,
      position: {
        referencePanel: referencePanel.id,
        direction: "right",
      },
    }
  }

  return placePanelLeftOfChanges(base, changesPanel)
}

export function buildDefaultDockview(
  api: DockviewApi,
  project: WorkbenchProjectState,
  projectId: string,
  laneId: string,
) {
  const startMark = markCozeaInteractionStart("workbench-restore-tiles", {
    laneId,
    projectId,
    tileCount: project.order.length,
  })

  api.clear()

  for (const tileId of project.order) {
    const tile = project.tiles[tileId]
    if (isObsoleteWorkbenchTile(tile)) continue
    api.addPanel(buildAddPanelOptions(api, tile, projectId, laneId))
  }

  markCozeaInteractionEnd("workbench-restore-tiles", startMark, {
    laneId,
    panelCount: api.totalPanels,
    projectId,
    tileCount: project.order.length,
  })
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
  const startMark = markCozeaInteractionStart("workbench-reconcile-panels", {
    laneId,
    panelCount: api.totalPanels,
    projectId,
    tileCount: project.order.length,
  })
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
  markCozeaInteractionEnd("workbench-reconcile-panels", startMark, {
    laneId,
    panelCount: api.totalPanels,
    projectId,
    tileCount: project.order.length,
  })
}
