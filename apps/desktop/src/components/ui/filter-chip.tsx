import type { ComponentProps } from "react"

import { cn } from "@/lib/utils"

interface FilterChipProps extends ComponentProps<"button"> {
  active: boolean
}

export function FilterChip({ active, className, type = "button", ...props }: FilterChipProps) {
  return (
    <button
      type={type}
      aria-pressed={active}
      className={cn(
        "cursor-pointer rounded-full px-3 py-1 text-sm font-medium transition-colors",
        active
          ? "bg-secondary text-foreground shadow-xs"
          : "text-muted-foreground hover:bg-muted/60 hover:text-foreground",
        className,
      )}
      {...props}
    />
  )
}
