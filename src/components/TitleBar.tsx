import { type ReactNode, useState, useEffect } from "react"

interface TitleBarProps {
  title?: string
  showTitle?: boolean
  children?: ReactNode
}

export function TitleBar({ title = 'Cozea', showTitle = false, children }: TitleBarProps) {
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
      className="h-9 w-full flex items-center fixed top-0 left-0 right-0 z-50 bg-sidebar border-b border-sidebar-border px-3 text-sidebar-foreground"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Traffic lights take ~70px on the left on macOS, but not in fullscreen */}
      <div
        className="shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: isFullScreen ? 4 : 70 }}
      />

      {/* Content Area (Breadcrumbs, etc.) - No Drag */}
      <div
        className="flex-1 flex items-center min-w-0"
      >
        {children}
      </div>

      {showTitle && (
        <div className="absolute left-1/2 -translate-x-1/2 text-muted-foreground text-sm font-medium pointer-events-none">
          {title}
        </div>
      )}
    </div>
  )
}
