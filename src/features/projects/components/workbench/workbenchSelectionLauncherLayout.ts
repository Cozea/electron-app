export interface WorkbenchSelectionLauncherLayout {
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

export const WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH = 112
export const WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT = 118
export const WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP = 28
export const WORKBENCH_SELECTION_LAUNCHER_ROW_GAP = 24
export const WORKBENCH_SELECTION_LAUNCHER_MAX_COLUMNS = 7
export const WORKBENCH_SELECTION_LAUNCHER_MAX_ROWS = 5

export function computeWorkbenchSelectionLauncherLayout({
  width,
  height,
  itemCount,
  cellWidth = WORKBENCH_SELECTION_LAUNCHER_CELL_WIDTH,
  cellHeight = WORKBENCH_SELECTION_LAUNCHER_CELL_HEIGHT,
  columnGap = WORKBENCH_SELECTION_LAUNCHER_COLUMN_GAP,
  rowGap = WORKBENCH_SELECTION_LAUNCHER_ROW_GAP,
  maxColumns = WORKBENCH_SELECTION_LAUNCHER_MAX_COLUMNS,
  maxRows = WORKBENCH_SELECTION_LAUNCHER_MAX_ROWS,
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
  const rows = Math.max(1, Math.min(maxRows, fittingRows))
  const itemsPerPage = Math.max(1, columns * rows)
  const pageCount = Math.max(1, Math.ceil(Math.max(1, safeItemCount) / itemsPerPage))

  return {
    columns,
    rows,
    itemsPerPage,
    pageCount,
  }
}

