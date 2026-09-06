import * as React from "react"

/**
 * Cozea is a desktop application. This threshold does not identify a mobile
 * device; it identifies a BrowserWindow that is too narrow to permanently
 * reserve desktop shell chrome such as the primary sidebar.
 */
export const COMPACT_WINDOW_BREAKPOINT_PX = 768

export function useIsCompactWindow() {
  const [isCompactWindow, setIsCompactWindow] = React.useState<boolean>(() => {
    if (typeof window === "undefined") return false
    return window.innerWidth < COMPACT_WINDOW_BREAKPOINT_PX
  })

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${COMPACT_WINDOW_BREAKPOINT_PX - 1}px)`)
    const onChange = () => {
      setIsCompactWindow(window.innerWidth < COMPACT_WINDOW_BREAKPOINT_PX)
    }
    mql.addEventListener("change", onChange)
    setIsCompactWindow(window.innerWidth < COMPACT_WINDOW_BREAKPOINT_PX)
    return () => mql.removeEventListener("change", onChange)
  }, [])

  return isCompactWindow
}

/**
 * Compatibility alias for the shadcn-derived sidebar API. New desktop shell
 * code should use `useIsCompactWindow` and compact-window terminology.
 */
export const useIsMobile = useIsCompactWindow
