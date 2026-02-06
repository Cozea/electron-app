import { create } from "zustand"
import type { ReactNode } from "react"

interface ProjectHeaderState {
  header: ReactNode | null
  breadcrumbAddon: ReactNode | null
  hideBreadcrumbs: boolean
  setHeader: (header: ReactNode | null) => void
  setBreadcrumbAddon: (node: ReactNode | null) => void
  setHideBreadcrumbs: (hide: boolean) => void
  reset: () => void
}

export const useProjectHeaderStore = create<ProjectHeaderState>((set) => ({
  header: null,
  breadcrumbAddon: null,
  hideBreadcrumbs: false,
  setHeader: (header) => set({ header }),
  setBreadcrumbAddon: (breadcrumbAddon) => set({ breadcrumbAddon }),
  setHideBreadcrumbs: (hideBreadcrumbs) => set({ hideBreadcrumbs }),
  reset: () => set({ header: null, breadcrumbAddon: null, hideBreadcrumbs: false }),
}))
