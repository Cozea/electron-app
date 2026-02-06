import * as React from "react"
import { cn } from "@/lib/utils"

type EdgeFadeVariant = "surface" | "sidebar"

interface EdgeFadeProps extends React.HTMLAttributes<HTMLDivElement> {
  variant?: EdgeFadeVariant
  top?: boolean
  bottom?: boolean
  subtle?: boolean
}

export function EdgeFade({
  variant = "surface",
  top = true,
  bottom = true,
  subtle = false,
  className,
  ...props
}: EdgeFadeProps) {
  return (
    <div
      className={cn(
        "edge-fade-y relative overflow-hidden",
        variant === "sidebar" && "edge-fade-sidebar",
        subtle && "edge-fade-subtle",
        !top && "edge-fade-topless",
        !bottom && "edge-fade-bottomless",
        className
      )}
      {...props}
    />
  )
}
