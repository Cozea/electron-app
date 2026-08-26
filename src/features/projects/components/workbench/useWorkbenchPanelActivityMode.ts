import { useEffect, useState } from "react"
import type { DockviewPanelApi } from "dockview-react"

export interface WorkbenchPanelActivityState {
  mode: "visible" | "hidden"
  visible: boolean
  focused: boolean
}

function getPanelActivityState(panelApi: DockviewPanelApi): WorkbenchPanelActivityState {
  const visible = panelApi.isVisible
  const focused = panelApi.isVisible && panelApi.isActive

  return {
    mode: visible ? "visible" : "hidden",
    visible,
    focused,
  }
}

export function useWorkbenchPanelActivityMode(panelApi: DockviewPanelApi): WorkbenchPanelActivityState {
  const [state, setState] = useState<WorkbenchPanelActivityState>(() => getPanelActivityState(panelApi))

  useEffect(() => {
    setState(getPanelActivityState(panelApi))

    const activeDisposable = panelApi.onDidActiveChange(() => {
      setState(getPanelActivityState(panelApi))
    })
    const visibilityDisposable = panelApi.onDidVisibilityChange(() => {
      setState(getPanelActivityState(panelApi))
    })

    return () => {
      activeDisposable.dispose()
      visibilityDisposable.dispose()
    }
  }, [panelApi])

  return state
}
