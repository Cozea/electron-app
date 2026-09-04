import { useMemo } from "react"

import { Tooltip, TooltipContent, TooltipTrigger } from "@/components/ui/tooltip"
import type { WorkspaceRuntimeRecord } from "@/lib/workspaceRuntimeStore"
import { cn } from "@/lib/utils"

interface WorkspaceLifecycleIndicatorProps {
  record: WorkspaceRuntimeRecord | null
  workspaceId: string | null
  className?: string
}

function basenameFromWorkspaceId(workspaceId: string | null): string {
  if (!workspaceId) {
    return "Unbound"
  }

  const segments = workspaceId.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? workspaceId
}

function formatLifecycleLabel(lifecycle: WorkspaceRuntimeRecord["lifecycle"] | null | undefined): string {
  switch (lifecycle) {
    case "focused":
      return "Focused"
    case "background-hot":
      return "Hot"
    case "background-warm":
      return "Warm"
    case "background-frozen":
      return "Frozen"
    case "closed":
      return "Closed"
    default:
      return "Pending"
  }
}

function resolveLifecycleTone(lifecycle: WorkspaceRuntimeRecord["lifecycle"] | null | undefined): string {
  switch (lifecycle) {
    case "focused":
      return "bg-emerald-500"
    case "background-hot":
      return "bg-sky-500"
    case "background-warm":
      return "bg-amber-500"
    case "background-frozen":
      return "bg-slate-400"
    case "closed":
      return "bg-rose-500"
    default:
      return "bg-muted-foreground/50"
  }
}

function describeReason(record: WorkspaceRuntimeRecord | null): string {
  const reason = record?.signals.lifecycleReason ?? "initializing"

  switch (reason) {
    case "route-attached":
      return "Visible route is attached to this workspace."
    case "collaboration-connected":
      return "Live collaboration is connected in the background."
    case "dev-server-running":
      return "A retained dev server is still running."
    case "native-preview-running":
      return "A native preview session is still running."
    case "terminals-retained":
      return "Retained terminals are keeping this workspace hot."
    case "browser-surface-retained":
      return "Browser surfaces are retained for quick restore."
    case "recent-activity":
      return "Recent activity is keeping this workspace warm."
    case "collaboration-enabled":
      return "Collaboration is enabled, but the workspace is currently idle."
    case "idle-timeout":
      return "This workspace cooled down after sustained idleness."
    case "idle-cooldown":
      return "This workspace is cooling down toward a frozen state."
    case "closed-explicitly":
      return "This workspace was closed explicitly."
    default:
      return reason.replace(/-/g, " ")
  }
}

export function WorkspaceLifecycleIndicator({
  record,
  workspaceId,
  className,
}: WorkspaceLifecycleIndicatorProps) {
  const lifecycleLabel = formatLifecycleLabel(record?.lifecycle)
  const rootLabel = useMemo(() => basenameFromWorkspaceId(workspaceId), [workspaceId])
  const detail = describeReason(record)
  const toneClass = resolveLifecycleTone(record?.lifecycle)
  const hasRetainedTerminal = Boolean(record?.signals.hasRunningTerminals)
  const hasRetainedDevServer = Boolean(record?.signals.hasRunningDevServer)
  const hasRetainedPreview = Boolean(record?.signals.hasNativePreview)

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <div
          className={cn(
            "flex h-6 min-w-0 items-center gap-1.5 rounded-md border border-border/60 bg-background/70 px-2 text-[11px] text-muted-foreground",
            className,
          )}
        >
          <span className={cn("size-1.5 shrink-0 rounded-full", toneClass)} />
          <span className="max-w-[120px] truncate font-medium text-foreground/85">{rootLabel}</span>
          <span className="text-muted-foreground/40">•</span>
          <span className="shrink-0 uppercase tracking-[0.08em]">{lifecycleLabel}</span>
        </div>
      </TooltipTrigger>
      <TooltipContent side="bottom" align="center" className="max-w-xs">
        <div className="space-y-1 text-xs">
          <p className="font-medium text-foreground">{rootLabel}</p>
          <p>{detail}</p>
          <p className="text-muted-foreground">
            {hasRetainedTerminal ? "Terminal retained. " : ""}
            {hasRetainedDevServer ? "Dev server retained. " : ""}
            {hasRetainedPreview ? "Native preview retained." : ""}
          </p>
        </div>
      </TooltipContent>
    </Tooltip>
  )
}
