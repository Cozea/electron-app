import { useCallback, useState, type RefCallback } from "react"

import {
  areWorkbenchSelectionLauncherLayoutsEqual,
  computeWorkbenchSelectionLauncherLayout,
  WORKBENCH_SELECTION_LAUNCHER_LAYOUT as LAUNCHER_CONFIG,
  type WorkbenchSelectionLauncherLayout,
} from "./workbenchSelectionLauncherLayout"

export function useLauncherGridLayout(
  itemCount: number,
  maxRows: number = 2,
): [RefCallback<HTMLDivElement>, WorkbenchSelectionLauncherLayout] {
  const [layout, setLayout] = useState<WorkbenchSelectionLauncherLayout>(() =>
    computeWorkbenchSelectionLauncherLayout({
      width: 0,
      height: 0,
      itemCount,
      cellWidth: LAUNCHER_CONFIG.cellWidth,
      cellHeight: LAUNCHER_CONFIG.cellHeight,
      columnGap: LAUNCHER_CONFIG.columnGap,
      rowGap: LAUNCHER_CONFIG.rowGap,
      maxColumns: LAUNCHER_CONFIG.maxColumns,
      maxRows,
    }),
  )

  // The viewport mounts only in grid view. Bind measurement to its DOM lifetime,
  // including list/grid replacements that leave the hook's inputs unchanged.
  const ref = useCallback<RefCallback<HTMLDivElement>>((viewport) => {
    if (!viewport) return
    const recalculate = () => {
      const viewportRect = viewport.getBoundingClientRect()
      const nextLayout = computeWorkbenchSelectionLauncherLayout({
        width: viewportRect.width,
        height: viewportRect.height,
        itemCount,
        cellWidth: LAUNCHER_CONFIG.cellWidth,
        cellHeight: LAUNCHER_CONFIG.cellHeight,
        columnGap: LAUNCHER_CONFIG.columnGap,
        rowGap: LAUNCHER_CONFIG.rowGap,
        maxColumns: LAUNCHER_CONFIG.maxColumns,
        maxRows,
      })
      setLayout((current) =>
        areWorkbenchSelectionLauncherLayoutsEqual(current, nextLayout)
          ? current
          : nextLayout,
      )
    }
    recalculate()
    const ro = new ResizeObserver(recalculate)
    ro.observe(viewport)
    return () => ro.disconnect()
  }, [itemCount, maxRows])

  return [ref, layout]
}
