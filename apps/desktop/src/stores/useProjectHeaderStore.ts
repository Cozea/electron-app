import { create } from "zustand"
import type { ReactNode } from "react"

export interface ProjectHeaderChrome {
  header: ReactNode | null
  centerAddon: ReactNode | null
  insetLeft: number
  insetRight: number
}

interface ProjectHeaderState extends ProjectHeaderChrome {
  /**
   * Single write for all chrome fields. Field-level setters were four
   * separate emissions per page mount, and every subscriber (ProjectLayout
   * via useProjectChromeHeader) re-rendered once per emission.
   */
  setChrome: (chrome: ProjectHeaderChrome) => void
  reset: () => void
}

const INITIAL_CHROME: ProjectHeaderChrome = {
  header: null,
  centerAddon: null,
  insetLeft: 0,
  insetRight: 0,
}

function chromeEqual(state: ProjectHeaderChrome, next: ProjectHeaderChrome): boolean {
  return (
    state.header === next.header &&
    state.centerAddon === next.centerAddon &&
    state.insetLeft === next.insetLeft &&
    state.insetRight === next.insetRight
  )
}

export const useProjectHeaderStore = create<ProjectHeaderState>((set) => ({
  ...INITIAL_CHROME,
  setChrome: (chrome) => set((state) => (chromeEqual(state, chrome) ? state : chrome)),
  reset: () => set((state) => (chromeEqual(state, INITIAL_CHROME) ? state : INITIAL_CHROME)),
}))

if (import.meta.env.DEV && typeof window !== "undefined") {
  // Exposed for render-performance diagnostics (store emission counting).
  ;(window as unknown as Record<string, unknown>).__projectHeaderStore = useProjectHeaderStore
}
