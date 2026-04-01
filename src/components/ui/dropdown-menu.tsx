"use client"

import * as React from 'react'
import { Menu as BaseMenu } from '@base-ui/react'
import { CheckIcon, ChevronRightIcon, CircleIcon } from 'lucide-react'

import { cn } from '@/lib/utils'

const dropdownMenuInteractiveItemClassName =
  'data-[highlighted]:bg-foreground/10 dark:data-[highlighted]:bg-foreground/16 data-[highlighted]:text-foreground focus:bg-foreground/10 dark:focus:bg-foreground/16 focus:text-foreground transition-colors'

function DropdownMenu({ ...props }: React.ComponentProps<typeof BaseMenu.Root>) {
  return <BaseMenu.Root data-slot="dropdown-menu" {...props} />
}

function DropdownMenuPortal({ ...props }: React.ComponentProps<typeof BaseMenu.Portal>) {
  return <BaseMenu.Portal data-slot="dropdown-menu-portal" {...props} />
}

function DropdownMenuTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.Trigger> & { asChild?: boolean }) {
  if (asChild) {
    return (
      <BaseMenu.Trigger data-slot="dropdown-menu-trigger" render={children as any} {...props} />
    )
  }

  return (
    <BaseMenu.Trigger data-slot="dropdown-menu-trigger" {...props}>
      {children}
    </BaseMenu.Trigger>
  )
}

