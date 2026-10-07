/**
 * GitHub-style Session Activity Heatmap.
 *
 * Renders an activity punch grid displaying edit velocity and Git checkpoints
 * across the lifetime of the collaboration session.
 */

import { useMemo } from "react"
import { useTranslation } from "@/lib/i18n"
import { Badge } from "@/components/ui/badge"
import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import { cn } from "@/lib/utils"
import type { SessionActivityBucketView } from "../live/useSessionMetrics"

export interface SessionActivityHeatmapProps {
  buckets: SessionActivityBucketView[]
  totalOperations: number
  totalCheckpoints: number
  sessionDuration: string
  className?: string
}

function getIntensityClass(ops: number, checkpoints: number): string {
  if (ops === 0 && checkpoints === 0) {
    return "bg-muted/30 border-border/40 hover:border-border"
  }
  if (ops <= 5 && checkpoints === 0) {
    return "bg-emerald-500/20 border-emerald-500/30 hover:bg-emerald-500/30"
  }
  if (ops <= 25) {
    return "bg-emerald-500/40 border-emerald-500/50 hover:bg-emerald-500/50"
  }
  if (ops <= 80) {
    return "bg-emerald-500/70 border-emerald-500/80 hover:bg-emerald-500/80"
  }
  return "bg-emerald-500 border-emerald-400 hover:bg-emerald-400"
}

function formatBucketTime(timestamp: number): string {
  const date = new Date(timestamp)
  return date.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })
}

export function SessionActivityHeatmap({
  buckets,
  totalOperations,
  totalCheckpoints,
  sessionDuration,
  className,
}: SessionActivityHeatmapProps) {
  const { t } = useTranslation()
  // Ensure we have at least 16 grid cells to show a smooth punch card timeline
  const normalizedGrid = useMemo(() => {
    const minSlots = 16
    if (buckets.length >= minSlots) {
      return buckets
    }
    const needed = minSlots - buckets.length
    const intervalMs = 15 * 60 * 1000
    const firstBucketTime = buckets[0]?.bucketStart ?? Date.now() - minSlots * intervalMs
    const prefix: SessionActivityBucketView[] = []
    for (let i = needed; i > 0; i--) {
      prefix.push({
        bucketStart: firstBucketTime - i * intervalMs,
        operations: 0,
        checkpoints: 0,
      })
    }
    return [...prefix, ...buckets]
  }, [buckets])

  return (
    <div className={cn("rounded-lg border border-border/60 bg-muted/20 p-3 space-y-2.5", className)}>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-foreground">{t("collab.sessionActivity")}</span>
          <Badge variant="secondary" className="text-[10px] h-4 px-1.5 font-normal">
            {sessionDuration} lifetime
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-2xs text-muted-foreground">
          <span>{totalOperations} {totalOperations === 1 ? "operation" : "operations"}</span>
          <span>·</span>
          <span>{totalCheckpoints} {totalCheckpoints === 1 ? "checkpoint" : "checkpoints"}</span>
        </div>
      </div>

      {/* The Activity Grid */}
      <div className="flex flex-col gap-1.5 pt-0.5">
        <div className="grid grid-cols-8 sm:grid-cols-16 gap-1">
          {normalizedGrid.map((bucket, index) => {
            const intensity = getIntensityClass(bucket.operations, bucket.checkpoints)
            const timeLabel = formatBucketTime(bucket.bucketStart)
            return (
              <Tooltip key={`${bucket.bucketStart}-${index}`}>
                <TooltipTrigger asChild>
                  <div
                    className={cn(
                      "h-5 w-full rounded-sm border transition-colors cursor-pointer",
                      intensity,
                    )}
                  />
                </TooltipTrigger>
                <TooltipContent side="top" className="text-2xs p-2 space-y-0.5">
                  <p className="font-semibold text-foreground">{timeLabel}</p>
                  <p className="text-muted-foreground">
                    {bucket.operations} {bucket.operations === 1 ? "edit operation" : "edit operations"}
                  </p>
                  {bucket.checkpoints > 0 ? (
                    <p className="text-emerald-400 font-medium">
                      {bucket.checkpoints} Git {bucket.checkpoints === 1 ? "save" : "saves"}
                    </p>
                  ) : null}
                </TooltipContent>
              </Tooltip>
            )
          })}
        </div>

        {/* Timeline Axis & Legend */}
        <div className="flex items-center justify-between text-[10px] text-muted-foreground/80 pt-0.5 px-0.5">
          <span>{formatBucketTime(normalizedGrid[0]?.bucketStart ?? Date.now())}</span>
          <div className="flex items-center gap-1.5">
            <span className="text-2xs">{t("collab.less")}</span>
            <span className="size-2 rounded-[1.5px] bg-muted/40 border border-border/50" />
            <span className="size-2 rounded-[1.5px] bg-emerald-500/25 border border-emerald-500/30" />
            <span className="size-2 rounded-[1.5px] bg-emerald-500/50 border border-emerald-500/60" />
            <span className="size-2 rounded-[1.5px] bg-emerald-500/80 border border-emerald-500/80" />
            <span className="size-2 rounded-[1.5px] bg-emerald-500 border border-emerald-400" />
            <span className="text-2xs">{t("collab.more")}</span>
          </div>
          <span>{t("collab.now")}</span>
        </div>
      </div>
    </div>
  )
}
