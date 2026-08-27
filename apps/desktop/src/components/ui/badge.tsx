import * as React from "react"
import { Slot } from "@radix-ui/react-slot"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  "relative inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap rounded-sm border border-transparent font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button&,a&]:cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-primary text-primary-foreground [button&,a&]:hover:bg-primary/90",
        secondary:
          "bg-secondary text-secondary-foreground [button&,a&]:hover:bg-secondary/90",
        destructive:
          "bg-destructive text-white [button&,a&]:hover:bg-destructive/90",
        error:
          "bg-destructive/8 text-destructive dark:bg-destructive/16",
        success:
          "bg-success/8 text-success dark:bg-success/16",
        outline:
          "border-input bg-background text-foreground dark:bg-input/32 [button&,a&]:hover:bg-accent/50 dark:[button&,a&]:hover:bg-input/48",
      },
      size: {
        default: "h-4.5 min-w-4.5 px-[calc(--spacing(1)-1px)] text-sm",
        sm: "h-4 min-w-4 rounded-[.25rem] px-[calc(--spacing(1)-1px)] text-xs",
        lg: "h-5.5 min-w-5.5 px-[calc(--spacing(1.5)-1px)] text-sm",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Badge({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: React.ComponentProps<"span"> &
  VariantProps<typeof badgeVariants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "span"

  return (
    <Comp
      data-slot="badge"
      className={cn(badgeVariants({ variant, size }), className)}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
