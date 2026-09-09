export interface WorkbenchSelectionLauncherLayout {
  fittingColumns: number
  fittingRows: number
  columns: number
  rows: number
  itemsPerPage: number
  pageCount: number
}

export interface ComputeWorkbenchSelectionLauncherLayoutOptions {
  width: number
  height: number
  itemCount: number
  cellWidth?: number
  cellHeight?: number
  columnGap?: number
  rowGap?: number
  maxColumns?: number
  maxRows?: number
}

export const WORKBENCH_SELECTION_LAUNCHER_LAYOUT = {
  cellWidth: 96,
  cellHeight: 102,
  columnGap: 22,
  rowGap: 18,
  maxColumns: 6,
} as const

export const WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH =
  WORKBENCH_SELECTION_LAUNCHER_LAYOUT.cellWidth
export const WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT =
  WORKBENCH_SELECTION_LAUNCHER_LAYOUT.cellHeight
export const WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP =
  WORKBENCH_SELECTION_LAUNCHER_LAYOUT.columnGap
export const WORKBENCH_SELECTION_LAUNCHER_ROW_GAP =
  WORKBENCH_SELECTION_LAUNCHER_LAYOUT.rowGap
export const WORKBENCH_SELECTION_LAUNCHER_MAX_COLUMNS =
  WORKBENCH_SELECTION_LAUNCHER_LAYOUT.maxColumns

export function areWorkbenchSelectionLauncherLayoutsEqual(
  left: WorkbenchSelectionLauncherLayout,
  right: WorkbenchSelectionLauncherLayout,
): boolean {
  return (
    left.fittingColumns === right.fittingColumns &&
    left.fittingRows === right.fittingRows &&
    left.columns === right.columns &&
    left.rows === right.rows &&
    left.itemsPerPage === right.itemsPerPage &&
    left.pageCount === right.pageCount
  )
}

export function computeWorkbenchSelectionLauncherLayout({
  width,
  height,
  itemCount,
  cellWidth = WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH,
  cellHeight = WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT,
  columnGap = WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP,
  rowGap = WORKBENCH_SELECTION_LAUNCHER_ROW_GAP,
  maxColumns = WORKBENCH_SELECTION_LAUNCHER_MAX_COLUMNS,
  maxRows = Number.POSITIVE_INFINITY,
}: ComputeWorkbenchSelectionLauncherLayoutOptions): WorkbenchSelectionLauncherLayout {
  const safeItemCount = Math.max(0, itemCount)
  const safeWidth = Math.max(0, width)
  const safeHeight = Math.max(0, height)

  const fittingColumns = Math.max(
    1,
    Math.floor((safeWidth + columnGap) / (cellWidth + columnGap)),
  )
  const fittingRows = Math.max(
    1,
    Math.floor((safeHeight + rowGap) / (cellHeight + rowGap)),
  )

  const columns = Math.max(
    1,
    Math.min(maxColumns, fittingColumns, Math.max(1, safeItemCount)),
  )
  const requiredRows = Math.ceil(Math.max(1, safeItemCount) / columns)
  const rows = Math.max(1, Math.min(maxRows, fittingRows, requiredRows))
  const itemsPerPage = Math.max(1, columns * rows)
  const pageCount = Math.max(1, Math.ceil(Math.max(1, safeItemCount) / itemsPerPage))

  return {
    fittingColumns,
    fittingRows,
    columns,
    rows,
    itemsPerPage,
    pageCount,
  }
}
