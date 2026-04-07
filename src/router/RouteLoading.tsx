import { Loader2 } from "lucide-react"

import { cn } from "@/lib/utils"

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
        <Loader2 className="h-4 w-4 animate-spin" />
        <span>{label}</span>
      </div>
    </div>
  )
}
