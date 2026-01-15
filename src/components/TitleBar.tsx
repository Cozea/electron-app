import { type ReactNode } from "react"

interface TitleBarProps {
  title?: string
  showTitle?: boolean
  children?: ReactNode
}

export function TitleBar({ title = 'Cozea', showTitle = false, children }: TitleBarProps) {
  return (
    <div
      className="h-9 w-full flex items-center fixed top-0 left-0 right-0 z-50 bg-background border-b border-border px-3"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
    >
      {/* Traffic lights take ~70px on the left on macOS */}
      <div className="w-[70px] shrink-0" />

      {/* Content Area (Breadcrumbs, etc.) - No Drag */}
      <div
        className="flex-1 flex items-center min-w-0"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
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
