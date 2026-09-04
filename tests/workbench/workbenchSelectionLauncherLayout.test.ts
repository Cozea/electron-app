import { describe, expect, it } from "vitest"

import {
  computeWorkbenchSelectionLauncherLayout,
  WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT,
  WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH,
  WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP,
  WORKBENCH_SELECTION_LAUNCHER_ROW_GAP,
} from "@/features/workbench/workbenchSelectionLauncherLayout"

describe("workbenchSelectionLauncherLayout", () => {
  it("computes multiple columns when there is enough width", () => {
    const layout = computeWorkbenchSelectionLauncherLayout({
      width:
        WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH * 4 +
        WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP * 3,
      height:
        WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT * 3 +
        WORKBENCH_SELECTION_LAUNCHER_ROW_GAP * 2,
      itemCount: 12,
    })

    expect(layout).toEqual({
      fittingColumns: 4,
      fittingRows: 3,
      columns: 4,
      rows: 3,
      itemsPerPage: 12,
      pageCount: 1,
    })
  })

  it("fills additional rows in a tall tile before paginating", () => {
    const layout = computeWorkbenchSelectionLauncherLayout({
      width:
        WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH * 3 +
        WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP * 2,
      height:
        WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT * 4 +
        WORKBENCH_SELECTION_LAUNCHER_ROW_GAP * 3,
      itemCount: 14,
    })

    expect(layout).toEqual({
      fittingColumns: 3,
      fittingRows: 4,
      columns: 3,
      rows: 4,
      itemsPerPage: 12,
      pageCount: 2,
    })
  })

  it("paginates horizontally when there are more items than fit on one page", () => {
    const layout = computeWorkbenchSelectionLauncherLayout({
      width:
        WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH * 4 +
        WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP * 3,
      height:
        WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT * 2 +
        WORKBENCH_SELECTION_LAUNCHER_ROW_GAP,
      itemCount: 13,
    })

    expect(layout).toEqual({
      fittingColumns: 4,
      fittingRows: 2,
      columns: 4,
      rows: 2,
      itemsPerPage: 8,
      pageCount: 2,
    })
  })

  it("does not create more columns than there are items", () => {
    const layout = computeWorkbenchSelectionLauncherLayout({
      width: 2000,
      height: 1000,
      itemCount: 4,
    })

    expect(layout.columns).toBe(4)
    expect(layout.rows).toBe(1)
  })

  it("keeps at least one row and one column in very small spaces", () => {
    const layout = computeWorkbenchSelectionLauncherLayout({
      width: 10,
      height: 10,
      itemCount: 20,
    })

    expect(layout).toEqual({
      fittingColumns: 1,
      fittingRows: 1,
      columns: 1,
      rows: 1,
      itemsPerPage: 1,
      pageCount: 20,
    })
  })

  it("reports fitting column capacity separately from rendered columns", () => {
    const layout = computeWorkbenchSelectionLauncherLayout({
      width:
        WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH * 4 +
        WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP * 3,
      height:
        WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT * 2 +
        WORKBENCH_SELECTION_LAUNCHER_ROW_GAP,
      itemCount: 2,
    })

    expect(layout.fittingColumns).toBe(4)
    expect(layout.columns).toBe(2)
  })
})
