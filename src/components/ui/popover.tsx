import * as React from 'react'
import { Popover as BasePopover } from '@base-ui/react'

import { cn } from '@/lib/utils'

function Popover({ ...props }: React.ComponentProps<typeof BasePopover.Root>) {
  return <BasePopover.Root data-slot="popover" {...props} />
}

function PopoverTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof BasePopover.Trigger> & { asChild?: boolean }) {
  if (asChild) {
    return <BasePopover.Trigger data-slot="popover-trigger" render={children as any} {...props} />
  }

  return (
    <BasePopover.Trigger data-slot="popover-trigger" {...props}>
      {children}
    </BasePopover.Trigger>
  )
}

function PopoverContent({
  className,
  align = 'center',
  sideOffset = 4,
  side,
  children,
  ...props
}: React.ComponentProps<typeof BasePopover.Popup> & {
  align?: string
  sideOffset?: number
  side?: string
}) {
  return (
    <BasePopover.Portal>
      <BasePopover.Positioner side={side as any} align={align as any} sideOffset={sideOffset}>
        <BasePopover.Popup
          data-slot="popover-content"
          className={cn(
            'bg-secondary text-secondary-foreground z-50 w-72 rounded-md p-4 shadow-xl outline-hidden',
            className
          )}
          {...props}
        >
          {children}
        </BasePopover.Popup>
      </BasePopover.Positioner>
    </BasePopover.Portal>
  )
}

function PopoverAnchor({ children }: React.ComponentProps<'div'>) {
  return <>{children}</>
}

export { Popover, PopoverTrigger, PopoverContent, PopoverAnchor }
