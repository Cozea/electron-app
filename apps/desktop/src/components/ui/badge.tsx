"use client";

import * as React from "react";
import { mergeProps } from "@base-ui/react/merge-props";
import { useRender } from "@base-ui/react/use-render";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";

import { cn } from "@/lib/utils";

const badgeVariants = cva(
  "relative inline-flex w-fit shrink-0 items-center justify-center gap-1 overflow-hidden whitespace-nowrap border border-transparent font-medium outline-none transition-shadow focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background disabled:pointer-events-none disabled:opacity-64 [&_svg:not([class*='opacity-'])]:opacity-80 [&_svg:not([class*='size-'])]:size-3.5 sm:[&_svg:not([class*='size-'])]:size-3 [&_svg]:pointer-events-none [&_svg]:shrink-0 [button&,a&]:cursor-pointer",
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
          "bg-destructive/15 text-destructive dark:bg-destructive/20",
        success:
          "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        warning:
          "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        info:
          "bg-sky-500/15 text-sky-700 dark:text-sky-400",
        outline:
          "border-input bg-background text-foreground dark:bg-input/32 [button&,a&]:hover:bg-accent/50 dark:[button&,a&]:hover:bg-input/48",
      },
      shape: {
        pill: "rounded-full",
        rounded: "rounded-md",
        square: "rounded-sm",
      },
      size: {
        default: "h-4.5 min-w-4.5 px-[calc(--spacing(1)-1px)] text-sm",
        sm: "h-4 min-w-4 px-[calc(--spacing(1)-1px)] text-xs",
        lg: "h-5.5 min-w-5.5 px-[calc(--spacing(1.5)-1px)] text-sm",
        pill: "h-5 px-2.5 text-[10px]",
      },
    },
    defaultVariants: {
      variant: "default",
      shape: "square",
      size: "default",
    },
  },
);

export interface BadgeProps
  extends Omit<React.ComponentProps<"span">, "render">,
    VariantProps<typeof badgeVariants> {
  render?: useRender.ComponentProps<"span">["render"];
  asChild?: boolean;
}

const Badge = React.forwardRef<HTMLSpanElement, BadgeProps>(function Badge(
  { className, variant, shape, size, asChild = false, render, ...props },
  ref,
) {
  if (asChild) {
    return (
      <Slot
        ref={ref}
        data-slot="badge"
        className={cn(badgeVariants({ variant, shape, size }), className)}
        {...props}
      />
    );
  }

  const defaultProps = {
    ref,
    className: cn(badgeVariants({ variant, shape, size }), className),
    "data-slot": "badge",
  };

  return useRender({
    defaultTagName: "span",
    props: mergeProps<"span">(defaultProps, props),
    render,
  });
});

export { Badge, badgeVariants };
