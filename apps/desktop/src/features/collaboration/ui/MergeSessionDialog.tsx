/**
 * Merges a live session into the branch its work is meant for.
 *
 * Master Specification: Section 22
 * Phase: P22
 *
 * The merge takes the session's last save to Git, never the live state (C28): the
 * dialog previews that commit against the target, then merges it directly or opens a
 * pull request. Afterwards the session can go on, pause or end. Nothing here deletes
 * the session's branch.
 */

import { useCallback, useEffect, useRef, useState } from "react"

import type { ProjectdMergePreview, ProjectdMergeResult, ProjectdMergeStrategy, ProjectdPullRequestResult } from "@cozea/projectd-protocol"

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
import { appToast } from "@/lib/appToast"

function countCommits(count: number): string {
  return `${count} ${count === 1 ? "commit" : "commits"}`
}

function listPaths(paths: readonly string[]): string {
  const shown = paths.slice(0, 3).join(", ")
  return paths.length > 3 ? `${shown} and ${paths.length - 3} more` : shown
}

export interface MergeSessionBodyProps {
  targetBranch: string
  preview: ProjectdMergePreview | null
  loading: boolean
  error: string | null
  result: ProjectdMergeResult | null
  strategy: ProjectdMergeStrategy
  onStrategyChange: (strategy: ProjectdMergeStrategy) => void
  /** What happened when Save now was asked, such as the leader saving on another Mac. */
  saveNote?: string | null
  onSaveNow?: () => void
  onCheckAgain?: () => void
}

/** What the dialog says about a preview or a merge; rendered on its own in tests. */
export function MergeSessionBody({
  targetBranch,
  preview,
  loading,
  error,
  result,
  strategy,
  onStrategyChange,
  saveNote = null,
  onSaveNow,
  onCheckAgain,
}: MergeSessionBodyProps) {
  if (result) {
    return (
      <div className="space-y-2 text-sm">
        <p className={result.outcome === "merged" ? "text-foreground" : "text-amber-700 dark:text-amber-400"}>
          {result.message}
        </p>
        {result.outcome === "merged" ? (
          <p className="text-xs text-muted-foreground">
            The session&apos;s branch stays on its remote. Delete it there when you no longer need it.
          </p>
        ) : null}
      </div>
    )
  }
  if (error) {
    return (
      <p className="rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">{error}</p>
    )
  }
  if (!preview) {
    return loading ? (
      <p className="flex items-center gap-2 text-sm text-muted-foreground">
        <Spinner size="xs" />
        Checking {targetBranch}…
      </p>
    ) : null
  }

  const save = preview.checkpointOid.slice(0, 7)
  const unsaved = preview.unsavedChanges
  return (
    <div className="space-y-3 text-sm">
      <p>
        {preview.ahead === 0
          ? `${targetBranch} already has everything in the session's last save (${save}).`
          : `The session's last save, ${save}, has ${countCommits(preview.ahead)} ${targetBranch} doesn't have.`}
        {preview.behind > 0
          ? ` ${targetBranch} also has ${countCommits(preview.behind)} the session's branch doesn't; the merge keeps them.`
          : null}
      </p>

      {unsaved > 0 ? (
        <div className="space-y-2 rounded-md border border-amber-500/30 bg-amber-500/10 px-3 py-2 text-xs text-amber-700 dark:text-amber-400">
          <p>
            {unsaved === 1 ? "1 session change isn't" : `${unsaved} session changes aren't`} saved to Git yet, so the
            merge leaves {unsaved === 1 ? "it" : "them"} out.
          </p>
          {saveNote ? <p>{saveNote}</p> : null}
          <div className="flex gap-2">
            {onSaveNow ? (
              <Button type="button" size="sm" variant="outline" className="h-6 px-2 text-xs" onClick={onSaveNow}>
                Save now
              </Button>
            ) : null}
            {onCheckAgain ? (
              <Button type="button" size="sm" variant="ghost" className="h-6 px-2 text-xs" onClick={onCheckAgain}>
                Check again
              </Button>
            ) : null}
          </div>
        </div>
      ) : null}

      {!preview.clean ? (
        <div className="space-y-1 rounded-md border border-destructive/20 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          <p>{listPaths(preview.conflictingPaths)} changed on both sides.</p>
          <p>
            Rebase the session from {targetBranch} first, or resolve{" "}
            {preview.conflictingPaths.length === 1 ? "it" : "them"} in a pull request.
          </p>
        </div>
      ) : preview.ahead > 0 ? (
        <fieldset className="space-y-1.5">
          <legend className="text-xs font-medium">How to merge</legend>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="mergeStrategy"
              checked={strategy === "merge"}
              onChange={() => onStrategyChange("merge")}
            />
            <span>Merge commit, keeping the session&apos;s commits</span>
          </label>
          <label className="flex cursor-pointer items-center gap-2">
            <input
              type="radio"
              name="mergeStrategy"
              checked={strategy === "squash"}
              onChange={() => onStrategyChange("squash")}
            />
            <span>Squash into one commit</span>
          </label>
        </fieldset>
      ) : null}
    </div>
  )
}

export interface MergeSessionDialogProps {
  isOpen: boolean
  onOpenChange: (open: boolean) => void
  publicSessionId: string
  branchName: string
  targetBranch: string
  /** Session managers can pause or end the session once it is merged. */
  canManage: boolean
  onPause: () => void
  onEnd: () => void
}

