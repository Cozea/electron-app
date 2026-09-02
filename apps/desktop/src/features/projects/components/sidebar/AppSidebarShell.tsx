import * as React from "react"

import {
  Sidebar,
  SidebarTrigger,
  useSidebar,
} from "@/components/ui/sidebar"
import { cn } from "@/lib/utils"

import {
  clampSidebarWidth,
  SIDEBAR_DEFAULT_WIDTH_PX,
  useSidebarWidthStore,
} from "./sidebarWidthStore"

/**
 * Single persistent sidebar chrome for the app shell. Route-mode switches
 * (project / settings / dev-app store) swap only the content inside; the
 * container, vibrancy surface, rail, and collapse state never remount, so
 * mode changes stop re-laying-out the boundary. The user-resized width is
 * shared across all surfaces — it's one sidebar.
 */
export type AppSidebarSurface = "project" | "settings" | "appStore" | "skills"

function ShellSidebarTrigger() {
  const { isMobile, state, openMobile } = useSidebar()
  const show = isMobile ? openMobile : state === "expanded"
  if (!show) return null
  return (
    <SidebarTrigger
      className={cn(
        "h-7 w-7 shrink-0 rounded-md",
        "text-muted-foreground/75 hover:bg-sidebar-accent hover:text-foreground",
      )}
    />
  )
}

const RESIZE_DRAG_THRESHOLD_PX = 3

/**
 * Replaces SidebarRail: drag resizes (persisted), a plain click still
 * toggles collapse. During the drag the CSS var is written imperatively
 * (no React re-render per frame) and width transitions are suspended via the
 * `sidebar-resizing` class; the store commit happens once on release.
 */
function SidebarResizeRail() {
  const { toggleSidebar, state, isMobile } = useSidebar()
  const setWidth = useSidebarWidthStore((store) => store.setWidth)
  const dragRef = React.useRef<{
    pointerId: number
    startX: number
    startWidth: number
    root: HTMLElement
    moved: boolean
    lastWidth: number
    frame: number | null
  } | null>(null)

  const canDrag = !isMobile && state === "expanded"

  const endDrag = (commit: boolean) => {
    const drag = dragRef.current
    if (!drag) return
    dragRef.current = null
    if (drag.frame !== null) cancelAnimationFrame(drag.frame)
    drag.root.classList.remove("sidebar-resizing")
    if (drag.moved) {
      if (commit) {
        setWidth(drag.lastWidth)
      } else {
        drag.root.style.setProperty("--sidebar-width", `${drag.startWidth}px`)
      }
      // Final sync point for layouts that don't observe the container.
      window.dispatchEvent(new Event("resize"))
    } else {
      toggleSidebar()
    }
  }

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Resize sidebar (click to toggle)"
      tabIndex={-1}
      title="Drag to resize, click to toggle"
      onPointerDown={(event) => {
        if (event.button !== 0) return
        if (!canDrag) return
        const root = (event.currentTarget as HTMLElement).closest<HTMLElement>('[data-slot="sidebar"]')
        if (!root) return
        const computed = getComputedStyle(root).getPropertyValue("--sidebar-width").trim()
        const startWidth = Number.parseFloat(computed) || SIDEBAR_DEFAULT_WIDTH_PX
        dragRef.current = {
          pointerId: event.pointerId,
          startX: event.clientX,
          startWidth,
          root,
          moved: false,
          lastWidth: startWidth,
          frame: null,
        }
        event.currentTarget.setPointerCapture(event.pointerId)
      }}
      onPointerMove={(event) => {
        const drag = dragRef.current
        if (!drag || event.pointerId !== drag.pointerId) return
        const delta = event.clientX - drag.startX
        if (!drag.moved && Math.abs(delta) < RESIZE_DRAG_THRESHOLD_PX) return
        if (!drag.moved) {
          drag.moved = true
          drag.root.classList.add("sidebar-resizing")
        }
        drag.lastWidth = clampSidebarWidth(drag.startWidth + delta)
        drag.root.style.setProperty("--sidebar-width", `${drag.lastWidth}px`)
        if (drag.frame === null) {
          drag.frame = requestAnimationFrame(() => {
            drag.frame = null
            window.dispatchEvent(new Event("resize"))
          })
        }
      }}
      onPointerUp={(event) => {
        if (dragRef.current && event.pointerId !== dragRef.current.pointerId) return
        if (!dragRef.current && !canDrag) {
          // Collapsed (or mobile): the rail is a plain expand/collapse toggle.
          toggleSidebar()
          return
        }
        endDrag(true)
      }}
      onPointerCancel={() => endDrag(false)}
      onKeyDown={(event) => {
        if (event.key === "Enter" || event.key === " ") {
          event.preventDefault()
          toggleSidebar()
        }
      }}
      className={cn(
        "hover:after:bg-sidebar-border absolute inset-y-0 z-20 hidden w-4 -translate-x-1/2 transition-all ease-linear group-data-[side=left]:-right-4 group-data-[side=right]:left-0 after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] sm:flex",
        canDrag
          ? "cursor-col-resize"
          : "in-data-[side=left]:cursor-e-resize in-data-[side=right]:cursor-w-resize",
        "hover:group-data-[collapsible=offcanvas]:bg-sidebar group-data-[collapsible=offcanvas]:translate-x-0 group-data-[collapsible=offcanvas]:after:left-full",
        "[[data-side=left][data-collapsible=offcanvas]_&]:-right-2",
        "[[data-side=right][data-collapsible=offcanvas]_&]:-left-2",
      )}
    />
  )
}

export function AppSidebarShell({
  className,
  children,
}: {
  /** Reserved for per-surface policy (e.g. collapsible mode) if it diverges. */
  surface: AppSidebarSurface
  className?: string
  children: React.ReactNode
}) {
  const storedWidth = useSidebarWidthStore((store) => store.width)
  const width = clampSidebarWidth(storedWidth ?? SIDEBAR_DEFAULT_WIDTH_PX)

  return (
    <Sidebar
      collapsible="offcanvas"
      windowChromeAware
      windowChromeEndAddon={<ShellSidebarTrigger />}
      rootClassName={cn("h-full min-w-0 overflow-hidden", className)}
      rootStyle={{ "--sidebar-width": `${width}px` } as React.CSSProperties}
      className="h-full min-w-0 z-20 sidebar-glass"
    >
      {children}
      <SidebarResizeRail />
    </Sidebar>
  )
}
