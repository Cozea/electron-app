import { describe, expect, it } from "vitest"

import {
  computeWorkbenchEdgeTargetsFromGeometry,
  computeWorkbenchJunctionTargetsFromSeamTargets,
  computeWorkbenchSeamTargetsFromGeometry,
  resolveWorkbenchInsertionIntent,
  type WorkbenchContainerGeometry,
  type WorkbenchPanelGeometry,
} from "../../src/features/projects/lib/workbenchDockview"

function panel(
  referenceTileId: string,
  x: number,
  y: number,
  width: number,
  height: number,
): WorkbenchPanelGeometry {
  return {
    groupId: `group-${referenceTileId}`,
    referenceTileId,
    relLeft: x,
    relTop: y,
    relRight: x + width,
    relBottom: y + height,
  }
}

const container: WorkbenchContainerGeometry = {
  width: 1000,
  height: 800,
}

describe("workbench insertion targets", () => {
  it("treats a single full-screen tile as full-span on all outer edges", () => {
    const targets = computeWorkbenchEdgeTargetsFromGeometry(
      [panel("editor", 0, 0, 1000, 800)],
      container,
    )

    expect(targets).toHaveLength(4)
    expect(targets.map((target) => target.edge).sort()).toEqual([
      "bottom",
      "left",
      "right",
      "top",
    ])
    expect(new Set(targets.map((target) => target.scope))).toEqual(new Set(["full-span"]))
  })

  it("creates separate outer-edge targets for stacked tiles sharing the same screen edge", () => {
    const targets = computeWorkbenchEdgeTargetsFromGeometry(
      [
        panel("left-column", 0, 0, 400, 800),
        panel("right-top", 400, 0, 600, 400),
        panel("right-bottom", 400, 400, 600, 400),
      ],
      container,
    )

    const rightTargets = targets.filter((target) => target.edge === "right")

    expect(rightTargets).toHaveLength(2)
    expect(rightTargets.map((target) => target.referenceTileId).sort()).toEqual([
      "right-bottom",
      "right-top",
    ])
    expect(rightTargets.map((target) => target.scope)).toEqual(["local", "local"])
    expect(rightTargets.map((target) => target.triggerRect.y)).toEqual([0, 400])
    expect(rightTargets.map((target) => target.triggerRect.height)).toEqual([400, 400])

    const leftEdge = targets.find((target) => target.id === "edge-left-column-left")
    expect(leftEdge?.scope).toBe("full-span")
  })

  it("marks the seam between full-height columns as full-span and resolves seam insertion intent centrally", () => {
    const seams = computeWorkbenchSeamTargetsFromGeometry(
      [
        panel("left-column", 0, 0, 500, 800),
        panel("right-column", 500, 0, 500, 800),
      ],
      container,
    )

    const rightwardSeam = seams.find(
      (target) =>
        target.referenceTileId === "left-column" &&
        target.adjacentTileId === "right-column" &&
        target.direction === "right",
    )

    expect(rightwardSeam).toBeDefined()
    expect(rightwardSeam?.scope).toBe("full-span")

    const intent = resolveWorkbenchInsertionIntent(rightwardSeam!)
    expect(intent).toEqual({
      targetId: rightwardSeam!.id,
      targetKind: "seam",
      previewMode: "seamPreview",
      scope: "full-span",
      edge: "right",
      referenceTileId: "left-column",
      referenceGroupId: null,
      adjacentTileId: "right-column",
      dockDirection: "right",
    })
  })

  it("keeps bottom-edge insertions local when only the lower tiles own that border", () => {
    const targets = computeWorkbenchEdgeTargetsFromGeometry(
      [
        panel("top-full", 0, 0, 1000, 300),
        panel("bottom-left", 0, 300, 500, 500),
        panel("bottom-right", 500, 300, 500, 500),
      ],
      container,
    )

    const bottomTargets = targets.filter((target) => target.edge === "bottom")

    expect(bottomTargets).toHaveLength(2)
    expect(bottomTargets.map((target) => target.referenceTileId).sort()).toEqual([
      "bottom-left",
      "bottom-right",
    ])
    expect(bottomTargets.map((target) => target.scope)).toEqual(["local", "local"])

    const topTarget = targets.find((target) => target.id === "edge-top-full-top")
    expect(topTarget?.scope).toBe("full-span")
  })

  it("keeps split seams local when they do not span the full shared axis", () => {
    const seams = computeWorkbenchSeamTargetsFromGeometry(
      [
        panel("left-column", 0, 0, 400, 800),
        panel("right-top", 400, 0, 600, 400),
        panel("right-bottom", 400, 400, 600, 400),
      ],
      container,
    )

    const horizontalRightStackSeam = seams.find(
      (target) =>
        target.referenceTileId === "right-top" &&
        target.adjacentTileId === "right-bottom" &&
        target.direction === "below",
    )

    expect(horizontalRightStackSeam?.scope).toBe("local")
  })

  it("creates junction targets only along the structural full-span axis at a T junction", () => {
    const seams = computeWorkbenchSeamTargetsFromGeometry(
      [
        panel("left-column", 0, 0, 400, 800),
        panel("right-top", 400, 0, 600, 400),
        panel("right-bottom", 400, 400, 600, 400),
      ],
      container,
    )

    const junctions = computeWorkbenchJunctionTargetsFromSeamTargets(seams, container)

    expect(junctions).toHaveLength(1)
    expect(junctions.map((target) => target.edge)).toEqual(["right"])
    expect(new Set(junctions.map((target) => `${target.anchorPoint.x}:${target.anchorPoint.y}`))).toEqual(
      new Set(["400:400"]),
    )

    const rightJunction = junctions[0]
    expect(resolveWorkbenchInsertionIntent(rightJunction!)).toEqual({
      targetId: rightJunction!.id,
      targetKind: "junction",
      previewMode: "junctionPreview",
      scope: "full-span",
      edge: "right",
      referenceTileId: "left-column",
      referenceGroupId: "group-left-column",
      adjacentTileId: "right-top",
      dockDirection: "right",
    })
  })

  it("creates four directional junction targets at a full cross intersection", () => {
    const seams = computeWorkbenchSeamTargetsFromGeometry(
      [
        panel("top-left", 0, 0, 500, 400),
        panel("top-right", 500, 0, 500, 400),
        panel("bottom-left", 0, 400, 500, 400),
        panel("bottom-right", 500, 400, 500, 400),
      ],
      container,
    )

    const junctions = computeWorkbenchJunctionTargetsFromSeamTargets(seams, container)

    expect(junctions).toHaveLength(0)
  })
})
