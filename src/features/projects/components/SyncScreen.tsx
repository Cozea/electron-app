import { Button } from "@/components/ui/button"
import { Progress } from "@/components/ui/progress"
import { ScrollArea } from "@/components/ui/scroll-area"
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
} from "lucide-react"
import type { SyncProgress, SyncPlan } from "@/lib/sync/types"
import { getSyncPlanSummary } from "@/lib/sync/types"
import { cn } from "@/lib/utils"

interface SyncScreenProps {
  progress: SyncProgress
  plan: SyncPlan | null
  onContinue: () => void
  onRetry: () => void
}

export function SyncScreen({
  progress,
  plan,
  onContinue,
  onRetry,
}: SyncScreenProps) {
  const { status, message, current, total, logs } = progress
  const summary = plan ? getSyncPlanSummary(plan) : null

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
          <div className="grid grid-cols-3 gap-2 text-sm">
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
          </div>
        )}

        {/* Conflict Warning */}
        {summary && summary.conflicts > 0 && (
          <div className="flex items-center gap-2 p-3 bg-yellow-500/10 border border-yellow-500/20 rounded-md">
            <AlertTriangle className="h-5 w-5 text-yellow-500 flex-shrink-0" />
            <p className="text-sm text-yellow-700 dark:text-yellow-400">
              {summary.conflicts} file{summary.conflicts > 1 ? "s have" : " has"}{" "}
              conflicts. These will be skipped.
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
                    log.startsWith("✓") && "text-green-500",
                    log.startsWith("✕") && "text-destructive",
                    log.startsWith("⚠") && "text-yellow-500",
                    log.startsWith("↓") && "text-blue-500",
                    log.startsWith("↑") && "text-green-500"
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
          {(status === "complete" || status === "error" || status === "planning") && (
            <Button onClick={onContinue}>
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
