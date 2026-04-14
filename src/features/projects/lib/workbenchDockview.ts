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

const SEAM_ZONE_THICKNESS = 24
const SEAM_INTERIOR_TOLERANCE = 4
const OUTER_EDGE_TRIGGER_THICKNESS = 14
const SEAM_TRIGGER_SEGMENT_LENGTH = 64
const JUNCTION_TRIGGER_SIZE = 26

export type WorkbenchInsertionEdge = WorkbenchSelectionTileEdge
export type WorkbenchInsertionScope = "local" | "full-span"
export type WorkbenchSeamDirection = "left" | "right" | "above" | "below"
export type WorkbenchInsertionDockDirection = "left" | "right" | "above" | "below"
export type WorkbenchSeamAxis = "vertical" | "horizontal"

export interface WorkbenchRect {
  x: number
  y: number
  width: number
  height: number
}

export interface WorkbenchAnchorPoint {
  x: number
  y: number
}

export interface WorkbenchEdgeTarget {
  id: string
  kind: "edge"
  referenceTileId: string
  edge: WorkbenchInsertionEdge
  triggerRect: WorkbenchRect
  anchorPoint: WorkbenchAnchorPoint
  scope: WorkbenchInsertionScope
}

export interface WorkbenchSeamTarget {
  id: string
  kind: "seam"
  referenceGroupId: string
  referenceTileId: string
  adjacentTileId: string
  direction: WorkbenchSeamDirection
  edge: WorkbenchSelectionTileEdge
  triggerRect: WorkbenchRect
  anchorPoint: WorkbenchAnchorPoint
  scope: WorkbenchInsertionScope
  spanAxis: WorkbenchSeamAxis
  spanPosition: number
  spanStart: number
  spanEnd: number
}

export interface WorkbenchJunctionTarget {
  id: string
  kind: "junction"
  referenceGroupId: string
  referenceTileId: string
  adjacentTileId: string | null
  edge: WorkbenchInsertionEdge
  triggerRect: WorkbenchRect
  anchorPoint: WorkbenchAnchorPoint
  scope: "full-span"
}

export type WorkbenchInsertionTarget =
  | WorkbenchEdgeTarget
  | WorkbenchSeamTarget
  | WorkbenchJunctionTarget

export interface WorkbenchInsertionIntent {
  targetId: string
  targetKind: WorkbenchInsertionTarget["kind"]
  previewMode: Extract<
    WorkbenchSelectionTile["mode"],
    "edgePreview" | "seamPreview" | "junctionPreview"
  >
  scope: WorkbenchInsertionScope
  edge: WorkbenchSelectionTileEdge
  referenceTileId: string
  referenceGroupId: string | null
  adjacentTileId: string | null
  dockDirection: WorkbenchInsertionDockDirection
}

export interface WorkbenchContainerGeometry {
  width: number
  height: number
}

export interface WorkbenchPanelGeometry {
  groupId: string
  referenceTileId: string
  relLeft: number
  relTop: number
  relRight: number
  relBottom: number
}

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
  WorkbenchSeamDirection,
  WorkbenchSelectionTileEdge
> = {
  left: "left",
  right: "right",
  above: "top",
  below: "bottom",
}

function collectVisibleWorkbenchPanelGeometry(
  api: DockviewApi,
  containerEl: HTMLElement,
): WorkbenchPanelGeometry[] {
  const containerRect = containerEl.getBoundingClientRect()
  return api.groups
    .map((group) => {
      const activePanel = group.activePanel
      const groupEl =
        "element" in group && group.element instanceof HTMLElement ? group.element : null
      if (!activePanel || !groupEl) return null
      const rect = groupEl.getBoundingClientRect()
      return {
        groupId: group.api.id,
        referenceTileId: activePanel.id,
        relLeft: rect.left - containerRect.left,
        relTop: rect.top - containerRect.top,
        relRight: rect.right - containerRect.left,
        relBottom: rect.bottom - containerRect.top,
      }
    })
    .filter((value): value is NonNullable<typeof value> => Boolean(value))
}

function rangesOverlap(aStart: number, aEnd: number, bStart: number, bEnd: number) {
  return Math.min(aEnd, bEnd) - Math.max(aStart, bStart) > SEAM_INTERIOR_TOLERANCE
}

