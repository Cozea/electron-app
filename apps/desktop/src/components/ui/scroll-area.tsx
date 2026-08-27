import * as React from "react"

import { cn } from "@/lib/utils"

const ScrollArea = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div">
>(({ className, children, ...props }, ref) => (
  <div
    ref={ref}
    data-slot="scroll-area-root"
    className={cn("overflow-auto", className)}
    {...props}
  >
    {children}
  </div>
))
ScrollArea.displayName = "ScrollArea"

const ScrollBar = React.forwardRef<
  HTMLDivElement,
  React.ComponentPropsWithoutRef<"div"> & { orientation?: "vertical" | "horizontal" }
>(({ className, orientation = "vertical" }, ref) => (
  <div
    ref={ref}
    style={{ display: 'none' }}
    className={className}
    data-orientation={orientation}
  />
))
ScrollBar.displayName = "ScrollBar"

export { ScrollArea, ScrollBar }