function DropdownMenuContent({
  className,
  sideOffset = 4,
  align,
  side,
  style,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.Popup> & {
  sideOffset?: number
  align?: string
  side?: string
}) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side={side as any} align={align as any} sideOffset={sideOffset}>
        <BaseMenu.Popup
          data-slot="dropdown-menu-content"
          className={cn(
            'titlebar-no-drag app-scrollbar bg-secondary text-secondary-foreground z-50 max-h-[min(24rem,80vh)] min-w-[8rem] overflow-x-hidden overflow-y-auto rounded-[1.25rem] p-1 shadow-xl outline-hidden',
            className
          )}
          style={{
            scrollbarGutter: 'auto',
            ...style,
          }}
          {...props}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

function DropdownMenuGroup({ ...props }: React.ComponentProps<typeof BaseMenu.Group>) {
  return <BaseMenu.Group data-slot="dropdown-menu-group" {...props} />
}

function DropdownMenuItem({
  className,
  inset,
  variant = 'default',
  children,
  onSelect,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof BaseMenu.Item>, 'onSelect' | 'onClick'> & {
  inset?: boolean
  variant?: 'default' | 'destructive'
  onSelect?: (event: Event) => void
  onClick?: React.MouseEventHandler<HTMLDivElement>
}) {
  return (
    <BaseMenu.Item
      data-slot="dropdown-menu-item"
      data-inset={inset}
      data-variant={variant}
      className={cn(
        dropdownMenuInteractiveItemClassName,
        "data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/12 dark:data-[variant=destructive]:focus:bg-destructive/22 data-[variant=destructive]:data-[highlighted]:bg-destructive/12 dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/22 data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:data-[highlighted]:text-destructive data-[variant=destructive]:*:[svg]:!text-destructive [&_svg:not([class*='text-'])]:text-muted-foreground relative flex cursor-default items-center gap-2 rounded-[1rem] px-2 py-1.5 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      onClick={(e) => {
        onClick?.(e)
        onSelect?.(e.nativeEvent)
      }}
      {...props}
    >
      {children}
    </BaseMenu.Item>
  )
}

function DropdownMenuCheckboxItem({
  className,
  children,
  checked,
  onSelect,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof BaseMenu.CheckboxItem>, 'onSelect' | 'onClick'> & {
  onSelect?: (e: Event) => void
  onClick?: React.MouseEventHandler<HTMLDivElement>
}) {
  return (
    <BaseMenu.CheckboxItem
      data-slot="dropdown-menu-checkbox-item"
      className={cn(
        dropdownMenuInteractiveItemClassName,
        "relative flex cursor-default items-center gap-2 rounded-[1rem] py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      onClick={(e) => {
        onClick?.(e)
        onSelect?.(e.nativeEvent)
      }}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <BaseMenu.CheckboxItemIndicator>
          <CheckIcon className="size-4" />
        </BaseMenu.CheckboxItemIndicator>
      </span>
      {children}
    </BaseMenu.CheckboxItem>
  )
}

function DropdownMenuRadioGroup({ ...props }: React.ComponentProps<typeof BaseMenu.RadioGroup>) {
  return <BaseMenu.RadioGroup data-slot="dropdown-menu-radio-group" {...props} />
}

function DropdownMenuRadioItem({
  className,
  children,
  onSelect,
  onClick,
  ...props
}: Omit<React.ComponentProps<typeof BaseMenu.RadioItem>, 'onSelect' | 'onClick'> & {
  onSelect?: (e: Event) => void
  onClick?: React.MouseEventHandler<HTMLDivElement>
}) {
  return (
    <BaseMenu.RadioItem
      data-slot="dropdown-menu-radio-item"
      className={cn(
        dropdownMenuInteractiveItemClassName,
        "relative flex cursor-default items-center gap-2 rounded-[1rem] py-1.5 pr-2 pl-8 text-sm outline-hidden select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-50 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      onClick={(e) => {
        onClick?.(e)
        onSelect?.(e.nativeEvent)
      }}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-3.5 items-center justify-center">
        <BaseMenu.RadioItemIndicator>
          <CircleIcon className="size-2 fill-current" />
        </BaseMenu.RadioItemIndicator>
      </span>
      {children}
    </BaseMenu.RadioItem>
  )
}

function DropdownMenuLabel({
  className,
  inset,
  ...props
}: React.ComponentProps<'div'> & {
  inset?: boolean
}) {
  return (
    <div
      data-slot="dropdown-menu-label"
      data-inset={inset}
      className={cn('px-2 py-1.5 text-sm font-medium data-[inset]:pl-8', className)}
      role="presentation"
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenu.Separator>) {
  return <BaseMenu.Separator data-slot="dropdown-menu-separator" className={cn('hidden', className)} {...props} />
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('text-muted-foreground ml-auto text-xs tracking-widest', className)}
      {...props}
    />
  )
}

function DropdownMenuSub({ ...props }: React.ComponentProps<typeof BaseMenu.SubmenuRoot>) {
  return <BaseMenu.SubmenuRoot data-slot="dropdown-menu-sub" {...props} />
}

function DropdownMenuSubTrigger({
  className,
  inset,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.SubmenuTrigger> & {
  inset?: boolean
}) {
  return (
    <BaseMenu.SubmenuTrigger
      data-slot="dropdown-menu-sub-trigger"
      data-inset={inset}
      className={cn(
        dropdownMenuInteractiveItemClassName,
        "data-[popup-open]:bg-foreground/10 dark:data-[popup-open]:bg-foreground/16 data-[popup-open]:text-foreground [&_svg:not([class*='text-'])]:text-muted-foreground flex cursor-default items-center gap-2 rounded-[1rem] px-2 py-1.5 text-sm outline-hidden select-none data-[inset]:pl-8 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRightIcon className="ml-auto size-4" />
    </BaseMenu.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  sideOffset = 4,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.Popup> & { sideOffset?: number }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side="right" sideOffset={sideOffset}>
        <BaseMenu.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn(
            'titlebar-no-drag bg-secondary text-secondary-foreground z-50 min-w-[8rem] overflow-hidden rounded-[1.25rem] p-1 shadow-xl outline-hidden',
            className
          )}
          {...props}
        >
          {children}
        </BaseMenu.Popup>
      </BaseMenu.Positioner>
    </BaseMenu.Portal>
  )
}

export {
  DropdownMenu,
  DropdownMenuPortal,
  DropdownMenuTrigger,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuLabel,
  DropdownMenuItem,
  DropdownMenuCheckboxItem,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuSeparator,
  DropdownMenuShortcut,
  DropdownMenuSub,
  DropdownMenuSubTrigger,
  DropdownMenuSubContent,
}
