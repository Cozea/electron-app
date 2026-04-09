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
  setHeader: (header) => set((state) => (state.header === header ? state : { header })),
  setCenterAddon: (centerAddon) =>
    set((state) => (state.centerAddon === centerAddon ? state : { centerAddon })),
  setInsetLeft: (insetLeft) =>
    set((state) => (state.insetLeft === insetLeft ? state : { insetLeft })),
  setInsetRight: (insetRight) =>
    set((state) => (state.insetRight === insetRight ? state : { insetRight })),
  reset: () =>
    set((state) =>
      state.header === null &&
      state.centerAddon === null &&
      state.insetLeft === 0 &&
      state.insetRight === 0
        ? state
        : {
            header: null,
            centerAddon: null,
            insetLeft: 0,
            insetRight: 0,
          }),
}))
