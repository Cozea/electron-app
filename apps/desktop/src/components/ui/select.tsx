

import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon as __CheckIconHugeIcon, ChevronDoubleCloseIcon as __ChevronDownIconHugeIcon, ChevronDoubleCloseIcon as __ChevronUpIconHugeIcon } from '@hugeicons/core-free-icons'


import * as React from "react"
import { Select as BaseSelect } from "@base-ui/react"

import { cn } from "@/lib/utils"

interface SelectProps extends Omit<React.ComponentProps<typeof BaseSelect.Root>, 'value' | 'defaultValue' | 'onValueChange' | 'onOpenChange'> {
  value?: string
  defaultValue?: string
  onValueChange?: (value: string) => void
  onOpenChange?: (open: boolean) => void
}

function Select({ onValueChange, onOpenChange, ...props }: SelectProps) {
  return (
    <BaseSelect.Root
      data-slot="select"
      onValueChange={(value) => onValueChange?.(value as string)}
      onOpenChange={(open, _details) => onOpenChange?.(open)}
      {...props}
    />
  )
}

function SelectGroup({ ...props }: React.ComponentProps<typeof BaseSelect.Group>) {
  return <BaseSelect.Group data-slot="select-group" {...props} />
}

function SelectValue({ ...props }: React.ComponentProps<typeof BaseSelect.Value>) {
  return <BaseSelect.Value data-slot="select-value" {...props} />
}

function SelectTrigger({
  className,
  size = "default",
  children,
  asChild,
  ...props
}: React.ComponentProps<typeof BaseSelect.Trigger> & {
  size?: "sm" | "default"
  asChild?: boolean
}) {
  if (asChild) {
    return (
      <BaseSelect.Trigger
        data-slot="select-trigger"
        render={children as any}
        {...props}
      />
    )
  }

  return (
    <BaseSelect.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "data-[placeholder]:text-muted-foreground relative flex w-fit cursor-pointer items-center justify-between gap-2 rounded-lg border border-input bg-popover not-dark:bg-clip-padding px-[calc(--spacing(3)-1px)] text-sm text-foreground whitespace-nowrap shadow-xs/5 transition-shadow outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] not-disabled:not-active:before:shadow-[0_1px_--theme(--color-black/4%)] focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background aria-invalid:border-destructive aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-64 disabled:shadow-none dark:bg-input/32 dark:not-disabled:before:shadow-[0_-1px_--theme(--color-white/6%)] hover:bg-accent/50 dark:hover:bg-input/64 data-[size=default]:h-9 sm:data-[size=default]:h-8 data-[size=sm]:h-8 sm:data-[size=sm]:h-7 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <HugeiconsIcon icon={__ChevronDownIconHugeIcon} className="-mr-0.5 size-4 opacity-80" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  /**
   * Base UI puts the selected item over the trigger, macOS style. Pass false
   * for a form field, where a dropdown below the control reads better and the
   * popup can match the field's width.
   */
  alignItemWithTrigger,
  style,
  ...props
}: React.ComponentProps<typeof BaseSelect.Popup> & {
  position?: string
  align?: string
  alignItemWithTrigger?: boolean
}) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner
        align={align as any}
        sideOffset={4}
        alignItemWithTrigger={alignItemWithTrigger}
        className="z-[var(--cozea-layer-menu)]"
      >
        <BaseSelect.Popup
          data-slot="select-content"
          className={cn(
            "titlebar-no-drag relative flex min-w-32 flex-col origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] dark:before:shadow-[0_-1px_--theme(--color-white/6%)]",
            className
          )}
          style={style}
          {...props}
        >
          <SelectScrollUpButton />
          <div
            className={cn(
              "app-scrollbar max-h-[min(24rem,var(--available-height))] w-full overflow-y-auto p-1",
              position === "popper" && "scroll-my-1"
            )}
            style={{ scrollbarGutter: "auto" }}
          >
            {children}
          </div>
          <SelectScrollDownButton />
        </BaseSelect.Popup>
      </BaseSelect.Positioner>
    </BaseSelect.Portal>
  )
}

function SelectLabel({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelect.GroupLabel>) {
  return (
    <BaseSelect.GroupLabel
      data-slot="select-label"
      className={cn("text-muted-foreground px-2 py-1.5 text-xs", className)}
      {...props}
    />
  )
}

function SelectItem({
  className,
  children,
  ...props
}: React.ComponentProps<typeof BaseSelect.Item>) {
  return (
    <BaseSelect.Item
      data-slot="select-item"
      className={cn(
        "data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground focus:bg-accent focus:text-accent-foreground relative flex w-full min-h-7 cursor-default items-center gap-2 rounded-sm py-1 pr-8 pl-2 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
        className
      )}
      {...props}
    >
      <span
        data-slot="select-item-indicator"
        className="absolute right-2 flex size-3.5 items-center justify-center"
      >
        <BaseSelect.ItemIndicator>
          <HugeiconsIcon icon={__CheckIconHugeIcon} className="size-4" />
        </BaseSelect.ItemIndicator>
      </span>
      <BaseSelect.ItemText>{children}</BaseSelect.ItemText>
    </BaseSelect.Item>
  )
}

function SelectSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelect.Separator>) {
  return (
    <BaseSelect.Separator
      data-slot="select-separator"
      className={cn("bg-border pointer-events-none mx-2 my-1 h-px", className)}
      {...props}
    />
  )
}

function SelectScrollUpButton({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelect.ScrollUpArrow>) {
  return (
    <BaseSelect.ScrollUpArrow
      data-slot="select-scroll-up-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={__ChevronUpIconHugeIcon} className="size-4" />
    </BaseSelect.ScrollUpArrow>
  )
}

function SelectScrollDownButton({
  className,
  ...props
}: React.ComponentProps<typeof BaseSelect.ScrollDownArrow>) {
  return (
    <BaseSelect.ScrollDownArrow
      data-slot="select-scroll-down-button"
      className={cn(
        "flex cursor-default items-center justify-center py-1",
        className
      )}
      {...props}
    >
      <HugeiconsIcon icon={__ChevronDownIconHugeIcon} className="size-4" />
    </BaseSelect.ScrollDownArrow>
  )
}

export {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectLabel,
  SelectScrollDownButton,
  SelectScrollUpButton,
  SelectSeparator,
  SelectTrigger,
  SelectValue,
}
