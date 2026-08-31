import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  PointerEvent as ReactPointerEvent,
} from "react"

import { cn } from "@/lib/utils"

import {
  BROWSER_VIEWPORT_RESIZE_RAIL_SIZE,
  type BrowserViewportLayout,
  type BrowserViewportResizeDirection,
} from "./browserViewportLayout"

interface BrowserViewportResizeHandlesProps {
  readonly layout: BrowserViewportLayout
  readonly activeDirection: BrowserViewportResizeDirection | null
  readonly onPointerDown: (
    direction: BrowserViewportResizeDirection,
    event: ReactPointerEvent<HTMLButtonElement>,
  ) => void
  readonly onKeyDown: (
    direction: BrowserViewportResizeDirection,
    event: ReactKeyboardEvent<HTMLButtonElement>,
  ) => void
}

type HandleKind = "horizontal" | "vertical" | "corner"

const EDGE_BUTTON_CLASS =
  "group absolute z-20 touch-none border-0 bg-transparent p-0 outline-none before:absolute before:-inset-1 before:content-[''] focus-visible:bg-foreground/[0.04]"
const EDGE_GRIP_CLASS =
  "pointer-events-none absolute left-1/2 top-1/2 flex -translate-x-1/2 -translate-y-1/2 items-center justify-center text-muted-foreground/55 transition-colors duration-150 group-hover:text-foreground/85 group-focus-visible:text-foreground group-active:text-foreground"

function ResizeHandle(props: {
  readonly direction: BrowserViewportResizeDirection
  readonly label: string
  readonly kind: HandleKind
  readonly cursorClassName: string
  readonly style: CSSProperties
  readonly active: boolean
  readonly mirrorCorner?: boolean
  readonly onPointerDown: BrowserViewportResizeHandlesProps["onPointerDown"]
  readonly onKeyDown: BrowserViewportResizeHandlesProps["onKeyDown"]
}) {
  return (
    <button
      type="button"
      aria-label={`${props.label}. Use arrow keys to resize.`}
      className={cn(EDGE_BUTTON_CLASS, props.kind === "corner" && "z-30", props.cursorClassName)}
      style={props.style}
      onPointerDown={(event) => props.onPointerDown(props.direction, event)}
      onKeyDown={(event) => props.onKeyDown(props.direction, event)}
    >
      <span
        className={cn(
          EDGE_GRIP_CLASS,
          props.kind === "vertical" && "h-8 w-1.5",
          props.kind === "horizontal" && "h-1.5 w-8",
          props.kind === "corner" && "size-3",
          props.active && "text-foreground",
        )}
      >
        {props.kind === "vertical" ? (
          <span className="flex gap-px" aria-hidden="true">
            <span className="h-6 w-px rounded-full bg-current" />
            <span className="h-6 w-px rounded-full bg-current" />
          </span>
        ) : props.kind === "horizontal" ? (
          <span className="flex flex-col gap-px" aria-hidden="true">
            <span className="h-px w-6 rounded-full bg-current" />
            <span className="h-px w-6 rounded-full bg-current" />
          </span>
        ) : (
          <span
            className={cn("relative block size-3", props.mirrorCorner && "-scale-x-100")}
            aria-hidden="true"
          >
            <span className="absolute bottom-[3px] left-0 h-px w-3 -rotate-45 rounded-full bg-current" />
            <span className="absolute bottom-0 left-[5px] h-px w-2 -rotate-45 rounded-full bg-current" />
          </span>
        )}
      </span>
    </button>
  )
}

export function BrowserViewportResizeHandles({
  layout,
  activeDirection,
  onPointerDown,
  onKeyDown,
}: BrowserViewportResizeHandlesProps) {
  const left = layout.viewportX
  const top = layout.viewportY
  const right = left + layout.viewportWidth
  const bottom = top + layout.viewportHeight
  const railSize = BROWSER_VIEWPORT_RESIZE_RAIL_SIZE
  const common = { onPointerDown, onKeyDown }
  return (
    <>
      <ResizeHandle
        direction="west"
        label="Resize browser viewport from left edge"
        kind="vertical"
        cursorClassName="cursor-ew-resize"
        style={{ left: left - railSize, top, width: railSize, height: layout.viewportHeight }}
        active={activeDirection === "west"}
        {...common}
      />
      <ResizeHandle
        direction="east"
        label="Resize browser viewport from right edge"
        kind="vertical"
        cursorClassName="cursor-ew-resize"
        style={{ left: right, top, width: railSize, height: layout.viewportHeight }}
        active={activeDirection === "east"}
        {...common}
      />
      <ResizeHandle
        direction="south"
        label="Resize browser viewport from bottom edge"
        kind="horizontal"
        cursorClassName="cursor-ns-resize"
        style={{ left, top: bottom, width: layout.viewportWidth, height: railSize }}
        active={activeDirection === "south"}
        {...common}
      />
      <ResizeHandle
        direction="southwest"
        label="Resize browser viewport from bottom-left corner"
        kind="corner"
        cursorClassName="cursor-nesw-resize"
        style={{ left: left - railSize, top: bottom, width: railSize, height: railSize }}
        active={activeDirection === "southwest"}
        mirrorCorner
        {...common}
      />
      <ResizeHandle
        direction="southeast"
        label="Resize browser viewport from bottom-right corner"
        kind="corner"
        cursorClassName="cursor-nwse-resize"
        style={{ left: right, top: bottom, width: railSize, height: railSize }}
        active={activeDirection === "southeast"}
        {...common}
      />
    </>
  )
}
