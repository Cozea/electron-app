// @ts-nocheck
import { create } from "zustand"
import type { ReactNode } from "react"

interface ProjectHeaderState {
  header: ReactNode | null
  centerAddon: ReactNode | null
  insetLeft: number
  insetRight: number
  setHeader: (header: ReactNode | null) => void
  setCenterAddon: (node: ReactNode | null) => void
  setInsetLeft: (value: number) => void
  setInsetRight: (value: number) => void
  reset: () => void
}

export const useProjectHeaderStore = create<ProjectHeaderState>((set) => ({
  header: null,
  centerAddon: null,
  insetLeft: 0,
  insetRight: 0,
  setHeader: (header) => set({ header }),
  setCenterAddon: (centerAddon) => set({ centerAddon }),
  setInsetLeft: (insetLeft) => set({ insetLeft }),
  setInsetRight: (insetRight) => set({ insetRight }),
  reset: () =>
    set({
      header: null,
      centerAddon: null,
      insetLeft: 0,
      insetRight: 0,
    }),
}))
