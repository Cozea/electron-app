/**
 * Explicitly rebases a live session onto its target branch.
 *
 * Master Specification: Section 21
 * Phase: P21
 *
 * Nothing invokes the rebase automatically. A first explicit attempt stops when
 * Git reports conflicts; explicit resolution stays in a retained isolated worktree.
 */

import { useEffect, useState } from "react"

import type { ProjectdRebaseResult } from "@cozea/projectd-protocol"

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
import { RebaseRecoveryEditor } from "./RebaseRecoveryEditor"
import { appToast } from "@/lib/appToast"

function listPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 4).join(", ")
  return paths.length > 4 ? `${shown} and ${paths.length - 4} more` : shown
}

export interface RebaseSessionBodyProps {
  targetBranch: string
  result: ProjectdRebaseResult | null
  error: string | null
  rebasing: boolean
}

export function RebaseSessionBody({ targetBranch, result, error, rebasing }: RebaseSessionBodyProps) {
  if (error) {
    return (
      <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
    )
  }
  if (rebasing) {
    return (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="xs" />
        Rebasing the latest session save onto {targetBranch}…
      </p>
    )
  }
  if (!result) {
    return (
      <p className="text-sm text-muted-foreground">
        Cozea first saves the live session, then computes the rebase away from everyone&apos;s working folders. Editing can
        continue while it runs.
      </p>
    )
  }
  if (result.outcome === "conflicts") {
    const paths = result.conflictingPaths ?? []
    return (
      <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
        <p>{result.message}</p>
        {paths.length > 0 ? <p className="font-mono">{listPaths(paths)}</p> : null}
        <p>Choose the retained variants below, then apply the resolved rebase when ready.</p>
      </div>
    )
  }
  return <p className="text-sm text-foreground">{result.message}</p>
}

export interface RebaseSessionDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  publicSessionId: string
  branchName: string
  targetBranch: string
}

export function RebaseSessionDialog({
  isOpen,
  onOpenChange,
  publicSessionId,
  branchName,
  targetBranch,
}: RebaseSessionDialogProps) {
  const [result, setResult] = useState<ProjectdRebaseResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [rebasing, setRebasing] = useState(false)

  useEffect(() => {
    if (!isOpen) return
    setResult(null)
    setError(null)
    setRebasing(false)
  }, [isOpen])

  const rebase = async (allowConflicts: boolean) => {
    setRebasing(true)
    setError(null)
    try {
      const response = await window.electronAPI.projectd.sessions.rebase(publicSessionId, allowConflicts)
      if (!response.success) throw new Error(response.error)
      setResult(response.result)
      if (response.result.outcome === "rebased") {
        appToast.success({ title: `Rebased onto ${targetBranch}`, description: response.result.message })
      } else if (response.result.outcome === "requested") {
        appToast.info({ title: "Rebase requested", description: response.result.message })
      }
    } catch (rebaseError) {
      setError(rebaseError instanceof Error ? rebaseError.message : String(rebaseError))
    } finally {
      setRebasing(false)
    }
  }

  const conflicts = result?.outcome === "conflicts"
  const finished = Boolean(result && result.outcome !== "conflicts")

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (rebasing ? undefined : onOpenChange(open))}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            Rebase <span className="font-mono">{branchName}</span> onto <span className="font-mono">{targetBranch}</span>
          </DialogTitle>
          <DialogDescription>
            This is an explicit Git history rewrite of the session branch. Cozea uses the last save as the reviewed base
            and updates the live session with the result.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <RebaseSessionBody targetBranch={targetBranch} result={result} error={error} rebasing={rebasing} />
          {isOpen && !rebasing && <RebaseRecoveryEditor publicSessionId={publicSessionId} recoveryId={result?.recoveryId} onApplied={setResult} />}
        </div>

        <DialogFooter>
          <Button type="button" variant="outline" disabled={rebasing} onClick={() => onOpenChange(false)}>
            {finished ? "Close" : "Cancel"}
          </Button>
          {!conflicts && !finished ? (
            <Button type="button" disabled={rebasing} onClick={() => void rebase(false)}>
              {rebasing ? <Spinner size="xs" className="mr-1.5" /> : null}
              Rebase onto {targetBranch}
            </Button>
          ) : null}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
