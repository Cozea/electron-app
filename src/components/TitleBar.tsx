import { type ReactNode } from "react"
import { CommandSearch } from "./CommandSearch"
import { useWindowChrome } from "@/hooks/useWindowChrome"

interface TitleBarProps {
  title?: string
  showTitle?: boolean
  showSearch?: boolean
  children?: ReactNode
}

export function TitleBar({ title = 'Cozea', showTitle = false, showSearch = false, children }: TitleBarProps) {
  const windowChrome = useWindowChrome()

  return (
    <div
      className="h-9 w-full flex items-center fixed top-0 left-0 right-0 z-50 bg-content-surface px-3 text-sidebar-foreground titlebar-drag-region bdry-b bdry-sidebar"
    >
      {/* Traffic lights take ~70px on the left on macOS, but not in fullscreen */}
      <div
        className="shrink-0 transition-all duration-300 ease-in-out"
        style={{ width: windowChrome.titlebarLeadingSpace }}
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
