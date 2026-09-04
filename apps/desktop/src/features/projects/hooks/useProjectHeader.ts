import { useEffect } from "react"
import type { ReactNode } from "react"
import { useProjectHeaderStore } from "@/features/projects/model/projectHeaderStore"

interface ProjectHeaderOptions {
  insetLeft?: number
  insetRight?: number
  /** Pinned to the top-right of the title bar for as long as the page is mounted. */
  rightAddon?: ReactNode | null
  /** Set when the route has nothing shareable, e.g. the DevApps Store. */
  hideShare?: boolean
}

export function useProjectHeader(
  header: ReactNode | null,
  centerAddon?: ReactNode | null,
  options?: ProjectHeaderOptions
) {
  const setChrome = useProjectHeaderStore((state) => state.setChrome)
  const reset = useProjectHeaderStore((state) => state.reset)

  useEffect(() => {
    setChrome({
      header: header ?? null,
      centerAddon: centerAddon ?? null,
      rightAddon: options?.rightAddon ?? null,
      hideShare: options?.hideShare ?? false,
      insetLeft: options?.insetLeft ?? 0,
      insetRight: options?.insetRight ?? 0,
    })
  }, [
    header,
    centerAddon,
    options?.rightAddon,
    options?.hideShare,
    options?.insetLeft,
    options?.insetRight,
    setChrome,
  ])

  useEffect(() => reset, [reset])
}