function spansFullHeight(
  geometry: Pick<WorkbenchPanelGeometry, "relTop" | "relBottom">,
  containerHeight: number,
) {
  return (
    geometry.relTop <= SEAM_INTERIOR_TOLERANCE &&
    containerHeight - geometry.relBottom <= SEAM_INTERIOR_TOLERANCE
  )
}

function spansFullWidth(
  geometry: Pick<WorkbenchPanelGeometry, "relLeft" | "relRight">,
  containerWidth: number,
) {
  return (
    geometry.relLeft <= SEAM_INTERIOR_TOLERANCE &&
    containerWidth - geometry.relRight <= SEAM_INTERIOR_TOLERANCE
  )
}

export function computeWorkbenchEdgeTargetsFromGeometry(
  geometries: readonly WorkbenchPanelGeometry[],
  container: WorkbenchContainerGeometry,
): WorkbenchEdgeTarget[] {
  const containerWidth = container.width
  const containerHeight = container.height
  const targets: WorkbenchEdgeTarget[] = []

  for (const geometry of geometries) {
    if (geometry.referenceTileId.startsWith("selection-")) {
      continue
    }

    const isFullHeight = spansFullHeight(geometry, containerHeight)
    const isFullWidth = spansFullWidth(geometry, containerWidth)
    const centerX = geometry.relLeft + (geometry.relRight - geometry.relLeft) / 2
    const centerY = geometry.relTop + (geometry.relBottom - geometry.relTop) / 2

    if (geometry.relLeft <= SEAM_INTERIOR_TOLERANCE) {
      targets.push({
        id: `edge-${geometry.referenceTileId}-left`,
        kind: "edge",
        referenceTileId: geometry.referenceTileId,
        edge: "left",
        triggerRect: {
          x: 0,
          y: geometry.relTop,
          width: OUTER_EDGE_TRIGGER_THICKNESS,
          height: geometry.relBottom - geometry.relTop,
        },
        anchorPoint: { x: 0, y: centerY },
        scope: isFullHeight ? "full-span" : "local",
      })
    }

    if (containerWidth - geometry.relRight <= SEAM_INTERIOR_TOLERANCE) {
      targets.push({
        id: `edge-${geometry.referenceTileId}-right`,
        kind: "edge",
        referenceTileId: geometry.referenceTileId,
        edge: "right",
        triggerRect: {
          x: Math.max(0, containerWidth - OUTER_EDGE_TRIGGER_THICKNESS),
          y: geometry.relTop,
          width: OUTER_EDGE_TRIGGER_THICKNESS,
          height: geometry.relBottom - geometry.relTop,
        },
        anchorPoint: { x: containerWidth, y: centerY },
        scope: isFullHeight ? "full-span" : "local",
      })
    }

    if (geometry.relTop <= SEAM_INTERIOR_TOLERANCE) {
      targets.push({
        id: `edge-${geometry.referenceTileId}-top`,
        kind: "edge",
        referenceTileId: geometry.referenceTileId,
        edge: "top",
        triggerRect: {
          x: geometry.relLeft,
          y: 0,
          width: geometry.relRight - geometry.relLeft,
          height: OUTER_EDGE_TRIGGER_THICKNESS,
        },
        anchorPoint: { x: centerX, y: 0 },
        scope: isFullWidth ? "full-span" : "local",
      })
    }

    if (containerHeight - geometry.relBottom <= SEAM_INTERIOR_TOLERANCE) {
      targets.push({
        id: `edge-${geometry.referenceTileId}-bottom`,
        kind: "edge",
        referenceTileId: geometry.referenceTileId,
        edge: "bottom",
        triggerRect: {
          x: geometry.relLeft,
          y: Math.max(0, containerHeight - OUTER_EDGE_TRIGGER_THICKNESS),
          width: geometry.relRight - geometry.relLeft,
          height: OUTER_EDGE_TRIGGER_THICKNESS,
        },
        anchorPoint: { x: centerX, y: containerHeight },
        scope: isFullWidth ? "full-span" : "local",
      })
    }
  }

  return targets
}

export function computeWorkbenchEdgeTargets(
  api: DockviewApi,
  containerEl: HTMLElement,
): WorkbenchEdgeTarget[] {
  const geometries = collectVisibleWorkbenchPanelGeometry(api, containerEl)
  return computeWorkbenchEdgeTargetsFromGeometry(geometries, {
    width: containerEl.getBoundingClientRect().width,
    height: containerEl.getBoundingClientRect().height,
  })
}

