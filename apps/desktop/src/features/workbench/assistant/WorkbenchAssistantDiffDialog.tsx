

import { Button } from "@/components/ui/button"
import { UnifiedModal } from "@/components/ui/unified-modal"

import type { DiffDialogState } from "./workbenchAssistantShared"

interface WorkbenchAssistantDiffDialogProps {
  state: DiffDialogState | null
  onOpenChange: (open: boolean) => void
}

export function WorkbenchAssistantDiffDialog({
  state,
  onOpenChange,
}: WorkbenchAssistantDiffDialogProps) {
  return (
    <UnifiedModal
      open={Boolean(state)}
      onOpenChange={onOpenChange}
      title={state?.title ?? "Diff"}
      size="3xl"
      footer={
        <Button variant="outline" onClick={() => onOpenChange(false)}>
          Close
        </Button>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Review the unified diff captured for this local assistant thread.
        </p>

        <div className="h-[min(65vh,46rem)] overflow-auto">
          {state?.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <div className="loader" />
              Loading diff…
            </div>
          ) : state?.error ? (
            <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-4 text-xs leading-normal text-destructive">
              {state.error}
            </div>
          ) : (
            <pre className="overflow-x-auto rounded-3xl bg-secondary/70 p-4 text-xs leading-6 text-foreground">
              <code>{state?.diff || "No diff content was returned."}</code>
            </pre>
          )}
        </div>
      </div>
    </UnifiedModal>
  )
}

