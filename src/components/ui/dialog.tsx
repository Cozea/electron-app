

import { HugeiconsIcon } from '@hugeicons/react'
import { Cancel01Icon as __XIconHugeIcon } from '@hugeicons/core-free-icons'

"use client"

import * as React from "react"
import { Dialog as BaseDialog } from "@base-ui/react"

import { cn } from "@/lib/utils"

function Dialog({ ...props }: React.ComponentProps<typeof BaseDialog.Root>) {
  return <BaseDialog.Root data-slot="dialog" {...props} />
}

function DialogTrigger({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof BaseDialog.Trigger> & { asChild?: boolean }) {
  if (asChild) {
    return <BaseDialog.Trigger data-slot="dialog-trigger" render={children as any} {...props} />
  }
  return <BaseDialog.Trigger data-slot="dialog-trigger" {...props}>{children}</BaseDialog.Trigger>
}

function DialogPortal({ ...props }: React.ComponentProps<typeof BaseDialog.Portal>) {
  return <BaseDialog.Portal data-slot="dialog-portal" {...props} />
}

function DialogClose({
  asChild,
  children,
  ...props
}: React.ComponentProps<typeof BaseDialog.Close> & { asChild?: boolean }) {
  if (asChild) {
    return <BaseDialog.Close data-slot="dialog-close" render={children as any} {...props} />
  }
  return <BaseDialog.Close data-slot="dialog-close" {...props}>{children}</BaseDialog.Close>
}

function DialogOverlay({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Backdrop>) {
  return (
    <BaseDialog.Backdrop
      data-native-surface-overlay="true"
      data-native-surface-overlay-reason="Dialog backdrop"
      data-slot="dialog-overlay"
      className={cn(
        "fixed inset-0 z-50 bg-black/50 transition-all",
        className
      )}
      {...props}
    />
  )
}

function DialogContent({
  className,
  children, showCloseButton = true,
  ...props
}: Omit<React.ComponentProps<typeof BaseDialog.Popup>, "children"> & {
  children?: React.ReactNode;
  showCloseButton?: boolean
}) {
  return (
    <DialogPortal data-slot="dialog-portal">
      <DialogOverlay />
      <BaseDialog.Popup
        data-slot="dialog-content"
        className={cn(
          "bg-background fixed top-[50%] left-[50%] z-50 grid w-full max-w-[calc(100%-2rem)] translate-x-[-50%] translate-y-[-50%] gap-4 rounded-3xl p-6 shadow-lg duration-200 outline-none sm:max-w-lg transition-all outline-hidden",
          className
        )}
        {...props}
      >
        {children}
        {showCloseButton && (
          <BaseDialog.Close
            data-slot="dialog-close"
            className="ring-offset-background focus:ring-ring data-[state=open]:bg-accent data-[state=open]:text-muted-foreground absolute top-4 right-4 rounded-xs opacity-70 transition-opacity hover:opacity-100 focus:ring-2 focus:ring-offset-2 focus:outline-hidden disabled:pointer-events-none [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4"
          >
            <HugeiconsIcon icon={__XIconHugeIcon} />
            <span className="sr-only">Close</span>
          </BaseDialog.Close>
        )}
      </BaseDialog.Popup>
    </DialogPortal>
  )
}

function DialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-header"
      className={cn("flex flex-col gap-2 text-center sm:text-left", className)}
      {...props}
    />
  )
}

function DialogFooter({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="dialog-footer"
      className={cn(
        "flex flex-col-reverse gap-2 sm:flex-row sm:justify-end",
        className
      )}
      {...props}
    />
  )
}

function DialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Title>) {
  return (
    <BaseDialog.Title
      data-slot="dialog-title"
      className={cn("text-lg leading-none font-semibold", className)}
      {...props}
    />
  )
}

function DialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof BaseDialog.Description>) {
  return (
    <BaseDialog.Description
      data-slot="dialog-description"
      className={cn("text-muted-foreground text-sm", className)}
      {...props}
    />
  )
}

export {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogOverlay,
  DialogPortal,
  DialogTitle,
  DialogTrigger,
}
