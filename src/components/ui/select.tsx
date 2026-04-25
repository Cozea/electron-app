

import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon as __CheckIconHugeIcon, ChevronDoubleCloseIcon as __ChevronDownIconHugeIcon, ChevronDoubleCloseIcon as __ChevronUpIconHugeIcon } from '@hugeicons/core-free-icons'

"use client"

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
    return <BaseSelect.Trigger data-slot="select-trigger" render={children as any} {...props} />
  }

  return (
    <BaseSelect.Trigger
      data-slot="select-trigger"
      data-size={size}
      className={cn(
        "data-[placeholder]:text-muted-foreground [&_svg:not([class*='text-'])]:text-muted-foreground focus-visible:ring-ring/50 aria-invalid:ring-destructive/20 dark:aria-invalid:ring-destructive/40 flex w-fit items-center justify-between gap-2 rounded-full bg-secondary px-3 py-2 text-sm whitespace-nowrap transition-[color,box-shadow] outline-none focus-visible:ring-[3px] disabled:cursor-not-allowed disabled:opacity-50 data-[size=default]:h-9 data-[size=sm]:h-8 *:data-[slot=select-value]:line-clamp-1 *:data-[slot=select-value]:flex *:data-[slot=select-value]:items-center *:data-[slot=select-value]:gap-2 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <BaseSelect.Icon>
        <HugeiconsIcon icon={__ChevronDownIconHugeIcon} className="size-4 opacity-50" />
      </BaseSelect.Icon>
    </BaseSelect.Trigger>
  )
}

function SelectContent({
  className,
  children,
  position = "item-aligned",
  align = "center",
  style,
  ...props
}: React.ComponentProps<typeof BaseSelect.Popup> & { position?: string; align?: string }) {
  return (
    <BaseSelect.Portal>
      <BaseSelect.Positioner align={align as any} sideOffset={4}>
        <BaseSelect.Popup
          data-native-surface-overlay="true"
          data-native-surface-overlay-reason="Select menu"
          data-slot="select-content"
          className={cn(
            "app-scrollbar bg-secondary text-secondary-foreground relative z-50 max-h-[min(24rem,80vh)] min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-md shadow-xl outline-hidden",
            className
          )}
          style={{
            scrollbarGutter: "auto",
            ...style,
          }}
          {...props}
        >
          <SelectScrollUpButton />
          <div
            className={cn(
              "p-1",
              position === "popper" &&
                "h-[var(--radix-select-trigger-height)] w-full min-w-[var(--radix-select-trigger-width)] scroll-my-1"
            )}
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
        "focus:bg-accent focus:text-accent-foreground [&_svg:not([class*='text-'])]:text-muted-foreground relative flex w-full cursor-default items-center gap-2 rounded-sm py-1.5 pr-8 pl-2 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4 *:[span]:last:flex *:[span]:last:items-center *:[span]:last:gap-2",
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
      className={cn("bg-border pointer-events-none -mx-1 my-1 h-px", className)}
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
