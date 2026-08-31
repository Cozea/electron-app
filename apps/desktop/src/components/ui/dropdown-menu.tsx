

import { HugeiconsIcon } from '@hugeicons/react'
import { CheckmarkCircle02Icon as __CheckIconHugeIcon, ChevronDoubleCloseIcon as __ChevronRightIconHugeIcon, MinusSignIcon as __CircleIconHugeIcon } from '@hugeicons/core-free-icons'


import * as React from 'react'
import { Menu as BaseMenu } from '@base-ui/react'

import { cn } from '@/lib/utils'

const dropdownMenuPopupClassName =
  'titlebar-no-drag relative flex min-w-32 origin-(--transform-origin) rounded-lg border bg-popover not-dark:bg-clip-padding text-popover-foreground shadow-lg/5 outline-none before:pointer-events-none before:absolute before:inset-0 before:rounded-[calc(var(--radius-lg)-1px)] before:shadow-[0_1px_--theme(--color-black/4%)] focus:outline-none dark:before:shadow-[0_-1px_--theme(--color-white/6%)]'

const dropdownMenuInteractiveItemClassName =
  'data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground focus:bg-accent focus:text-accent-foreground transition-colors'

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
      <BaseMenu.Trigger
        data-slot="dropdown-menu-trigger"
        render={children as any}
        {...props}
      />
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
      <BaseMenu.Positioner
        side={side as any}
        align={align as any}
        sideOffset={sideOffset}
        className="z-50"
      >
        <BaseMenu.Popup
          data-slot="dropdown-menu-content"
          className={cn(dropdownMenuPopupClassName, className)}
          style={style}
          {...props}
        >
          <div
            className="app-scrollbar max-h-[min(24rem,var(--available-height))] w-full overflow-y-auto p-1"
            style={{ scrollbarGutter: 'auto' }}
          >
            {children}
          </div>
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
        "data-[variant=destructive]:text-destructive data-[variant=destructive]:data-[highlighted]:text-destructive data-[variant=destructive]:focus:text-destructive data-[variant=destructive]:data-[highlighted]:bg-destructive/8 dark:data-[variant=destructive]:data-[highlighted]:bg-destructive/16 data-[variant=destructive]:focus:bg-destructive/8 dark:data-[variant=destructive]:focus:bg-destructive/16 data-[variant=destructive]:*:[svg]:!text-destructive flex min-h-7 cursor-default items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-64 data-[inset]:pl-8 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
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
        "relative flex min-h-7 cursor-default items-center gap-2 rounded-sm py-1 pr-4 pl-8 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      checked={checked}
      onClick={(e) => {
        onClick?.(e)
        onSelect?.(e.nativeEvent)
      }}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <BaseMenu.CheckboxItemIndicator>
          <HugeiconsIcon icon={__CheckIconHugeIcon} className="size-4" />
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
        "relative flex min-h-7 cursor-default items-center gap-2 rounded-sm py-1 pr-4 pl-8 text-sm outline-none select-none data-[disabled]:pointer-events-none data-[disabled]:opacity-64 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      onClick={(e) => {
        onClick?.(e)
        onSelect?.(e.nativeEvent)
      }}
      {...props}
    >
      <span className="pointer-events-none absolute left-2 flex size-4 items-center justify-center">
        <BaseMenu.RadioItemIndicator>
          <HugeiconsIcon icon={__CircleIconHugeIcon} className="size-2 fill-current" />
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
      className={cn('px-2 py-1.5 font-normal text-muted-foreground text-xs data-[inset]:pl-8', className)}
      role="presentation"
      {...props}
    />
  )
}

function DropdownMenuSeparator({
  className,
  ...props
}: React.ComponentProps<typeof BaseMenu.Separator>) {
  return (
    <BaseMenu.Separator
      data-slot="dropdown-menu-separator"
      className={cn('mx-2 my-1 h-px bg-border', className)}
      {...props}
    />
  )
}

function DropdownMenuShortcut({
  className,
  ...props
}: React.ComponentProps<'span'>) {
  return (
    <span
      data-slot="dropdown-menu-shortcut"
      className={cn('ml-auto font-normal text-muted-foreground/72 text-xs tracking-widest', className)}
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
        "data-[popup-open]:bg-accent data-[popup-open]:text-accent-foreground flex min-h-7 cursor-default items-center gap-2 rounded-sm px-2 py-1 text-sm outline-none select-none data-[inset]:pl-8 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    >
      {children}
      <HugeiconsIcon icon={__ChevronRightIconHugeIcon} className="-mr-0.5 ml-auto size-4 opacity-80" />
    </BaseMenu.SubmenuTrigger>
  )
}

function DropdownMenuSubContent({
  className,
  sideOffset = 0,
  children,
  ...props
}: React.ComponentProps<typeof BaseMenu.Popup> & { sideOffset?: number }) {
  return (
    <BaseMenu.Portal>
      <BaseMenu.Positioner side="right" sideOffset={sideOffset} className="z-50">
        <BaseMenu.Popup
          data-slot="dropdown-menu-sub-content"
          className={cn(dropdownMenuPopupClassName, className)}
          {...props}
        >
          <div className="app-scrollbar max-h-[min(24rem,var(--available-height))] w-full overflow-y-auto p-1">
            {children}
          </div>
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
