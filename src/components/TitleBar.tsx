import { type ReactNode, useState, useEffect } from "react"
import { CommandSearch } from "./CommandSearch"

interface TitleBarProps {
  title?: string
  showTitle?: boolean
  showSearch?: boolean
  children?: ReactNode
}

export function TitleBar({ title = 'Cozea', showTitle = false, showSearch = false, children }: TitleBarProps) {
  const [isFullScreen, setIsFullScreen] = useState(false)

  useEffect(() => {
    // Get initial fullscreen state
    window.electronAPI?.window?.isFullScreen().then((fs) => {
      console.log('[TitleBar] Initial fullscreen state:', fs)
      setIsFullScreen(fs)
    })

    // Subscribe to fullscreen changes
    const cleanup = window.electronAPI?.window?.onFullScreenChange((fs) => {
      console.log('[TitleBar] Fullscreen changed:', fs)
      setIsFullScreen(fs)
    })
    return () => cleanup?.()
  }, [])

  return (
    <div
      className="h-9 w-full flex items-center fixed top-0 left-0 right-0 z-50 bg-sidebar px-3 text-sidebar-foreground titlebar-drag-region bdry-b bdry-sidebar"
    >
      {/* Traffic lights take ~70px on the left on macOS, but not in fullscreen */}
      <div
        className="shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: isFullScreen ? 4 : 70 }}
      />

      {/* Content Area (Breadcrumbs, etc.) - No Drag */}
      <div className="flex-1 flex items-center min-w-0">
        {children}
      </div>

      {/* Center Search - absolutely positioned overlay */}
      {showSearch && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <div className="pointer-events-auto">
            <CommandSearch />
          </div>
        </div>
      )}

      {showTitle && !showSearch && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <span className="text-muted-foreground text-sm font-medium">
            {title}
          </span>
        </div>
      )}

    </div>
  )
}
