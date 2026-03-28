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
  side,
  align,
  sideOffset,
  ...props
}: React.ComponentProps<typeof BaseTooltip.Popup> & { side?: string; align?: string; sideOffset?: number }) {
  return (
    <BaseTooltip.Portal>
      <BaseTooltip.Positioner side={side as any} align={align as any} sideOffset={sideOffset}>
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
