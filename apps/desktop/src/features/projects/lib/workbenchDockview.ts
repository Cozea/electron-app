import type {
  AddPanelOptions,
  DockviewApi,
  IDockviewPanel,
} from "dockview-react"

import type {
  WorkbenchProjectState,
  WorkbenchSelectionTile,
  WorkbenchTile,
  WorkbenchTileType,
} from "@/stores/useProjectWorkbenchStore"
import type { WorkbenchDockPanelParams } from "@/features/projects/components/workbench/WorkbenchDockRuntimeContext"
import { markCozeaInteractionEnd, markCozeaInteractionStart } from "@/lib/performance/marks"

const RUNTIME_PANEL_CONSTRAINTS = {
  minimumWidth: 320,
  minimumHeight: 220,
} as const

const ASSISTANT_PANEL_CONSTRAINTS = {
  minimumWidth: 320,
  minimumHeight: 240,
} as const

const SELECTION_PANEL_CONSTRAINTS = {
  minimumWidth: 260,
  minimumHeight: 180,
} as const

const CHANGES_PANEL_CONSTRAINTS = {
  minimumWidth: 280,
  minimumHeight: 260,
} as const

const RESERVED_DOCKVIEW_PANEL_IDS = new Set(["cozea-changes-panel"])

export interface WorkbenchTabGroupPreset {
  label: string
  color: string
}

export function resolveTabGroupPreset(component: string): WorkbenchTabGroupPreset {
  switch (component) {
    case "assistantChat":
      return { label: "Agent", color: "agent" }
    case "browser":
    case "devServer":
    case "mobileSimulator":
    case "orgDevApp":
      return { label: "Preview", color: "preview" }
    case "terminal":
      return { label: "Runtime", color: "runtime" }
    case "changes":
      return { label: "Utility", color: "utility" }
    default:
      return { label: "Utility", color: "utility" }
  }
}

function getPanelConstraintsForComponent(
  component: string,
): Pick<AddPanelOptions<WorkbenchDockPanelParams>, "minimumWidth" | "minimumHeight"> {
  switch (component) {
    case "browser":
    case "terminal":
    case "devServer":
    case "mobileSimulator":
    case "orgDevApp":
      return RUNTIME_PANEL_CONSTRAINTS
    case "assistantChat":
      return ASSISTANT_PANEL_CONSTRAINTS
    case "changes":
      return CHANGES_PANEL_CONSTRAINTS
    default:
      return SELECTION_PANEL_CONSTRAINTS
  }
}

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
): "selection" | "browser" | "terminal" | "devServer" | "mobileSimulator" | "assistantChat" | "orgDevApp" {
  switch (type) {
    case "browser":
    case "selection":
    case "terminal":
    case "devServer":
    case "mobileSimulator":
    case "assistantChat":
    case "orgDevApp":
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
    case "orgDevApp":
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
  return getPanelConstraintsForComponent(getDockComponentName(type))
}

/**
 * Re-apply min size after fromJSON / reconcile — serialized layouts can restore
 * panels without our current constraint floors.
 */
export function applyWorkbenchPanelConstraints(api: DockviewApi): void {
  for (const panel of api.panels) {
    const constraints = getPanelConstraintsForComponent(panel.api.component)
    if (panel.api.component === "changes") {
      // Width is also driven by the Changes sidebar effect; never shrink it.
      panel.api.setConstraints({
        minimumWidth: Math.max(panel.minimumWidth ?? 0, constraints.minimumWidth ?? 0),
        minimumHeight: Math.max(panel.minimumHeight ?? 0, constraints.minimumHeight ?? 0),
      })
      continue
    }
    panel.api.setConstraints(constraints)
  }
}

const AUTO_PRESET_TAB_GROUP_LABELS = new Set([
  "Agent",
  "Preview",
  "Runtime",
  "Utility",
])

/**
 * Drop leftover single-panel preset chips from when we auto-assigned tab
 * groups. Real groupings (2+ panels) and custom labels stay; tab context-menu
 * "Group as…" remains the only way to create groups.
 */
export function dissolveOrphanPresetTabGroups(api: DockviewApi): void {
  for (const group of api.groups) {
    // Clear any drop-locks left over from an earlier experiment — dockview's
    // `locked` disables inbound drop overlays and made tile rearranging feel
    // broken on Agent/Dev Server headers.
    if (group.api.locked) {
      group.api.locked = false
    }

    for (const tabGroup of api.getTabGroups({ groupId: group.id })) {
      if (
        tabGroup.panelIds.length <= 1 &&
        AUTO_PRESET_TAB_GROUP_LABELS.has(tabGroup.label)
      ) {
        api.dissolveTabGroup({
          groupId: group.id,
          tabGroupId: tabGroup.id,
        })
      }
    }
  }
}

export function applyWorkbenchDockviewPolicies(api: DockviewApi): void {
  applyWorkbenchPanelConstraints(api)
  dissolveOrphanPresetTabGroups(api)
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
    case "orgDevApp":
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

  applyWorkbenchDockviewPolicies(api)

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
  applyWorkbenchDockviewPolicies(api)
  markCozeaInteractionEnd("workbench-reconcile-panels", startMark, {
    laneId,
    panelCount: api.totalPanels,
    projectId,
    tileCount: project.order.length,
  })
}
