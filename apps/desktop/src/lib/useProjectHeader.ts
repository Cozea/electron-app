/**
 * Publish a route's chrome into the project shell header for as long as it is
 * mounted. See `projectHeaderStore` for why this is not project domain.
 */

import { useEffect } from "react"
import type { ReactNode } from "react"
import { useProjectHeaderStore } from "@/lib/projectHeaderStore"

interface ProjectHeaderOptions {
  insetLeft?: number
  insetRight?: number
  /** Pinned to the top-right of the title bar for as long as the page is mounted. */
  rightAddon?: ReactNode | null
  /** Set when the route has nothing shareable, e.g. the DevApps Store. */
  hideShare?: boolean
  /** When true, skips publishing or resetting the chrome header. */
  disabled?: boolean
}

export function useProjectHeader(
  header: ReactNode | null,
  centerAddon?: ReactNode | null,
  options?: ProjectHeaderOptions
) {
  const setChrome = useProjectHeaderStore((state) => state.setChrome)
  const reset = useProjectHeaderStore((state) => state.reset)
  const disabled = options?.disabled ?? false

  useEffect(() => {
    if (disabled) return
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
    disabled,
    setChrome,
  ])

  useEffect(() => {
    if (disabled) return
    return reset
  }, [disabled, reset])
}