export function MergeSessionDialog({
  isOpen,
  onOpenChange,
  publicSessionId,
  branchName,
  targetBranch,
  canManage,
  onPause,
  onEnd,
}: MergeSessionDialogProps) {
  const sessions = window.electronAPI.projectd.sessions
  const [preview, setPreview] = useState<ProjectdMergePreview | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [result, setResult] = useState<ProjectdMergeResult | null>(null)
  const [strategy, setStrategy] = useState<ProjectdMergeStrategy>("merge")
  const [saveNote, setSaveNote] = useState<string | null>(null)
  const [merging, setMerging] = useState(false)
  const [pullRequest, setPullRequest] = useState<ProjectdPullRequestResult | null>(null)
  const pendingAction = useRef(false)

  const load = useCallback(async () => {
    if (pendingAction.current) return
    setLoading(true)
    setError(null)
    try {
      const response = await sessions.previewMerge(publicSessionId)
      if (!response.success) throw new Error(response.error)
      setPreview(response.preview)
    } catch (loadError) {
      setPreview(null)
      setError(loadError instanceof Error ? loadError.message : String(loadError))
    } finally {
      setLoading(false)
    }
  }, [publicSessionId, sessions])

  useEffect(() => {
    if (!isOpen) return
    setResult(null)
    setSaveNote(null)
    setPullRequest(null)
    void load()
  }, [isOpen, load])

  const saveNow = async () => {
    const response = await sessions.checkpointNow(publicSessionId)
    if (!response.success) {
      setSaveNote(response.error)
      return
    }
    if (response.result.outcome === "requested") {
      setSaveNote("The Mac that saves this session is saving it now. Check again in a moment.")
      return
    }
    if (response.result.outcome === "no_leader") {
      setSaveNote("No member's Mac can push this session's branch right now.")
      return
    }
    setSaveNote(null)
    await load()
  }

  const merge = async () => {
    if (!preview || pendingAction.current) return
    pendingAction.current = true
    setMerging(true)
    try {
      const response = await sessions.merge(publicSessionId, strategy, preview.checkpointOid, preview.targetOid)
      if (!response.success) throw new Error(response.error)
      setResult(response.result)
      if (response.result.pullRequest) setPullRequest(response.result.pullRequest)
      if (response.result.outcome === "merged") {
        appToast.success({ title: `Merged into ${targetBranch}`, description: response.result.message })
      }
    } catch (mergeError) {
      setError(mergeError instanceof Error ? mergeError.message : String(mergeError))
    } finally {
      pendingAction.current = false
      setMerging(false)
    }
  }

  const createPullRequest = async () => {
    if (!preview?.canCreatePullRequest || preview.unsavedChanges > 0 || pendingAction.current) return
    pendingAction.current = true
    setMerging(true)
    setError(null)
    try {
      const response = await sessions.createPullRequest(publicSessionId, preview.checkpointOid, preview.targetOid)
      if (!response.success) throw new Error(response.error)
      setPullRequest(response.result)
    } catch (failure) {
      setPreview(null)
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      pendingAction.current = false
      setMerging(false)
    }
  }

  const pullRequestUrl = pullRequest?.url ?? result?.pullRequestUrl ?? preview?.pullRequestUrl ?? null
  const merged = result?.outcome === "merged"
  const canMerge = Boolean(preview && preview.clean && preview.ahead > 0 && !result && !loading && !merging)
  const close = () => onOpenChange(false)

  return (
    <Dialog open={isOpen} onOpenChange={(open) => (merging ? undefined : onOpenChange(open))}>
      <DialogContent className="sm:max-w-[480px]">
        <DialogHeader>
          <DialogTitle>
            Merge <span className="font-mono">{branchName}</span> into <span className="font-mono">{targetBranch}</span>
          </DialogTitle>
          <DialogDescription>
            The merge takes the session&apos;s last save to Git, never the live files, so everyone&apos;s unsaved edits
            stay out of it.
          </DialogDescription>
        </DialogHeader>

        <div className="py-2">
          <MergeSessionBody
            targetBranch={targetBranch}
            preview={preview}
            loading={loading}
            error={error}
            result={result}
            strategy={strategy}
            onStrategyChange={setStrategy}
            saveNote={saveNote}
            onSaveNow={() => void saveNow()}
            onCheckAgain={() => void load()}
          />
        </div>

        <DialogFooter>
          {merged ? (
            <>
              {canManage ? (
                <>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onPause()
                      close()
                    }}
                  >
                    Pause the session
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      onEnd()
                      close()
                    }}
                  >
                    End the session
                  </Button>
                </>
              ) : null}
              <Button type="button" onClick={close}>
                Keep the session going
              </Button>
            </>
          ) : (
            <>
              <Button type="button" variant="outline" onClick={close} disabled={merging}>
                {result ? "Close" : "Cancel"}
              </Button>
              {result?.outcome === "moved" ? (
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => {
                    setResult(null)
                    void load()
                  }}
                >
                  Review again
                </Button>
              ) : null}
              {pullRequest ? <p role="status">Pull request #{pullRequest.number} is open.</p> : null}
              {preview?.canCreatePullRequest && !pullRequest ? (
                <Button type="button" variant="outline" disabled={loading || merging || preview.unsavedChanges > 0 || preview.ahead === 0 || result?.outcome === "moved"}
                  onClick={() => void createPullRequest()}>
                  Create or find PR
                </Button>
              ) : null}
              {pullRequestUrl ? (
                <Button type="button" variant="outline" onClick={() => void window.electronAPI.shell.openExternal(pullRequestUrl)}>
                  Open pull request
                </Button>
              ) : null}
              {!result ? (
                <Button type="button" onClick={() => void merge()} disabled={!canMerge}>
                  {merging ? <Spinner size="xs" className="mr-1.5" /> : null}
                  {merging ? "Merging…" : `Merge into ${targetBranch}`}
                </Button>
              ) : null}
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
