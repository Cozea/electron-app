import type {
  AddPanelOptions,
  DockviewApi,
  IDockviewPanel,
} from "dockview"

import type {
  WorkbenchProjectState,
  WorkbenchSelectionTileEdge,
  WorkbenchSelectionTile,
  WorkbenchTile,
  WorkbenchTileType,
} from "@/stores/useProjectWorkbenchStore"
import type { WorkbenchDockPanelParams } from "@/features/projects/components/workbench/WorkbenchDockPanels"
import type { SeamZone } from "@/features/projects/components/workbench/WorkbenchSeamInsertion"

const SEAM_ZONE_THICKNESS = 24
const SEAM_INTERIOR_TOLERANCE = 4

export const EDGE_TO_DOCK_DIRECTION: Record<
  WorkbenchSelectionTileEdge,
  "left" | "right" | "above" | "below"
> = {
  left: "left",
  right: "right",
  top: "above",
  bottom: "below",
}

export const SEAM_DIRECTION_TO_EDGE: Record<
  SeamZone["direction"],
  WorkbenchSelectionTileEdge
> = {
  left: "left",
  right: "right",
  above: "top",
  below: "bottom",
}

export function computeSeamZones(api: DockviewApi, containerEl: HTMLElement): SeamZone[] {
  const containerRect = containerEl.getBoundingClientRect()
  const halfThickness = SEAM_ZONE_THICKNESS / 2
  const zones: SeamZone[] = []
  const groups = api.groups
    .map((group) => {
      const activePanel = group.activePanel
      const groupEl =
        "element" in group && group.element instanceof HTMLElement ? group.element : null
      if (!activePanel || !groupEl) return null
      const rect = groupEl.getBoundingClientRect()
      return {
        id: group.api.id,
        referenceTileId: activePanel.id,
        rect,
        relLeft: rect.left - containerRect.left,
        relTop: rect.top - containerRect.top,
        relRight: rect.right - containerRect.left,
        relBottom: rect.bottom - containerRect.top,
      }
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))

  const rangesOverlap = (aStart: number, aEnd: number, bStart: number, bEnd: number) =>
    Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > SEAM_INTERIOR_TOLERANCE

  for (let i = 0; i < groups.length; i += 1) {
    const a = groups[i]
    for (let j = i + 1; j < groups.length; j += 1) {
      const b = groups[j]
      const touchesSelectionTile =
        a.referenceTileId.startsWith("selection-") || b.referenceTileId.startsWith("selection-")
      if (touchesSelectionTile) {
        continue
      }

      if (
        Math.abs(a.rect.right - b.rect.left) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.rect.top, a.rect.bottom, b.rect.top, b.rect.bottom)
      ) {
        const seamTop = Math.max(a.relTop, b.relTop)
        const seamBottom = Math.min(a.relBottom, b.relBottom)
        const seamHeight = seamBottom - seamTop
        if (seamHeight > SEAM_INTERIOR_TOLERANCE) {
          zones.push({
            id: `seam-${a.id}-right-${b.id}`,
            referenceTileId: a.referenceTileId,
            direction: "right",
            rect: {
              x: a.relRight - halfThickness,
              y: seamTop,
              width: halfThickness,
              height: seamHeight,
            },
          })
          zones.push({
            id: `seam-${b.id}-left-${a.id}`,
            referenceTileId: b.referenceTileId,
            direction: "left",
            rect: {
              x: b.relLeft,
              y: seamTop,
              width: halfThickness,
              height: seamHeight,
            },
          })
        }
      }

      if (
        Math.abs(b.rect.right - a.rect.left) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.rect.top, a.rect.bottom, b.rect.top, b.rect.bottom)
      ) {
        const seamTop = Math.max(a.relTop, b.relTop)
        const seamBottom = Math.min(a.relBottom, b.relBottom)
        const seamHeight = seamBottom - seamTop
        if (seamHeight > SEAM_INTERIOR_TOLERANCE) {
          zones.push({
            id: `seam-${b.id}-right-${a.id}`,
            referenceTileId: b.referenceTileId,
            direction: "right",
            rect: {
              x: b.relRight - halfThickness,
              y: seamTop,
              width: halfThickness,
              height: seamHeight,
            },
          })
          zones.push({
            id: `seam-${a.id}-left-${b.id}`,
            referenceTileId: a.referenceTileId,
            direction: "left",
            rect: {
              x: a.relLeft,
              y: seamTop,
              width: halfThickness,
              height: seamHeight,
            },
          })
        }
      }

      if (
        Math.abs(a.rect.bottom - b.rect.top) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.rect.left, a.rect.right, b.rect.left, b.rect.right)
      ) {
        const seamLeft = Math.max(a.relLeft, b.relLeft)
        const seamRight = Math.min(a.relRight, b.relRight)
        const seamWidth = seamRight - seamLeft
        if (seamWidth > SEAM_INTERIOR_TOLERANCE) {
          zones.push({
            id: `seam-${a.id}-below-${b.id}`,
            referenceTileId: a.referenceTileId,
            direction: "below",
            rect: {
              x: seamLeft,
              y: a.relBottom - halfThickness,
              width: seamWidth,
              height: halfThickness,
            },
          })
          zones.push({
            id: `seam-${b.id}-above-${a.id}`,
            referenceTileId: b.referenceTileId,
            direction: "above",
            rect: {
              x: seamLeft,
              y: b.relTop,
              width: seamWidth,
              height: halfThickness,
            },
          })
        }
      }

      if (
        Math.abs(b.rect.bottom - a.rect.top) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.rect.left, a.rect.right, b.rect.left, b.rect.right)
      ) {
        const seamLeft = Math.max(a.relLeft, b.relLeft)
        const seamRight = Math.min(a.relRight, b.relRight)
        const seamWidth = seamRight - seamLeft
        if (seamWidth > SEAM_INTERIOR_TOLERANCE) {
          zones.push({
            id: `seam-${b.id}-below-${a.id}`,
            referenceTileId: b.referenceTileId,
            direction: "below",
            rect: {
              x: seamLeft,
              y: b.relBottom - halfThickness,
              width: seamWidth,
              height: halfThickness,
            },
          })
          zones.push({
            id: `seam-${a.id}-above-${b.id}`,
            referenceTileId: a.referenceTileId,
            direction: "above",
            rect: {
              x: seamLeft,
              y: a.relTop,
              width: seamWidth,
              height: halfThickness,
            },
          })
        }
      }
    }
  }

  return zones
}

export function getDockComponentName(
  type: WorkbenchTileType,
): "selection" | "browser" | "terminal" | "devServer" | "assistantChat" {
  switch (type) {
    case "browser":
    case "selection":
    case "terminal":
    case "devServer":
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
