import type { ProviderKind } from "@cozea/assistant-contracts"

import { Button } from "@/components/ui/button"
import { ProviderRemediationAction } from "@/features/assistant/chat/ProviderRemediationAction"
import { HugeiconsIcon } from "@hugeicons/react"
import { AlertCircleIcon as AlertCircleHugeIcon } from "@hugeicons/core-free-icons"

interface AssistantComposerStatusProps {
  historyError: string | null
  bindingError: string | null
  operationError: string | null
  configError: string | null
  provider: ProviderKind
  onRetryBinding: () => void
  onRemediationResolved: () => void
}

/** Presents controller errors without owning any transport or retry state. */
// Return the actual node so an absent status stays null for composer layout.
// A JSX wrapper around a component returning null is still a truthy element.
export function renderAssistantComposerStatus(props: AssistantComposerStatusProps) {
  if (props.historyError) {
    return (
      <div role="status" className="px-4 py-2 text-xs text-destructive">
        {props.historyError}
      </div>
    )
  }

  if (props.bindingError) {
    return (
      <div className="flex min-w-0 items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-normal text-destructive">
        <HugeiconsIcon icon={AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 flex-1">{props.bindingError}</span>
        <Button
          type="button"
          size="sm"
          variant="ghost"
          className="h-7 shrink-0 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
          onClick={props.onRetryBinding}
        >
          Retry
        </Button>
      </div>
    )
  }

  if (props.operationError) {
    return (
      <div className="flex min-w-0 items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-normal text-destructive">
        <HugeiconsIcon icon={AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 flex-1">{props.operationError}</span>
        <ProviderRemediationAction
          provider={props.provider}
          message={props.operationError}
          onResolved={props.onRemediationResolved}
        />
      </div>
    )
  }

  if (props.configError) {
    return (
      <div className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-secondary/50 px-4 py-3 text-xs leading-normal text-muted-foreground">
        <HugeiconsIcon icon={AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
        <span className="line-clamp-2 min-w-0 flex-1">{props.configError}</span>
      </div>
    )
  }

  return null
}
