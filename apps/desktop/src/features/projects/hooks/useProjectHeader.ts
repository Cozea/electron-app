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
  const setChrome = useProjectHeaderStore((state) => state.setChrome)
  const reset = useProjectHeaderStore((state) => state.reset)

  useEffect(() => {
    setChrome({
      header: header ?? null,
      centerAddon: centerAddon ?? null,
      insetLeft: options?.insetLeft ?? 0,
      insetRight: options?.insetRight ?? 0,
    })
  }, [header, centerAddon, options?.insetLeft, options?.insetRight, setChrome])

  useEffect(() => reset, [reset])
}
