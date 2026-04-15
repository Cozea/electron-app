

import {

  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"

import type { DiffDialogState } from "./workbenchAssistantShared"

import { HugeiconsIcon } from '@hugeicons/react'
import { Refresh01Icon as __Loader2HugeIcon } from '@hugeicons/core-free-icons'

interface WorkbenchAssistantDiffDialogProps {
  state: DiffDialogState | null
  onOpenChange: (open: boolean) => void
}

export function WorkbenchAssistantDiffDialog({
  state,
  onOpenChange,
}: WorkbenchAssistantDiffDialogProps) {
  return (
    <Dialog open={Boolean(state)} onOpenChange={onOpenChange}>
      <DialogContent className="h-[min(84vh,56rem)] max-w-[min(72rem,calc(100%-2rem))] overflow-hidden p-0">
        <DialogHeader className="border-b border-border/70 px-6 py-4">
          <DialogTitle>{state?.title ?? "Diff"}</DialogTitle>
          <DialogDescription>
            Review the unified diff captured for this local assistant thread.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-auto p-6">
          {state?.isLoading ? (
            <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
              <HugeiconsIcon icon={__Loader2HugeIcon} className="h-4 w-4 animate-spin" />
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
      </DialogContent>
    </Dialog>
  )
}

