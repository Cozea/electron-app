import { useEffect } from "react"
import type { ReactNode } from "react"
import { useProjectHeaderStore } from "@/stores/useProjectHeaderStore"

interface ProjectHeaderOptions {
  insetLeft?: number
  insetRight?: number
}

export function useProjectHeader(
  header: ReactNode | null,
  centerAddon?: ReactNode | null,
  options?: ProjectHeaderOptions
) {
  const setHeader = useProjectHeaderStore((state) => state.setHeader)
  const setCenterAddon = useProjectHeaderStore((state) => state.setCenterAddon)
  const setInsetLeft = useProjectHeaderStore((state) => state.setInsetLeft)
  const setInsetRight = useProjectHeaderStore((state) => state.setInsetRight)
  const reset = useProjectHeaderStore((state) => state.reset)

  useEffect(() => {
    setHeader(header ?? null)
    setCenterAddon(centerAddon ?? null)
    setInsetLeft(options?.insetLeft ?? 0)
    setInsetRight(options?.insetRight ?? 0)
  }, [
    header,
    centerAddon,
    options?.insetLeft,
    options?.insetRight,
    setHeader,
    setCenterAddon,
    setInsetLeft,
    setInsetRight,
  ])

  useEffect(() => reset, [reset])
}
