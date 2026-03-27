import * as React from "react"
import { Tooltip as BaseTooltip } from "@base-ui/react"

import { cn } from "@/lib/utils"

function TooltipProvider({ children }: { children: React.ReactNode }) {
  return <>{children}</>
}

function Tooltip({ ...props }: React.ComponentProps<typeof BaseTooltip.Root>) {
  return <BaseTooltip.Root {...props} />
}

function TooltipTrigger({ asChild, ...props }: React.ComponentProps<typeof BaseTooltip.Trigger> & { asChild?: boolean }) {
  // Base UI Tooltip.Trigger acts as a wrapper by default and doesn't need asChild in the same way,
  // but if it expects a render prop for children we can just pass props through.
  return <BaseTooltip.Trigger {...props} />
}

function TooltipContent({
  className,
  children,
  side,
  sideOffset,
  ...props
}: React.ComponentProps<typeof BaseTooltip.Popup> & { side?: string; sideOffset?: number }) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side as any} sideOffset={sideOffset}>
        <BaseTooltip.Popup
          className={cn(
            "bg-secondary text-secondary-foreground z-50 w-fit rounded-md px-3 py-1.5 text-xs text-balance shadow-lg",
            className
          )}
          {...props}
        >
          {children}
          <BaseTooltip.Arrow className="bg-secondary fill-secondary z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px]" />
        </BaseTooltip.Popup>
      </BaseTooltip.Positioner>
    </BaseTooltip.Portal>
  )
}

export { Tooltip, TooltipTrigger, TooltipContent, TooltipProvider }
