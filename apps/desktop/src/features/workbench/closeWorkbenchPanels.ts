import type { IDockviewPanel } from "dockview-react"

import { useTileActivityStore } from "@/features/workbench/model/tileActivityStore"
import type { TranslationKey } from "@/lib/i18n"

/**
 * Closes workbench panels the way a user expects from a close control.
 *
 * Closing a terminal tile kills its PTY (see the workbench runtime's
 * onDidRemovePanel), so a terminal with a foreground process asks first. The
 * busy verdict comes from the tile activity store, which only learns of a
 * process on its next idle/busy transition: a command already running when the
 * tile mounted is not detected until it finishes or another starts.
 */
export async function closeWorkbenchPanels(
  panels: readonly IDockviewPanel[],
  t: (key: TranslationKey) => string,
): Promise<void> {
  // Snapshot first: callers may pass a group's live `panels` array, which each
  // close (and anything that happens while the dialog is open) mutates.
  const targets = panels.slice()
  if (targets.length === 0) return

  const { activityByTileId } = useTileActivityStore.getState()
  const runningTerminals = targets.filter(
    (panel) =>
      panel.api.component === "terminal" && activityByTileId[panel.id] === "running",
  )

  if (runningTerminals.length > 0) {
    const dialog = window.electronAPI?.dialog
    if (dialog) {
      const result = await dialog.showMessageBox({
        type: "warning",
        message: t("workbench.panel.closeRunningTerminal.title"),
        detail: t("workbench.panel.closeRunningTerminal.message"),
        buttons: [t("workbench.panel.closeRunningTerminal.confirm"), t("common.cancel")],
        defaultId: 1,
        cancelId: 1,
        noLink: true,
      })
      if (result.response !== 0) return
    }
  }

  for (const panel of targets) {
    panel.api.close()
  }
}
