import * as React from "react"
import { Tooltip as BaseTooltip } from "@base-ui/react"

import { cn } from "@/lib/utils"

function TooltipProvider({ children }: { children: React.ReactNode; delayDuration?: number }) {
  return <>{children}</>
}

function Tooltip({ ...props }: React.ComponentProps<typeof BaseTooltip.Root>) {
  return <BaseTooltip.Root {...props} />
}

function TooltipTrigger({ asChild, children, ...props }: React.ComponentProps<typeof BaseTooltip.Trigger> & { asChild?: boolean }) {
  if (asChild) {
    return <BaseTooltip.Trigger render={children as any} {...props} />
  }
  return <BaseTooltip.Trigger {...props}>{children}</BaseTooltip.Trigger>
}

function TooltipContent({
  className,
  children,
  side = "top",
  align = "center",
  sideOffset = 4,
  ...props
}: React.ComponentProps<typeof BaseTooltip.Popup> & { side?: string; align?: string; sideOffset?: number }) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner
        side={side as any}
        align={align as any}
        sideOffset={sideOffset}
        className="z-50 max-w-(--available-width) transition-[top,left,right,bottom,transform] data-instant:transition-none"
      >
        <BaseTooltip.Popup
          className={cn(
            "relative z-50 w-fit origin-(--transform-origin) text-balance rounded-md border bg-popover not-dark:bg-clip-padding px-2 py-1 text-popover-foreground text-xs shadow-md/5 transition-[scale,opacity] before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-md)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] data-ending-style:scale-98 data-starting-style:scale-98 data-ending-style:opacity-0 data-starting-style:opacity-0 data-instant:duration-0 dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className
          )}
          {...props}
        >
          {children}
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
