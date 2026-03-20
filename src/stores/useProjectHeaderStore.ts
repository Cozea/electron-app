import { create } from "zustand"
import type { ReactNode } from "react"

interface ProjectHeaderState {
  header: ReactNode | null
  breadcrumbAddon: ReactNode | null
  centerAddon: ReactNode | null
  hideBreadcrumbs: boolean
  insetLeft: number
  insetRight: number
  setHeader: (header: ReactNode | null) => void
  setBreadcrumbAddon: (node: ReactNode | null) => void
  setCenterAddon: (node: ReactNode | null) => void
  setHideBreadcrumbs: (hide: boolean) => void
  setInsetLeft: (value: number) => void
  setInsetRight: (value: number) => void
  reset: () => void
}

export const useProjectHeaderStore = create<ProjectHeaderState>((set) => ({
  header: null,
  breadcrumbAddon: null,
  centerAddon: null,
  hideBreadcrumbs: false,
  insetLeft: 0,
  insetRight: 0,
  setHeader: (header) => set({ header }),
  setBreadcrumbAddon: (breadcrumbAddon) => set({ breadcrumbAddon }),
  setCenterAddon: (centerAddon) => set({ centerAddon }),
  setHideBreadcrumbs: (hideBreadcrumbs) => set({ hideBreadcrumbs }),
  setInsetLeft: (insetLeft) => set({ insetLeft }),
  setInsetRight: (insetRight) => set({ insetRight }),
  reset: () =>
    set({
      header: null,
      breadcrumbAddon: null,
      centerAddon: null,
      hideBreadcrumbs: false,
      insetLeft: 0,
      insetRight: 0,
    }),
}))
