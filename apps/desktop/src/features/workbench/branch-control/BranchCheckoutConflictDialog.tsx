import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { File01Icon, GitBranchIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import { UnifiedModal } from "@/components/ui/unified-modal"
import { Spinner } from "@/components/ui/spinner"
import type { BranchCheckoutConflict } from "./workbenchBranchDisplay"

export interface BranchCheckoutConflictDialogProps {
  conflict: BranchCheckoutConflict | null
  onDismiss: () => void
  onStashAndSwitch: () => Promise<void>
  onGoToCommit: () => void
}

export function BranchCheckoutConflictDialog({
  conflict,
  onDismiss,
  onStashAndSwitch,
  onGoToCommit,
}: BranchCheckoutConflictDialogProps) {
  const [isStashing, setIsStashing] = useState(false)

  if (!conflict) return null

  const handleStash = async () => {
    setIsStashing(true)
    try {
      await onStashAndSwitch()
    } finally {
      setIsStashing(false)
    }
  }

  return (
    <UnifiedModal
      open
      onOpenChange={(open) => { if (!open && !isStashing) onDismiss() }}
      title="Cannot switch branch"
      size="md"
      dismissable={!isStashing}
      footer={
        <>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm"
            disabled={isStashing}
            onClick={onDismiss}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            className="h-8 text-sm"
            disabled={isStashing}
            onClick={onGoToCommit}
          >
            Review changes
          </Button>
          <Button
            size="sm"
            className="h-8 text-sm gap-1.5"
            disabled={isStashing}
            onClick={handleStash}
          >
            {isStashing ? <Spinner size="xs" /> : <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />}
            <span>Stash & switch</span>
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-muted-foreground">
          Your uncommitted changes would be overwritten by switching to {conflict.targetBranch}.
        </p>

        <div className="space-y-3 py-1">
          <p className="text-sm font-medium text-foreground">
            {conflict.conflictingFiles.length} conflicting{" "}
            {conflict.conflictingFiles.length === 1 ? "file" : "files"}:
          </p>
          <div className="max-h-44 overflow-y-auto rounded-lg border border-border/60 bg-muted/30 p-2 space-y-1">
            {conflict.conflictingFiles.map((file) => (
              <div key={file} className="flex items-center gap-2 text-xs font-mono text-muted-foreground">
                <HugeiconsIcon icon={File01Icon} className="size-3.5 shrink-0 text-muted-foreground/70" />
                <span className="truncate">{file}</span>
              </div>
            ))}
          </div>
          <p className="text-sm text-muted-foreground">
            Choose <strong>Stash & switch</strong> to automatically set aside your changes and switch, or review and commit them first.
          </p>
        </div>
      </div>
    </UnifiedModal>
  )
}
