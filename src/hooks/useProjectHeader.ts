import { useEffect } from "react"
import type { ReactNode } from "react"
import { useProjectHeaderStore } from "@/stores/useProjectHeaderStore"

interface ProjectHeaderOptions {
  insetLeft?: number
  insetRight?: number
}

export function useProjectHeader(
  header: ReactNode | null,
  breadcrumbAddon?: ReactNode | null,
  hideBreadcrumbs?: boolean,
  options?: ProjectHeaderOptions
) {
  const setHeader = useProjectHeaderStore((state) => state.setHeader)
  const setBreadcrumbAddon = useProjectHeaderStore((state) => state.setBreadcrumbAddon)
  const setHideBreadcrumbs = useProjectHeaderStore((state) => state.setHideBreadcrumbs)
  const setInsetLeft = useProjectHeaderStore((state) => state.setInsetLeft)
  const setInsetRight = useProjectHeaderStore((state) => state.setInsetRight)

  useEffect(() => {
    setHeader(header ?? null)
    setBreadcrumbAddon(breadcrumbAddon ?? null)
    setHideBreadcrumbs(Boolean(hideBreadcrumbs))
    setInsetLeft(options?.insetLeft ?? 0)
    setInsetRight(options?.insetRight ?? 0)

    return () => {
      setHeader(null)
      setBreadcrumbAddon(null)
      setHideBreadcrumbs(false)
      setInsetLeft(0)
      setInsetRight(0)
    }
  }, [
    header,
    breadcrumbAddon,
    hideBreadcrumbs,
    options?.insetLeft,
    options?.insetRight,
    setHeader,
    setBreadcrumbAddon,
    setHideBreadcrumbs,
    setInsetLeft,
    setInsetRight,
  ])
}
