import * as React from "react"
import { Popover as BasePopover } from "@base-ui/react/popover"

import { cn } from "@/lib/utils"

function Popover({ ...props }: React.ComponentProps<typeof BasePopover.Root>) {
  return <BasePopover.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof BasePopover.Trigger> & { asChild?: boolean }) {
  if (asChild) {
    return (
      <BasePopover.Trigger
        data-slot="popover-trigger"
        render={children as any}
        {...props}
      />
    )
  }

  return (
    <BasePopover.Trigger data-slot="popover-trigger" {...props}>
      {children}
    </BasePopover.Trigger>
  )
}

function PopoverPortal({ ...props }: React.ComponentProps<typeof BasePopover.Portal>) {
  return <BasePopover.Portal data-slot="popover-portal" {...props} />
}

function PopoverContent({
  className,
  align = "center",
  side = "bottom",
  sideOffset = 4,
  alignOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof BasePopover.Popup> & {
  align?: "start" | "center" | "end"
  side?: "top" | "bottom" | "left" | "right"
  sideOffset?: number
  alignOffset?: number
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner
        align={align}
        side={side}
        sideOffset={sideOffset}
        alignOffset={alignOffset}
        className="z-[var(--cozea-layer-menu)]"
      >
        <BasePopover.Popup
          data-slot="popover-content"
          className={cn(
            "titlebar-no-drag relative z-50 flex origin-(--transform-origin) rounded-lg border bg-popover text-popover-foreground shadow-lg/5 outline-none focus:outline-none",
            className,
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

export {
  Popover,
  PopoverTrigger,
  PopoverPortal,
  PopoverContent,
}