export function computeWorkbenchSeamTargetsFromGeometry(
  groups: readonly WorkbenchPanelGeometry[],
  container: WorkbenchContainerGeometry,
): WorkbenchSeamTarget[] {
  const containerWidth = container.width
  const containerHeight = container.height
  const halfThickness = SEAM_ZONE_THICKNESS / 2
  const zones: WorkbenchSeamTarget[] = []

  const buildVerticalTriggerRect = (
    seamX: number,
    seamTop: number,
    seamHeight: number,
    direction: "left" | "right",
  ): WorkbenchRect => {
    const height = Math.min(seamHeight, SEAM_TRIGGER_SEGMENT_LENGTH)
    return {
      x: direction === "right" ? seamX - halfThickness : seamX,
      y: seamTop + (seamHeight - height) / 2,
      width: halfThickness,
      height,
    }
  }

  const buildHorizontalTriggerRect = (
    seamLeft: number,
    seamY: number,
    seamWidth: number,
    direction: "above" | "below",
  ): WorkbenchRect => {
    const width = Math.min(seamWidth, SEAM_TRIGGER_SEGMENT_LENGTH)
    return {
      x: seamLeft + (seamWidth - width) / 2,
      y: direction === "below" ? seamY - halfThickness : seamY,
      width,
      height: halfThickness,
    }
  }

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
        Math.abs(a.relRight - b.relLeft) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.relTop, a.relBottom, b.relTop, b.relBottom)
      ) {
        const seamTop = Math.max(a.relTop, b.relTop)
        const seamBottom = Math.min(a.relBottom, b.relBottom)
        const seamHeight = seamBottom - seamTop
        if (seamHeight > SEAM_INTERIOR_TOLERANCE) {
          const anchorY = seamTop + seamHeight / 2
          const seamX = a.relRight
          const scope: WorkbenchInsertionScope =
            seamTop <= SEAM_INTERIOR_TOLERANCE &&
            containerHeight - seamBottom <= SEAM_INTERIOR_TOLERANCE
              ? "full-span"
              : "local"
          zones.push({
            id: `seam-${a.groupId}-right-${b.groupId}`,
            referenceGroupId: a.groupId,
            referenceTileId: a.referenceTileId,
            adjacentTileId: b.referenceTileId,
            kind: "seam",
            direction: "right",
            edge: "right",
            triggerRect: buildVerticalTriggerRect(seamX, seamTop, seamHeight, "right"),
            anchorPoint: { x: seamX, y: anchorY },
            scope,
            spanAxis: "vertical",
            spanPosition: seamX,
            spanStart: seamTop,
            spanEnd: seamBottom,
          })
          zones.push({
            id: `seam-${b.groupId}-left-${a.groupId}`,
            referenceGroupId: b.groupId,
            referenceTileId: b.referenceTileId,
            adjacentTileId: a.referenceTileId,
            kind: "seam",
            direction: "left",
            edge: "left",
            triggerRect: buildVerticalTriggerRect(b.relLeft, seamTop, seamHeight, "left"),
            anchorPoint: { x: b.relLeft, y: anchorY },
            scope,
            spanAxis: "vertical",
            spanPosition: b.relLeft,
            spanStart: seamTop,
            spanEnd: seamBottom,
          })
        }
      }

      if (
        Math.abs(b.relRight - a.relLeft) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.relTop, a.relBottom, b.relTop, b.relBottom)
      ) {
        const seamTop = Math.max(a.relTop, b.relTop)
        const seamBottom = Math.min(a.relBottom, b.relBottom)
        const seamHeight = seamBottom - seamTop
        if (seamHeight > SEAM_INTERIOR_TOLERANCE) {
          const anchorY = seamTop + seamHeight / 2
          const seamX = b.relRight
          const scope: WorkbenchInsertionScope =
            seamTop <= SEAM_INTERIOR_TOLERANCE &&
            containerHeight - seamBottom <= SEAM_INTERIOR_TOLERANCE
              ? "full-span"
              : "local"
          zones.push({
            id: `seam-${b.groupId}-right-${a.groupId}`,
            referenceGroupId: b.groupId,
            referenceTileId: b.referenceTileId,
            adjacentTileId: a.referenceTileId,
            kind: "seam",
            direction: "right",
            edge: "right",
            triggerRect: buildVerticalTriggerRect(seamX, seamTop, seamHeight, "right"),
            anchorPoint: { x: seamX, y: anchorY },
            scope,
            spanAxis: "vertical",
            spanPosition: seamX,
            spanStart: seamTop,
            spanEnd: seamBottom,
          })
          zones.push({
            id: `seam-${a.groupId}-left-${b.groupId}`,
            referenceGroupId: a.groupId,
            referenceTileId: a.referenceTileId,
            adjacentTileId: b.referenceTileId,
            kind: "seam",
            direction: "left",
            edge: "left",
            triggerRect: buildVerticalTriggerRect(a.relLeft, seamTop, seamHeight, "left"),
            anchorPoint: { x: a.relLeft, y: anchorY },
            scope,
            spanAxis: "vertical",
            spanPosition: a.relLeft,
            spanStart: seamTop,
            spanEnd: seamBottom,
          })
        }
      }

      if (
        Math.abs(a.relBottom - b.relTop) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.relLeft, a.relRight, b.relLeft, b.relRight)
      ) {
        const seamLeft = Math.max(a.relLeft, b.relLeft)
        const seamRight = Math.min(a.relRight, b.relRight)
        const seamWidth = seamRight - seamLeft
        if (seamWidth > SEAM_INTERIOR_TOLERANCE) {
          const anchorX = seamLeft + seamWidth / 2
          const seamY = a.relBottom
          const scope: WorkbenchInsertionScope =
            seamLeft <= SEAM_INTERIOR_TOLERANCE &&
            containerWidth - seamRight <= SEAM_INTERIOR_TOLERANCE
              ? "full-span"
              : "local"
          zones.push({
            id: `seam-${a.groupId}-below-${b.groupId}`,
            referenceGroupId: a.groupId,
            referenceTileId: a.referenceTileId,
            adjacentTileId: b.referenceTileId,
            kind: "seam",
            direction: "below",
            edge: "bottom",
            triggerRect: buildHorizontalTriggerRect(seamLeft, seamY, seamWidth, "below"),
            anchorPoint: { x: anchorX, y: seamY },
            scope,
            spanAxis: "horizontal",
            spanPosition: seamY,
            spanStart: seamLeft,
            spanEnd: seamRight,
          })
          zones.push({
            id: `seam-${b.groupId}-above-${a.groupId}`,
            referenceGroupId: b.groupId,
            referenceTileId: b.referenceTileId,
            adjacentTileId: a.referenceTileId,
            kind: "seam",
            direction: "above",
            edge: "top",
            triggerRect: buildHorizontalTriggerRect(seamLeft, b.relTop, seamWidth, "above"),
            anchorPoint: { x: anchorX, y: b.relTop },
            scope,
            spanAxis: "horizontal",
            spanPosition: b.relTop,
            spanStart: seamLeft,
            spanEnd: seamRight,
          })
        }
      }

      if (
        Math.abs(b.relBottom - a.relTop) <= SEAM_INTERIOR_TOLERANCE &&
        rangesOverlap(a.relLeft, a.relRight, b.relLeft, b.relRight)
      ) {
        const seamLeft = Math.max(a.relLeft, b.relLeft)
        const seamRight = Math.min(a.relRight, b.relRight)
        const seamWidth = seamRight - seamLeft
        if (seamWidth > SEAM_INTERIOR_TOLERANCE) {
          const anchorX = seamLeft + seamWidth / 2
          const seamY = b.relBottom
          const scope: WorkbenchInsertionScope =
            seamLeft <= SEAM_INTERIOR_TOLERANCE &&
            containerWidth - seamRight <= SEAM_INTERIOR_TOLERANCE
              ? "full-span"
              : "local"
          zones.push({
            id: `seam-${b.groupId}-below-${a.groupId}`,
            referenceGroupId: b.groupId,
            referenceTileId: b.referenceTileId,
            adjacentTileId: a.referenceTileId,
            kind: "seam",
            direction: "below",
            edge: "bottom",
            triggerRect: buildHorizontalTriggerRect(seamLeft, seamY, seamWidth, "below"),
            anchorPoint: { x: anchorX, y: seamY },
            scope,
            spanAxis: "horizontal",
            spanPosition: seamY,
            spanStart: seamLeft,
            spanEnd: seamRight,
          })
          zones.push({
            id: `seam-${a.groupId}-above-${b.groupId}`,
            referenceGroupId: a.groupId,
            referenceTileId: a.referenceTileId,
            adjacentTileId: b.referenceTileId,
            kind: "seam",
            direction: "above",
            edge: "top",
            triggerRect: buildHorizontalTriggerRect(seamLeft, a.relTop, seamWidth, "above"),
            anchorPoint: { x: anchorX, y: a.relTop },
            scope,
            spanAxis: "horizontal",
            spanPosition: a.relTop,
            spanStart: seamLeft,
            spanEnd: seamRight,
          })
        }
      }
    }
  }

  return zones
}

