import { useMemo, useState } from "react"

import type { DevAppManifest } from "@/features/devapps/registry/types"
import { cn } from "@/lib/utils"

interface DevAppIconProps {
  app: Pick<DevAppManifest, "name" | "icon">
  className?: string
}

function buildFallbackLabel(name: string): string {
  const parts = name
    .split(/\s+/)
    .map((part) => part.trim())
    .filter(Boolean)

  if (parts.length <= 0) return "?"
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() ?? "")
    .join("")
}

export function DevAppIcon({ app, className }: DevAppIconProps) {
  const [hasError, setHasError] = useState(false)
  const fallbackLabel = useMemo(() => buildFallbackLabel(app.name), [app.name])

  if (hasError) {
    return (
      <span
        aria-hidden
        className={cn(
          "flex h-full w-full items-center justify-center rounded-[inherit] bg-muted text-sm font-semibold text-foreground",
          className,
        )}
      >
        {fallbackLabel}
      </span>
    )
  }

  return (
    <span className="flex h-full w-full items-center justify-center rounded-[inherit]">
      <img
        src={app.icon.src}
        alt={app.icon.alt ?? app.name}
        decoding="async"
        className={cn("h-full w-full rounded-[inherit] object-contain", app.icon.className, className)}
        onError={() => setHasError(true)}
      />
    </span>
  )
}
