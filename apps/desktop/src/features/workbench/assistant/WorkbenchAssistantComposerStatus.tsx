import { Button } from "@/components/ui/button"
import { isIntentionalAbortMessage } from "@/features/assistant/lib/assistantErrors"

import { HugeiconsIcon } from "@hugeicons/react"
import { AlertCircleIcon as __AlertCircleHugeIcon } from "@hugeicons/core-free-icons"

interface WorkbenchAssistantComposerStatusProps {
  runtimeErrorMessage: string | null
  bindingError: string | null
  sendError: string | null
  requestError: string | null
  threadError: string | null | undefined
  configError: string | null
  hasConfig: boolean
  onRetryBinding: () => void
  onDismissThreadError: () => void
}

function InlineError({ children }: { children: string }) {
  return (
    <div className="line-clamp-2 min-w-0 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-normal text-destructive">
      {children}
    </div>
  )
}

export function WorkbenchAssistantComposerStatus({
  runtimeErrorMessage,
  bindingError,
  sendError,
  requestError,
  threadError,
  configError,
  hasConfig,
  onRetryBinding,
  onDismissThreadError,
}: WorkbenchAssistantComposerStatusProps) {
  if (runtimeErrorMessage) {
    return <InlineError>{runtimeErrorMessage}</InlineError>
  }

  if (bindingError) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-normal text-destructive">
        <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 flex-1">{bindingError}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-destructive"
          onClick={onRetryBinding}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (sendError || requestError) {
    return <InlineError>{sendError ?? requestError ?? ""}</InlineError>
  }

  if (threadError && !isIntentionalAbortMessage(threadError)) {
    return (
      <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-normal text-destructive">
        <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 flex-1">{threadError}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-destructive"
          onClick={onDismissThreadError}
        >
          Dismiss
        </Button>
      </div>
    )
  }

  if (configError && !hasConfig) {
    return (
      <div className="line-clamp-2 min-w-0 rounded-2xl border border-border/60 bg-secondary/50 px-3 py-2 text-xs leading-normal text-muted-foreground">
        {configError}
      </div>
    )
  }

  return null
}
