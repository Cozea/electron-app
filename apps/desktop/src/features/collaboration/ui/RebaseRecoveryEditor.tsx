import { useEffect, useRef, useState } from "react"
import type { ProjectdRebaseChoice, ProjectdRebaseRecoveryRequest, ProjectdRebaseRecoveryResponse, ProjectdRebaseResult, ProjectdRebaseReview } from "@cozea/projectd-protocol"
import { Button } from "@/components/ui/button"
import { Textarea } from "@/components/ui/textarea"

interface RebaseRecoveryEditorProps {
  publicSessionId: string
  recoveryId?: string
  onApplied: (result: ProjectdRebaseResult) => void
}

export function RebaseRecoveryEditor({ publicSessionId, recoveryId, onApplied }: RebaseRecoveryEditorProps) {
  const [review, setReview] = useState<ProjectdRebaseReview | null>(null)
  const [journals, setJournals] = useState<NonNullable<ProjectdRebaseRecoveryResponse["journals"]>>([])
  const [choices, setChoices] = useState<Record<string, ProjectdRebaseChoice>>({})
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const generation = useRef(0)
  const accept = (response: ProjectdRebaseRecoveryResponse) => {
    if (response.journals) setJournals(response.journals)
    if (response.review) { setReview(response.review); setChoices({}) }
    if (response.result) { setReview(null); onApplied(response.result) }
  }
  const run = async (request: ProjectdRebaseRecoveryRequest) => {
    const current = generation.current
    setBusy(true)
    setError(null)
    try {
      const result = await window.electronAPI.projectd.sessions.rebaseRecovery(publicSessionId, request)
      if (current !== generation.current) return
      if (!result.success) throw new Error(result.error)
      accept(result.response)
      if (request.action === "cancel") { setReview(null); setJournals((rows) => rows.filter((row) => row.id !== request.recoveryId)) }
    } catch (failure) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Could not complete the rebase operation")
    } finally { if (current === generation.current) setBusy(false) }
  }
  useEffect(() => {
    const current = ++generation.current
    setReview(null)
    setChoices({})
    setError(null)
    setBusy(true)
    const request: ProjectdRebaseRecoveryRequest = recoveryId ? { action: "review", recoveryId } : { action: "list" }
    void window.electronAPI.projectd.sessions.rebaseRecovery(publicSessionId, request).then((result) => {
      if (current !== generation.current) return
      if (!result.success) throw new Error(result.error)
      if (result.response.journals) setJournals(result.response.journals)
      if (result.response.review) setReview(result.response.review)
    }).catch((failure: unknown) => {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Could not load retained rebases")
    }).finally(() => { if (current === generation.current) setBusy(false) })
    return () => { generation.current++ }
  }, [publicSessionId, recoveryId])
  const paths = [...new Set(review?.variants.map((variant) => variant.path) ?? [])]
  const stageName = (stage: number) => stage === 1 ? "Base" : stage === 2 ? "Rebased target" : "Session commit"
  return <div className="space-y-3" aria-busy={busy}>
    {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
    {!review && journals.length > 0 && <div className="space-y-2">
      <p className="text-sm">Retained rebases on this Mac</p>
      {journals.map((journal) => <Button key={journal.id} variant="outline" size="sm" disabled={busy}
        onClick={() => void run({ action: "review", recoveryId: journal.id })}>Review {new Date(journal.createdAt).toLocaleString()}</Button>)}
    </div>}
    {review && <>
      <p className="text-xs text-muted-foreground">Resolutions are prepared separately. Apply updates the live session and rewrites the reviewed Git history.</p>
      {review.state === "adopting" && <p className="text-sm">An earlier Apply was interrupted. Retry Apply to finish saving the retained rebase.</p>}
      <div className="max-h-80 space-y-4 overflow-auto">
        {paths.map((filePath) => <div key={filePath} className="space-y-2 rounded-md border p-3">
          <p className="break-all font-mono text-xs">{filePath}</p>
          {review.variants.filter((variant) => variant.path === filePath).map((variant) => <details key={variant.stage}>
            <summary className="text-xs">{stageName(variant.stage)} · {variant.mode}</summary>
            <pre className="max-h-32 overflow-auto whitespace-pre-wrap text-xs">{variant.text ?? "Binary or large content: preview unavailable. This variant can still be selected."}</pre>
            <Button variant={choices[filePath]?.kind === "variant" && choices[filePath].stage === variant.stage ? "default" : "outline"}
              size="sm" disabled={busy} onClick={() => setChoices((prior) => ({ ...prior, [filePath]: { path: filePath, kind: "variant", stage: variant.stage } }))}>Use {stageName(variant.stage)}</Button>
          </details>)}
          <div className="flex gap-2">
            <Button size="sm" variant={choices[filePath]?.kind === "delete" ? "default" : "outline"} disabled={busy}
              onClick={() => setChoices((prior) => ({ ...prior, [filePath]: { path: filePath, kind: "delete" } }))}>Delete file</Button>
            <Button size="sm" variant={choices[filePath]?.kind === "content" ? "default" : "outline"} disabled={busy}
              onClick={() => setChoices((prior) => ({ ...prior, [filePath]: { path: filePath, kind: "content", text: review.variants.find((variant) => variant.path === filePath && variant.stage === 3)?.text ?? "",
                executable: review.variants.some((variant) => variant.path === filePath && variant.stage === 3 && variant.mode === "100755") } }))}>Edit text</Button>
          </div>
          {choices[filePath]?.kind === "content" && <Textarea aria-label={`Resolution for ${filePath}`} disabled={busy} value={choices[filePath].text}
            onChange={(event) => { const text = event.target.value; setChoices((prior) => ({ ...prior, [filePath]: { ...prior[filePath] as Extract<ProjectdRebaseChoice, { kind: "content" }>, text } })) }} />}
        </div>)}
      </div>
      <div className="flex flex-wrap gap-2">
        {review.state === "conflicted" && <Button disabled={busy || paths.some((filePath) => !choices[filePath]) || !review.fingerprint}
          onClick={() => void run({ action: "resolve", recoveryId: review.recoveryId, fingerprint: review.fingerprint!, choices: paths.map((filePath) => choices[filePath]) })}>Prepare resolution</Button>}
        {(review.state === "computed" || review.state === "adopting") && <Button disabled={busy} onClick={() => void run({ action: "apply", recoveryId: review.recoveryId })}>Apply resolved rebase</Button>}
        {review.state !== "adopting" && <Button variant="outline" disabled={busy} onClick={() => void run({ action: "continue", recoveryId: review.recoveryId })}>Retry / continue</Button>}
        {review.state !== "adopting" && <Button variant="outline" disabled={busy} onClick={() => void run({ action: "cancel", recoveryId: review.recoveryId })}>Discard isolated rebase</Button>}
      </div>
    </>}
  </div>
}
