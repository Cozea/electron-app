import { Activity, type ReactNode } from "react"

import { cn } from "@/lib/utils"

interface WorkbenchActivityProps {
  mode: "visible" | "hidden"
  name: string
  children: ReactNode
}

/**
 * Keep-alive slot for a mounted workbench session.
 *
 * React 19.2 `<Activity mode="hidden">` unmounts effects. That would dispose
 * dockview and force xterm to park/rebuild, which is the opposite of a
 * project-switch keep-alive. We keep Activity at `mode="visible"` so widget
 * effects stay alive, and hide inactive sessions with CSS that descendants
 * cannot override.
 *
 * Do not use `visibility: hidden` here. Dockview (and some tiles) set
 * `visibility: visible` on panels; that property is allowed to opt a
 * descendant back into painting even when an ancestor is hidden. Combined
 * with the workbench's transparent dock canvas, the parked session then
 * shows through tile sashes and translucent chrome.
 *
 * Hide with `opacity: 0` (group-level, non-overridable) and keep the laid-out
 * size so dockview/xterm do not collapse to 0×0. Do not use `clip-path`:
 * dockview measures visible bounds and will serialize/relayout a clipped
 * grid as equal columns. The active slot paints an opaque `bg-background`
 * so a parked session cannot show through tile gaps even if it still
 * composites.
 */
export function WorkbenchActivity({ mode, name, children }: WorkbenchActivityProps) {
  const hidden = mode === "hidden"

  return (
    <Activity mode="visible" name={name}>
      <div
        data-workbench-activity={mode}
        aria-hidden={hidden}
        inert={hidden || undefined}
        className={cn(
          "min-h-0 min-w-0",
          hidden
            ? "pointer-events-none absolute inset-0 overflow-hidden"
            : "relative h-full w-full bg-background",
        )}
        style={hidden ? { opacity: 0, zIndex: 0 } : { zIndex: 1 }}
      >
        {children}
      </div>
    </Activity>
  )
}
