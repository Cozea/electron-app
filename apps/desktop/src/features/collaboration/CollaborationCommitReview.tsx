import { useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import { Checkbox } from "@/components/ui/checkbox"
import type { PreparedCollaborationCommit } from "@shared/collaborationDesktop"
import type { CollaborationPreparedReview } from "@shared/collaborationCommitReview"

interface CollaborationCommitReviewProps {
  sessionId: string
  prepared: PreparedCollaborationCommit
  disabled: boolean
  onPush(commitSha: string): void
  onDiscard(): void
}

export function CollaborationCommitReview({ sessionId, prepared, disabled, onPush, onDiscard }: CollaborationCommitReviewProps) {
  const [review, setReview] = useState<CollaborationPreparedReview | null>(null)
  const [accepted, setAccepted] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [attempt, setAttempt] = useState(0)
  useEffect(() => {
    let current = true
    setReview(null); setAccepted(false); setError(null)
    void window.electronAPI.collaboration.runtime.reviewPrepared({ sessionId, commitSha: prepared.commitSha }).then(result => {
      if (current) setReview(result)
    }).catch(() => { if (current) setError("The complete prepared diff could not be loaded. Nothing was pushed. Retry review or retain this commit for recovery.") })
    return () => { current = false }
  }, [sessionId, prepared.commitSha, attempt])
  const matches = review?.commitSha === prepared.commitSha && review.sessionId === sessionId
  return <section className="space-y-3 rounded-md border p-3" aria-label="Prepared shared commit review">
    <div className="space-y-1 text-xs"><p className="font-medium">Review the prepared snapshot</p><p className="break-all font-mono">{prepared.commitSha}</p><p className="text-muted-foreground">Through acknowledged update {prepared.throughSequence}. Newer edits stay outside this immutable commit.</p></div>
    {error ? <div className="space-y-2"><p role="alert" className="text-xs text-destructive">{error}</p><Button size="sm" variant="outline" disabled={disabled} onClick={() => setAttempt(value => value + 1)}>Retry review</Button></div> : !review ? <p role="status" className="text-xs">Loading immutable Git objects…</p> : <>
      <p className="whitespace-pre-wrap text-sm">{review.message}</p>
      <div className="max-h-28 overflow-auto text-xs">{review.files.length === 0 ? <p>No file changes in this commit.</p> : review.files.map(file => <p key={file.path} className="break-all"><span className="font-mono">{file.path}</span> · {file.binary ? "Binary change" : `+${file.additions} / −${file.deletions}`}</p>)}</div>
      <pre className="max-h-72 overflow-auto rounded bg-muted p-3 font-mono text-xs" tabIndex={0} aria-label="Exact prepared commit diff">{review.patch || "No file diff."}</pre>
      <label className="flex items-start gap-2 text-xs"><Checkbox checked={accepted} disabled={disabled || !matches} onCheckedChange={checked => setAccepted(checked === true)} /><span>I reviewed this shared-text snapshot and its selected binary changes. Push only this commit to the session branch.</span></label>
    </>}
    <div className="flex flex-wrap gap-2"><Button disabled={disabled || !accepted || !matches} onClick={() => onPush(prepared.commitSha)}>Push {prepared.commitSha.slice(0, 8)}</Button><Button variant="outline" disabled={disabled} onClick={onDiscard}>Discard prepared commit</Button></div>
  </section>
}