export function computeWorkbenchSeamTargets(
  api: DockviewApi,
  containerEl: HTMLElement,
): WorkbenchSeamTarget[] {
  const geometries = collectVisibleWorkbenchPanelGeometry(api, containerEl)
  return computeWorkbenchSeamTargetsFromGeometry(geometries, {
    width: containerEl.getBoundingClientRect().width,
    height: containerEl.getBoundingClientRect().height,
  })
}

function buildJunctionTriggerRect(
  point: WorkbenchAnchorPoint,
  edge: WorkbenchInsertionEdge,
): WorkbenchRect {
  switch (edge) {
    case "left":
      return {
        x: point.x,
        y: point.y - JUNCTION_TRIGGER_SIZE / 2,
        width: JUNCTION_TRIGGER_SIZE,
        height: JUNCTION_TRIGGER_SIZE,
      }
    case "right":
      return {
        x: point.x - JUNCTION_TRIGGER_SIZE,
        y: point.y - JUNCTION_TRIGGER_SIZE / 2,
        width: JUNCTION_TRIGGER_SIZE,
        height: JUNCTION_TRIGGER_SIZE,
      }
    case "top":
      return {
        x: point.x - JUNCTION_TRIGGER_SIZE / 2,
        y: point.y,
        width: JUNCTION_TRIGGER_SIZE,
        height: JUNCTION_TRIGGER_SIZE,
      }
    case "bottom":
      return {
        x: point.x - JUNCTION_TRIGGER_SIZE / 2,
        y: point.y - JUNCTION_TRIGGER_SIZE,
        width: JUNCTION_TRIGGER_SIZE,
        height: JUNCTION_TRIGGER_SIZE,
      }
  }
}

