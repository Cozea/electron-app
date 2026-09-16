import { useState } from "react"
import { HugeiconsIcon } from "@hugeicons/react"
import { AlertCircleIcon, File01Icon, GitBranchIcon } from "@hugeicons/core-free-icons"

import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
    <Dialog open onOpenChange={(open) => { if (!open && !isStashing) onDismiss() }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <div className="flex items-center gap-2 text-foreground">
            <HugeiconsIcon icon={AlertCircleIcon} className="size-5 text-amber-500" />
            <DialogTitle>Cannot switch branch</DialogTitle>
          </div>
          <DialogDescription className="text-xs text-muted-foreground pt-1">
            Your uncommitted changes would be overwritten by switching to{" "}
            <span className="font-mono font-medium text-foreground">{conflict.targetBranch}</span>.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 py-1">
          <p className="text-xs font-medium text-foreground">
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
          <p className="text-xs text-muted-foreground">
            Choose <strong>Stash & switch</strong> to automatically set aside your changes and switch, or review and commit them first.
          </p>
        </div>

        <DialogFooter className="flex flex-row items-center justify-end gap-2 pt-2">
          <Button
            variant="outline"
            size="sm"
            disabled={isStashing}
            onClick={onDismiss}
          >
            Cancel
          </Button>
          <Button
            variant="outline"
            size="sm"
            disabled={isStashing}
            onClick={onGoToCommit}
          >
            Review changes
          </Button>
          <Button
            size="sm"
            className="gap-1.5"
            disabled={isStashing}
            onClick={handleStash}
          >
            {isStashing ? <Spinner size="xs" /> : <HugeiconsIcon icon={GitBranchIcon} className="size-3.5" />}
            <span>Stash & switch</span>
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
