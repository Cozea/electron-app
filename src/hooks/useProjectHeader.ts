import { useEffect } from "react"
import type { ReactNode } from "react"
import { useProjectHeaderStore } from "@/stores/useProjectHeaderStore"

export function useProjectHeader(
  header: ReactNode | null,
  breadcrumbAddon?: ReactNode | null,
  hideBreadcrumbs?: boolean
) {
  const setHeader = useProjectHeaderStore((state) => state.setHeader)
  const setBreadcrumbAddon = useProjectHeaderStore((state) => state.setBreadcrumbAddon)
  const setHideBreadcrumbs = useProjectHeaderStore((state) => state.setHideBreadcrumbs)

  useEffect(() => {
    setHeader(header ?? null)
    setBreadcrumbAddon(breadcrumbAddon ?? null)
    setHideBreadcrumbs(Boolean(hideBreadcrumbs))

    return () => {
      setHeader(null)
      setBreadcrumbAddon(null)
      setHideBreadcrumbs(false)
    }
  }, [header, breadcrumbAddon, hideBreadcrumbs, setHeader, setBreadcrumbAddon, setHideBreadcrumbs])
}