function mergeStructuralSeamBranches(
  seamTargets: readonly WorkbenchSeamTarget[],
  container: WorkbenchContainerGeometry,
): WorkbenchSeamTarget[] {
  const groups = new Map<string, WorkbenchSeamTarget[]>()

  for (const target of seamTargets) {
    const key = [
      target.spanAxis,
      target.edge,
      Math.round(target.spanPosition),
      target.referenceGroupId,
      target.referenceTileId,
    ].join(":")
    const current = groups.get(key)
    if (current) {
      current.push(target)
    } else {
      groups.set(key, [target])
    }
  }

  const merged: WorkbenchSeamTarget[] = []

  for (const targets of groups.values()) {
    const sorted = [...targets].sort((a, b) => a.spanStart - b.spanStart)
    let active = sorted[0]

    for (const next of sorted.slice(1)) {
      if (next.spanStart <= active.spanEnd + SEAM_INTERIOR_TOLERANCE) {
        active = {
          ...active,
          spanStart: Math.min(active.spanStart, next.spanStart),
          spanEnd: Math.max(active.spanEnd, next.spanEnd),
          adjacentTileId:
            active.adjacentTileId === next.adjacentTileId ? active.adjacentTileId : active.adjacentTileId,
        }
        continue
      }

      merged.push(active)
      active = next
    }

    merged.push(active)
  }

  return merged.filter((target) => {
    if (target.spanAxis === "vertical") {
      return (
        target.spanStart <= SEAM_INTERIOR_TOLERANCE &&
        container.height - target.spanEnd <= SEAM_INTERIOR_TOLERANCE
      )
    }

    return (
      target.spanStart <= SEAM_INTERIOR_TOLERANCE &&
      container.width - target.spanEnd <= SEAM_INTERIOR_TOLERANCE
    )
  }).map((target) => ({
    ...target,
    scope: "full-span",
  }))
}

