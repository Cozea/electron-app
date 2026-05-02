import { lazy, memo, Suspense, useCallback, useEffect, useRef, useState, type ReactNode } from "react"

import { useChangesSidebarStore } from "@/stores/useChangesSidebarStore"
import { cn } from "@/lib/utils"

const LazyChangesPage = lazy(() =>
  import("@/features/projects/pages/ChangesPage").then((module) => ({
    default: module.ChangesPage,
  })),
)

const sidebarSuspenseFallback = (
  <div className="h-full bg-background" aria-hidden="true" />
)

interface ChangesSidebarProps {
  projectPath: string | null
}

export const ChangesSidebar = memo(function ChangesSidebar(props: ChangesSidebarProps) {
  const isOpen = useChangesSidebarStore((state) => state.isOpen)
  const width = useChangesSidebarStore((state) => state.width)
  const minWidth = useChangesSidebarStore((state) => state.minWidth)
  const sidebarActions = useChangesSidebarStore((state) => state.actions)

  const sidebarRef = useRef<HTMLElement | null>(null)
  const [isResizing, setIsResizing] = useState(false)
  const [titleContent, setTitleContent] = useState<ReactNode>(null)
  const [controlsNode, setControlsNode] = useState<ReactNode>(null)

  const handleResizePointerDown = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      setIsResizing(true)

      const sidebarElement = sidebarRef.current
      const initialRightEdge =
        sidebarElement?.getBoundingClientRect().right ?? event.clientX

      const handlePointerMove = (moveEvent: PointerEvent) => {
        const nextWidth = initialRightEdge - moveEvent.clientX
        sidebarActions.setWidth(nextWidth)
      }

      const handlePointerUp = () => {
        setIsResizing(false)
        window.removeEventListener("pointermove", handlePointerMove)
        window.removeEventListener("pointerup", handlePointerUp)
        window.removeEventListener("pointercancel", handlePointerUp)
      }

      window.addEventListener("pointermove", handlePointerMove)
      window.addEventListener("pointerup", handlePointerUp)
      window.addEventListener("pointercancel", handlePointerUp)
    },
    [sidebarActions],
  )

  useEffect(() => {
    if (!isResizing) return
    const previousCursor = document.body.style.cursor
    const previousUserSelect = document.body.style.userSelect
    document.body.style.cursor = "col-resize"
    document.body.style.userSelect = "none"
    return () => {
      document.body.style.cursor = previousCursor
      document.body.style.userSelect = previousUserSelect
    }
  }, [isResizing])

  const handleMinimumWidthChange = useCallback(
    (nextMinimumWidth: number) => {
      sidebarActions.setMinWidth(nextMinimumWidth)
    },
    [sidebarActions],
  )

  if (!isOpen) {
    return null
  }

  return (
    <aside
      ref={sidebarRef}
      style={{ width, minWidth }}
      className="relative flex h-full shrink-0 flex-col border-l border-border/60 bg-background"
      data-workbench-changes-sidebar="true"
    >
      <div
        role="separator"
        aria-orientation="vertical"
        aria-label="Resize changes sidebar"
        onPointerDown={handleResizePointerDown}
        className={cn(
          "absolute -left-1 top-0 z-10 h-full w-2 cursor-col-resize select-none",
          "before:pointer-events-none before:absolute before:left-1/2 before:top-0 before:h-full before:w-px before:-translate-x-1/2",
          isResizing ? "before:bg-primary/60" : "before:bg-transparent hover:before:bg-border",
        )}
      />

      <header className="flex h-9 shrink-0 items-center gap-1 border-b border-border/60 px-2">
        {titleContent ? <div className="flex shrink-0 items-center">{titleContent}</div> : null}
        <div className="flex min-w-0 flex-1 items-center">
          {controlsNode}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        <Suspense fallback={sidebarSuspenseFallback}>
          <LazyChangesPage
            presentation="embedded"
            projectPath={props.projectPath}
            onRequestClose={sidebarActions.close}
            setChromeTitleContent={setTitleContent}
            setChromeControlsNode={setControlsNode}
            setDockviewMinimumWidth={handleMinimumWidthChange}
          />
        </Suspense>
      </div>
    </aside>
  )
})
