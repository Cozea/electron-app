

import { cn } from "@/lib/utils"

import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon as __Loader2HugeIcon } from '@hugeicons/core-free-icons'

interface RouteLoadingProps {
  className?: string
  label?: string
}

export function RouteLoading({
  className,
  label = "Loading page…",
}: RouteLoadingProps) {
  return (
    <div
      className={cn(
        "flex min-h-[240px] items-center justify-center px-6 py-10 text-sm text-muted-foreground",
        className,
      )}
    >
      <div className="flex items-center gap-2">
        <HugeiconsIcon icon={__Loader2HugeIcon} className="h-4 w-4 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  )
}