export function computeWorkbenchJunctionTargetsFromSeamTargets(
  seamTargets: readonly WorkbenchSeamTarget[],
  container: WorkbenchContainerGeometry,
): WorkbenchJunctionTarget[] {
  const structuralTargets = mergeStructuralSeamBranches(seamTargets, container)
  const allTargets = seamTargets
  const junctionTargets: WorkbenchJunctionTarget[] = []
  const seen = new Set<string>()

  for (const structuralTarget of structuralTargets) {
    const structuralAxis = structuralTarget.spanAxis
    const perpendicularAxis: WorkbenchSeamAxis =
      structuralAxis === "vertical" ? "horizontal" : "vertical"

    for (const crossingTarget of allTargets) {
      if (crossingTarget.spanAxis !== perpendicularAxis) {
        continue
      }

      const intersects =
        structuralAxis === "vertical"
          ? structuralTarget.spanPosition >= crossingTarget.spanStart - SEAM_INTERIOR_TOLERANCE &&
            structuralTarget.spanPosition <= crossingTarget.spanEnd + SEAM_INTERIOR_TOLERANCE &&
            crossingTarget.spanPosition >= structuralTarget.spanStart - SEAM_INTERIOR_TOLERANCE &&
            crossingTarget.spanPosition <= structuralTarget.spanEnd + SEAM_INTERIOR_TOLERANCE
          : structuralTarget.spanPosition >= crossingTarget.spanStart - SEAM_INTERIOR_TOLERANCE &&
            structuralTarget.spanPosition <= crossingTarget.spanEnd + SEAM_INTERIOR_TOLERANCE &&
            crossingTarget.spanPosition >= structuralTarget.spanStart - SEAM_INTERIOR_TOLERANCE &&
            crossingTarget.spanPosition <= structuralTarget.spanEnd + SEAM_INTERIOR_TOLERANCE

      if (!intersects) {
        continue
      }

      const point: WorkbenchAnchorPoint =
        structuralAxis === "vertical"
          ? { x: structuralTarget.spanPosition, y: crossingTarget.spanPosition }
          : { x: crossingTarget.spanPosition, y: structuralTarget.spanPosition }

      const key = [
        structuralTarget.referenceTileId,
        structuralTarget.edge,
        Math.round(point.x),
        Math.round(point.y),
      ].join(":")
      if (seen.has(key)) {
        continue
      }
      seen.add(key)

      junctionTargets.push({
        id: `junction-${structuralTarget.referenceGroupId}-${structuralTarget.edge}-${Math.round(point.x)}-${Math.round(point.y)}`,
        kind: "junction",
        referenceGroupId: structuralTarget.referenceGroupId,
        referenceTileId: structuralTarget.referenceTileId,
        adjacentTileId: structuralTarget.adjacentTileId,
        edge: structuralTarget.edge,
        triggerRect: buildJunctionTriggerRect(point, structuralTarget.edge),
        anchorPoint: point,
        scope: "full-span",
      })
    }
  }

  return junctionTargets
}

export function resolveWorkbenchInsertionIntent(
  target: WorkbenchInsertionTarget,
): WorkbenchInsertionIntent {
  if (target.kind === "edge") {
    return {
      targetId: target.id,
      targetKind: "edge",
      previewMode: "edgePreview",
      scope: target.scope,
      edge: target.edge,
      referenceTileId: target.referenceTileId,
      referenceGroupId: null,
      adjacentTileId: null,
      dockDirection: EDGE_TO_DOCK_DIRECTION[target.edge],
    }
  }

  if (target.kind === "junction") {
    return {
      targetId: target.id,
      targetKind: "junction",
      previewMode: "junctionPreview",
      scope: target.scope,
      edge: target.edge,
      referenceTileId: target.referenceTileId,
      referenceGroupId: target.referenceGroupId,
      adjacentTileId: target.adjacentTileId,
      dockDirection: EDGE_TO_DOCK_DIRECTION[target.edge],
    }
  }

  return {
    targetId: target.id,
    targetKind: "seam",
    previewMode: "seamPreview",
    scope: target.scope,
    edge: target.edge,
    referenceTileId: target.referenceTileId,
    referenceGroupId: null,
    adjacentTileId: target.adjacentTileId,
    dockDirection: target.direction,
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
