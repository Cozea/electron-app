import * as React from "react"
import * as SeparatorPrimitive from "@radix-ui/react-separator"

import { cn } from "@/lib/utils"

function Separator({
  className,
  orientation = "horizontal",
  decorative = true,
  ...props
}: React.ComponentProps<typeof SeparatorPrimitive.Root>) {
  const isVertical = orientation === "vertical"
  return (
    <SeparatorPrimitive.Root
      data-slot="separator"
      decorative={decorative}
      orientation={orientation}
      className={cn(
        "shrink-0",
        isVertical ? "h-full w-px bdry-divider-y" : "h-px w-full bdry-divider-x",
        className
      )}
      {...props}
    />
  )
}

export { Separator }
