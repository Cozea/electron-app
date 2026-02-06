import * as React from "react"
import { cn } from "@/lib/utils"

type BdryVariant = "default" | "sidebar" | "muted"

interface BdryProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: BdryVariant
}

export function Bdry({ variant = "default", className, ...props }: BdryProps) {
  return (
    <div
      className={cn(
        "bdry",
        variant === "sidebar" && "bdry-sidebar",
        variant === "muted" && "bdry-muted",
        className
      )}
      {...props}
    />
  )
}

interface BdryDividerProps extends React.HTMLAttributes<HTMLDivElement> {
  orientation?: "horizontal" | "vertical"
  variant?: BdryVariant
}

export function BdryDivider({
  orientation = "horizontal",
  variant = "default",
  className,
  ...props
}: BdryDividerProps) {
  const isVertical = orientation === "vertical"

  return (
    <div
      className={cn(
        isVertical ? "h-full w-px bdry-divider-y" : "h-px w-full bdry-divider-x",
        variant === "sidebar" && "bdry-sidebar",
        variant === "muted" && "bdry-muted",
        className
      )}
      {...props}
    />
  )
}
