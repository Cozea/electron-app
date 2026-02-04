import { useEffect, useMemo, useState } from "react"
import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group"
import {
  Cloud,
  CloudOff,
  Check,
  AlertTriangle,
  Loader2,
  RefreshCw,
  ArrowRight,
  Download,
  Upload,
  Trash2,
  GitMerge,
} from "lucide-react"
import type { SyncProgress, SyncPlan } from "@/lib/sync/types"
import { getSyncPlanSummary } from "@/lib/sync/types"
import { cn } from "@/lib/utils"

interface SyncScreenProps {
  progress: SyncProgress
  plan: SyncPlan | null
  onContinue: () => void
  onRetry: () => void
  onSync?: (resolvedPlan: SyncPlan) => void
}

export function SyncScreen({
  progress,
  plan,
  onContinue,
  onRetry,
  onSync,
}: SyncScreenProps) {
  const { status, message, current, total, logs } = progress
  const summary = plan ? getSyncPlanSummary(plan) : null
  const conflicts = useMemo(() => plan?.conflicts ?? [], [plan])

  const [conflictResolutions, setConflictResolutions] = useState<Record<string, string>>({})

  useEffect(() => {
    setConflictResolutions({})
  }, [plan])

  const allConflictsResolved = useMemo(() => {
    if (!plan) return false
    if (conflicts.length === 0) return true
    return conflicts.every((c) => Boolean(conflictResolutions[c.path]))
  }, [plan, conflicts, conflictResolutions])

  const resolvedPlan = useMemo(() => {
    if (!plan) return null
    if (conflicts.length === 0) return plan

    const next: SyncPlan = {
      downloads: [...plan.downloads],
      uploads: [...plan.uploads],
      localDeletes: [...plan.localDeletes],
      cloudDeletes: [...plan.cloudDeletes],
      conflicts: [],
      autoMerged: [...(plan.autoMerged ?? [])],
      noChange: plan.noChange,
    }

    for (const conflict of conflicts) {
      const decision = conflictResolutions[conflict.path]
      if (!decision) continue

      if (decision === "download") {
        if (!conflict.cloudEntry) continue
        next.downloads.push({ ...conflict, type: "download" })
      } else if (decision === "upload") {
        if (!conflict.localEntry) continue
        next.uploads.push({ ...conflict, type: "upload" })
      } else if (decision === "delete-local") {
        next.localDeletes.push({ ...conflict, type: "delete-local" })
      } else if (decision === "delete-cloud") {
        next.cloudDeletes.push({ ...conflict, type: "delete-cloud" })
      }
    }

    return next
  }, [plan, conflicts, conflictResolutions])

  const getStatusIcon = () => {
    switch (status) {
      case "idle":
      case "checking":
      case "planning":
        return <Loader2 className="h-8 w-8 animate-spin text-primary" />
      case "syncing":
        return <Cloud className="h-8 w-8 text-primary animate-pulse" />
      case "complete":
        return <Check className="h-8 w-8 text-green-500" />
      case "error":
        return <CloudOff className="h-8 w-8 text-destructive" />
    }
  }

  const getStatusTitle = () => {
    switch (status) {
      case "idle":
        return "Preparing sync..."
      case "checking":
        return "Checking files..."
      case "planning":
        return "Planning sync..."
      case "syncing":
        return "Syncing files..."
      case "complete":
        return "Sync complete!"
      case "error":
        return "Sync failed"
    }
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen bg-background p-8">
      <div className="max-w-md w-full space-y-6">
        {/* Status Icon */}
        <div className="flex justify-center">
          <div className="w-16 h-16 rounded-full bg-muted flex items-center justify-center">
            {getStatusIcon()}
          </div>
        </div>

        {/* Title & Message */}
        <div className="text-center space-y-2">
          <h2 className="text-xl font-semibold">{getStatusTitle()}</h2>
          <p className="text-sm text-muted-foreground">{message}</p>
        </div>

        {/* Progress Bar */}
        {(status === "syncing" || status === "complete") && total > 0 && (
          <div className="space-y-2">
            <Progress value={(current / total) * 100} className="h-2" />
            <p className="text-xs text-center text-muted-foreground">
              {current} / {total} files
            </p>
          </div>
        )}

        {/* Plan Summary */}
        {summary && status !== "syncing" && summary.totalChanges > 0 && (
          <div className={cn(
            "grid gap-2 text-sm",
            summary.autoMerged > 0 ? "grid-cols-4" : "grid-cols-3"
          )}>
            <div className="bg-muted/50 rounded-md p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-blue-500 mb-1">
                <Download className="h-4 w-4" />
                <span className="font-medium">{summary.downloads}</span>
              </div>
              <div className="text-xs text-muted-foreground">Downloads</div>
            </div>
            <div className="bg-muted/50 rounded-md p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-green-500 mb-1">
                <Upload className="h-4 w-4" />
                <span className="font-medium">{summary.uploads}</span>
              </div>
              <div className="text-xs text-muted-foreground">Uploads</div>
            </div>
            <div className="bg-muted/50 rounded-md p-3 text-center">
              <div className="flex items-center justify-center gap-1 text-orange-500 mb-1">
                <Trash2 className="h-4 w-4" />
                <span className="font-medium">{summary.deletes}</span>
              </div>
              <div className="text-xs text-muted-foreground">Deletes</div>
            </div>
            {summary.autoMerged > 0 && (
              <div className="bg-muted/50 rounded-md p-3 text-center">
                <div className="flex items-center justify-center gap-1 text-purple-500 mb-1">
                  <GitMerge className="h-4 w-4" />
                  <span className="font-medium">{summary.autoMerged}</span>
                </div>
                <div className="text-xs text-muted-foreground">Merged</div>
              </div>
            )}
          </div>
        )}

        {/* Auto-merged indicator */}
        {summary && summary.autoMerged > 0 && status !== "syncing" && (
          <div className="flex items-center gap-2 p-3 bg-purple-500/10 border border-purple-500/20 rounded-md">
            <GitMerge className="h-5 w-5 text-purple-500 flex-shrink-0" />
            <p className="text-sm text-purple-700 dark:text-purple-400">
              {summary.autoMerged} file{summary.autoMerged > 1 ? "s" : ""} auto-merged
              (non-conflicting changes combined)
            </p>
          </div>
        )}

        {/* Conflict Warning */}
        {summary && summary.conflicts > 0 && (
          <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
            <p className="text-sm text-yellow-700 dark:text-yellow-400">
              {summary.conflicts} file{summary.conflicts > 1 ? "s have" : " has"}{" "}
              conflicts. Resolve them below to sync safely.
            </p>
          </div>
        )}

        {/* Conflict Resolution */}
        {plan && conflicts.length > 0 && status === "planning" && (
          <div className="space-y-3">
            <div className="text-sm font-medium">Resolve conflicts</div>
            <ScrollArea className="h-56 w-full rounded-md border bg-muted/20 p-3">
              <div className="space-y-3">
                {conflicts.map((conflict, index) => {
                  const options: Array<{ value: string; label: string }> = []

                  if (conflict.localEntry && conflict.cloudEntry) {
                    options.push(
                      { value: "upload", label: "Keep local (upload to cloud)" },
                      { value: "download", label: "Keep cloud (download to local)" }
                    )
                  } else if (conflict.localEntry && !conflict.cloudEntry) {
                    options.push(
                      { value: "upload", label: "Restore to cloud (upload local)" },
                      { value: "delete-local", label: "Accept cloud deletion (delete local)" }
                    )
                  } else if (!conflict.localEntry && conflict.cloudEntry) {
                    options.push(
                      { value: "download", label: "Restore locally (download cloud)" },
                      { value: "delete-cloud", label: "Accept local deletion (delete from cloud)" }
                    )
                  }

                  return (
                    <div key={`${conflict.path}:${index}`} className="rounded-md border bg-background/50 p-3 space-y-2">
                      <div className="space-y-0.5">
                        <div className="text-sm font-medium break-all">{conflict.path}</div>
                        <div className="text-xs text-muted-foreground">{conflict.reason}</div>
                      </div>

                      <RadioGroup
                        value={conflictResolutions[conflict.path] ?? ""}
                        onValueChange={(value) =>
                          setConflictResolutions((prev) => ({ ...prev, [conflict.path]: value }))
                        }
                        className="grid gap-2"
                      >
                        {options.map((opt) => {
                          const id = `conflict-${index}-${opt.value}`
                          return (
                            <label key={opt.value} htmlFor={id} className="flex items-center gap-2 text-sm cursor-pointer">
                              <RadioGroupItem id={id} value={opt.value} />
                              <span>{opt.label}</span>
                            </label>
                          )
                        })}
                      </RadioGroup>
                    </div>
                  )
                })}
              </div>
            </ScrollArea>
            <p className="text-xs text-muted-foreground">
              Your choices determine whether local or cloud changes win for each file.
            </p>
          </div>
        )}

        {/* Logs */}
        {logs.length > 0 && (
          <ScrollArea className="h-40 w-full rounded-md border bg-muted/30 p-3">
            <div className="space-y-1 font-mono text-xs">
              {logs.map((log, i) => (
                <div
                  key={i}
                  className={cn(
                    "text-muted-foreground",
                    log.includes("✓") && "text-green-500",
                    log.includes("✕") && "text-destructive",
                    log.includes("⚠") && "text-yellow-500",
                    log.includes("↓") && "text-blue-500",
                    log.includes("↑") && "text-green-500",
                    log.includes("⊕") && "text-purple-500"
                  )}
                >
                  {log}
                </div>
              ))}
            </div>
          </ScrollArea>
        )}

        {/* Actions */}
        <div className="flex gap-2 justify-center">
          {status === "error" && (
            <Button variant="outline" onClick={onRetry}>
              <RefreshCw className="h-4 w-4 mr-2" />
              Retry
            </Button>
          )}
          {status === "planning" && summary && summary.totalChanges > 0 && onSync && (
            <Button
              onClick={() => resolvedPlan && onSync(resolvedPlan)}
              disabled={!resolvedPlan || !allConflictsResolved}
            >
              Sync changes
            </Button>
          )}
          {(status === "complete" || status === "error" || status === "planning") && (
            <Button variant={status === "planning" && summary && summary.totalChanges > 0 ? "outline" : "default"} onClick={onContinue}>
              Continue
              <ArrowRight className="h-4 w-4 ml-2" />
            </Button>
          )}
        </div>

        {/* Skip option for planning state */}
        {status === "planning" && summary && summary.totalChanges > 0 && (
          <p className="text-xs text-center text-muted-foreground">
            Click continue to skip sync and work offline
          </p>
        )}
      </div>
    </div>
  )
}
