import { useCallback, useState, type RefCallback } from "react"

import {
  areWorkbenchSelectionLauncherLayoutsEqual,
  computeWorkbenchSelectionLauncherLayout,
  WORKBENCH_SELECTION_LAUNCHER_LAYOUT as LAUNCHER_CONFIG,
  type WorkbenchSelectionLauncherLayout,
} from "./workbenchSelectionLauncherLayout"

export function useLauncherGridLayout(
  itemCount: number,
  isSingletonEmpty: boolean = false,
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
      maxRows: isSingletonEmpty ? 2 : Number.POSITIVE_INFINITY,
    }),
  )

  // The viewport mounts only in grid view. Bind measurement to its DOM lifetime,
  // including list/grid replacements that leave the hook's inputs unchanged.
  const ref = useCallback<RefCallback<HTMLDivElement>>((viewport) => {
    if (!viewport) return
    const recalculate = () => {
      const viewportRect = viewport.getBoundingClientRect()
      const effectiveMaxRows = isSingletonEmpty ? 2 : Number.POSITIVE_INFINITY
      const nextLayout = computeWorkbenchSelectionLauncherLayout({
        width: viewportRect.width,
        height: viewportRect.height,
        itemCount,
        cellWidth: LAUNCHER_CONFIG.cellWidth,
        cellHeight: LAUNCHER_CONFIG.cellHeight,
        columnGap: LAUNCHER_CONFIG.columnGap,
        rowGap: LAUNCHER_CONFIG.rowGap,
        maxColumns: LAUNCHER_CONFIG.maxColumns,
        maxRows: effectiveMaxRows,
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
  }, [isSingletonEmpty, itemCount])

  return [ref, layout]
}
