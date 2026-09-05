import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { CollaborationSessionDescriptor } from "@shared/collaborationSession"
import { checkCollaborationTarget, type CollaborationTargetCheck } from "@shared/collaborationTargetBranch"

interface Props { session: CollaborationSessionDescriptor; readOnly: boolean; disabled: boolean; onEndForRestart(): void }
export function CollaborationTargetBranch({ session, readOnly, disabled, onEndForRestart }: Props) {
  const { projectId, repositoryId, targetBranch, targetCommitSha, sessionBranch } = session
  const [check, setCheck] = useState<CollaborationTargetCheck | null>(null)
  const [continuedSha, setContinuedSha] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [checking, setChecking] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const retry = useCallback(() => setRefresh(value => value + 1), [])
  useEffect(() => {
    let alive = true
    setChecking(true); setError(null)
    void window.electronAPI.collaboration.runtime.resolve({ projectId, branch: targetBranch })
      .then(resolved => { if (alive) setCheck(checkCollaborationTarget({ repositoryId, targetBranch, targetCommitSha }, resolved)) })
      .catch(error => { if (alive) { setCheck(null); setError(error instanceof Error ? error.message : "Could not check the target branch") } })
      .finally(() => { if (alive) setChecking(false) })
    return () => { alive = false }
  }, [projectId, repositoryId, targetBranch, targetCommitSha, refresh])
  const needsChoice = check && check.status !== "unchanged" && check.commitSha !== continuedSha
  return <div className="space-y-2 rounded border p-3 text-xs">
    <div className="flex items-center justify-between gap-2"><span>Target: {targetBranch}{check && ` · ${check.commitSha.slice(0, 12)}`}</span><Button size="sm" variant="outline" disabled={disabled || checking} onClick={retry}>{checking ? "Checking target…" : "Check target"}</Button></div>
    {error && <p role="alert" className="text-destructive">{error}. Your session remains on {sessionBranch}; retry the target check when access returns.</p>}
    {needsChoice ? <>
      <p role="status">{check.status === "changed" ? "The target branch has changed since this session started." : "This older session has no recorded starting target commit."} Shared work continues on {sessionBranch}.</p>
      <p>To use the current target, end this session and review a new start. This ends collaboration for everyone. Unpublished work stays in the retained session workspace; a new session starts from the target without importing it.</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled} onClick={() => setContinuedSha(check.commitSha)}>Continue on session branch</Button>{!readOnly && <Button size="sm" variant="destructive" disabled={disabled || checking} onClick={onEndForRestart}>End session and review new start</Button>}</div>
    </> : check && <p>{check.status === "unchanged" ? "Target matches the session’s starting commit." : "Continuing on the session branch."} Check again before deciding to restart.</p>}
  </div>
}
