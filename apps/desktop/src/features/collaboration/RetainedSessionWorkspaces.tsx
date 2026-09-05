import { useCallback, useEffect, useState } from "react"
import { Button } from "@/components/ui/button"
import type { SessionWorkspaceBinding } from "@shared/collaborationDesktop"
import { listRetainedCollaborationWorkspaces } from "@shared/collaborationRetainedWorkspaces"
import { CollaborationRecoveryPanel } from "./CollaborationRecoveryPanel"

interface Props { projectId: string; activeSessionId: string | null; disabled: boolean; onResume(id: string): void }
export function RetainedSessionWorkspaces({ projectId, activeSessionId, disabled, onResume }: Props) {
  const [sessions, setSessions] = useState<SessionWorkspaceBinding[]>([])
  const [error, setError] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  const [revealing, setRevealing] = useState(false)
  const reload = useCallback(() => setRefresh(value => value + 1), [])
  useEffect(() => {
    if (disabled) return
    let alive = true
    setError(null)
    void listRetainedCollaborationWorkspaces(projectId, {
      listForProject: async id => {
        const workspace = window.electronAPI.workspace
        if (!workspace) throw new Error("Local workspace controls are unavailable; reopen the project")
        return workspace.listForProject(id)
      },
      bindingForWorkspace: id => window.electronAPI.collaboration.bindingForWorkspace(id),
      getBinding: id => window.electronAPI.collaboration.getBinding(id),
    }).then(rows => { if (alive) setSessions(rows) }).catch(error => { if (alive) { setSessions([]); setError(error instanceof Error ? error.message : "Retained workspaces could not be loaded") } })
    return () => { alive = false }
  }, [projectId, activeSessionId, disabled, refresh])
  const reveal = async (workspaceId: string) => {
    setRevealing(true); setError(null)
    try {
      const result = await window.electronAPI.project.openFolder({ workspaceId })
      if (!result.success) throw new Error(result.error ?? "The retained workspace folder is unavailable")
    } catch (error) { setError(error instanceof Error ? error.message : "Could not open the retained folder") }
    finally { setRevealing(false) }
  }
  return <details className="space-y-2 rounded border p-3 text-xs">
    <summary className="cursor-pointer font-medium">Retained session workspaces ({sessions.filter(session => session.sessionId !== activeSessionId).length})</summary>
    <p>Leaving or ending keeps each session’s local files and recovery data. These folders remain separate from your ordinary workspace.</p>
    {error && <p role="alert" className="text-destructive">{error}</p>}
    <Button size="sm" variant="outline" disabled={disabled || revealing} onClick={reload}>Refresh local sessions</Button>
    {sessions.filter(session => session.sessionId !== activeSessionId).map(session => <div key={session.sessionId} className="space-y-2 rounded border p-2">
      <p className="break-all">{session.sessionBranch} · {session.state === "ended" ? "Ended" : "Retained"}</p>
      <div className="flex flex-wrap gap-2"><Button size="sm" variant="outline" disabled={disabled || revealing} onClick={() => void reveal(session.workspaceId)}>Open retained folder</Button>{session.state !== "ended" && <Button size="sm" variant="outline" disabled={disabled || Boolean(activeSessionId)} onClick={() => onResume(session.sessionId)}>Resume session</Button>}</div>
      <CollaborationRecoveryPanel sessionId={session.sessionId} disabled={disabled || revealing} />
    </div>)}
  </details>
}
