import { useEffect, useState } from "react"
import type { DockviewPanelApi } from "dockview-react"

export interface WorkbenchPanelActivityState {
  mode: "visible" | "hidden"
  visible: boolean
  focused: boolean
}

function readPanelActivityState(panelApi: DockviewPanelApi): WorkbenchPanelActivityState {
  const visible = panelApi.isVisible
  const focused = visible && panelApi.isActive
  return {
    mode: visible ? "visible" : "hidden",
    visible,
    focused,
  }
}

function subscribePanelActivity(
  panelApi: DockviewPanelApi,
  onChange: () => void,
): () => void {
  const activeDisposable = panelApi.onDidActiveChange(onChange)
  const visibilityDisposable = panelApi.onDidVisibilityChange(onChange)
  return () => {
    activeDisposable.dispose()
    visibilityDisposable.dispose()
  }
}

/**
 * Bridges dockview panel visibility/active events into React state.
 * dockview-react still exposes only imperative `api` on panel props — no
 * equivalent hook — so this stays the shared subscription seam.
 */
export function useWorkbenchPanelActivityMode(
  panelApi: DockviewPanelApi,
): WorkbenchPanelActivityState {
  const [state, setState] = useState<WorkbenchPanelActivityState>(() =>
    readPanelActivityState(panelApi),
  )

  useEffect(() => {
    const sync = () => {
      setState((previous) => {
        const next = readPanelActivityState(panelApi)
        if (
          previous.visible === next.visible &&
          previous.focused === next.focused &&
          previous.mode === next.mode
        ) {
          return previous
        }
        return next
      })
    }

    sync()
    return subscribePanelActivity(panelApi, sync)
  }, [panelApi])

  return state
}
