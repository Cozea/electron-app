import { useEffect, useState } from "react"
import type { ProjectOperationDTO } from "@shared/localProjectTypes"
import { Button } from "@/components/ui/button"
import { requireLocalProjectsApi } from "@/features/projects/lib/localProjectsApi"
import { useNavigateTo } from "@/lib/navigation"
import { buildProjectRouteNavigationState } from "@/contexts/project/projectNavigationState"
import { useWorkspaceRuntimeStore } from "@/lib/workspaceRuntimeStore"
import { clearProjectBranchSession } from "@/features/source-control/model/projectBranchSessionStore"
import { clearCachedProjectLaneState } from "@/features/workbench/hooks/useProjectLaneState"
import { evictTerminalViewsForWorkspace } from "@/features/terminal/terminalViewKeepAlive"

interface LocalProjectRecoveryPanelProps {
  projectId?: string
}

const labels: Partial<Record<ProjectOperationDTO["kind"], string>> = {
  create: "Create project", attach: "Open folder", repair: "Repair folder",
  remove: "Remove from this device", github_repo: "GitHub repository setup",
  share: "Share project", delete_shared: "Delete shared project",
}

function recoveryMessage(message: string): string {
  return /^connect (?:ENOENT|ECONNREFUSED|ETIMEDOUT)\b/.test(message)
    ? "Local project services are unavailable. Wait a moment and retry, or restart Cozea."
    : message
}

export function LocalProjectRecoveryPanel({ projectId }: LocalProjectRecoveryPanelProps) {
  const navigateTo = useNavigateTo()
  const [operations, setOperations] = useState<ProjectOperationDTO[]>([])
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [refresh, setRefresh] = useState(0)
  useEffect(() => {
    let cancelled = false
    setOperations([])
    void requireLocalProjectsApi().listRecoverableOperations(projectId).then((next) => {
      if (!cancelled) setOperations(next)
    }, (failure: unknown) => {
      if (!cancelled) setError(failure instanceof Error ? failure.message : String(failure))
    })
    return () => { cancelled = true }
  }, [projectId, refresh])

  async function retry(operation: ProjectOperationDTO) {
    if (busy) return
    setBusy(operation.operationId)
    setError(null)
    try {
      const api = requireLocalProjectsApi()
      if (operation.kind === "remove" && operation.requestDetails.closeOnly === false) {
        const result = await api.resumeRemove(operation.operationId)
        if (!result.success) throw new Error(result.error)
        navigateTo({ to: "projects" }, { replace: true })
        return
      }
      const isClose = operation.kind === "remove" && operation.requestDetails.closeOnly === true
      const result = isClose ? await api.resumeClose(operation.operationId) : operation.kind === "repair"
        ? await api.resumeRepair(operation.operationId)
        : await api.resume(operation.operationId)
      if (!result.success) throw new Error(result.error)
      const { project, workspace } = result.value
      if (operation.kind === "repair" || isClose) {
        for (const record of Object.values(useWorkspaceRuntimeStore.getState().runtimes)) {
          if (record.config.projectId === project.projectId && record.config.workspaceId === workspace.workspaceId) useWorkspaceRuntimeStore.getState().actions.closeRuntime(record.runtimeId)
        }
        clearProjectBranchSession(project.projectId, workspace.workspaceId)
        clearCachedProjectLaneState(project.projectId, workspace.workspaceId)
        evictTerminalViewsForWorkspace(workspace.workspaceId)
      }
      if (isClose) {
        navigateTo({ to: "projects" }, { replace: true })
        return
      }
      navigateTo({ to: "workbench", projectId: project.projectId }, { state: buildProjectRouteNavigationState({
        projectId: project.projectId, projectSlug: project.slug, projectName: project.name,
        preferredWorkspaceId: workspace.workspaceId,
      }) })
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : String(failure))
    } finally {
      setBusy(null)
      setRefresh((value) => value + 1)
    }
  }

  async function cancelClose(operationId: string, permanent = false) {
    if (busy) return
    setBusy(operationId)
    setError(null)
    try {
      const result = await (permanent ? requireLocalProjectsApi().cancelRemove(operationId) : requireLocalProjectsApi().cancelClose(operationId))
      if (!result.success) throw new Error(result.error)
    } catch (failure) { setError(failure instanceof Error ? failure.message : String(failure)) }
    finally { setBusy(null); setRefresh((value) => value + 1) }
  }

  if (!operations.length && !error) return null
  return (
    <section className="mt-6 w-full max-w-4xl space-y-3 rounded-lg border p-4" aria-label="Project recovery">
      <h2 className="text-sm font-medium">Project recovery</h2>
      <p className="text-sm text-muted-foreground">These attempts were interrupted. Retry uses the saved project and folder.</p>
      {operations.map((operation) => {
        const isClose = operation.kind === "remove" && operation.requestDetails.closeOnly === true
        const permanent = operation.kind === "remove" && operation.requestDetails.closeOnly === false
        const retryable = permanent || operation.kind === "create" || operation.kind === "attach" || operation.kind === "repair" || isClose
        return (
          <div key={operation.operationId} className="flex items-start justify-between gap-4 border-t pt-3">
            <div className="min-w-0 space-y-1 text-sm">
              <p className="font-medium">{isClose ? "Close workspace" : labels[operation.kind]}{operation.requestDetails.name ? ` — ${operation.requestDetails.name}` : ""}</p>
              <p className="break-all text-muted-foreground">{operation.details.sourceFolder ?? operation.details.destinationFolder}</p>
              {operation.lastError ? <p className="text-muted-foreground">{recoveryMessage(operation.lastError)}</p> : null}
              {isClose ? <p className="text-muted-foreground">Files, conversations, drafts and layouts are retained.</p> : null}
              {permanent ? <p className="text-muted-foreground">Saved choices: {operation.requestDetails.removeLocalData ? "erase local conversations and data" : "retain conversations and data"}; {operation.requestDetails.trashManagedFolder ? "Trash managed folders" : "keep source folders"}. Attached folders stay on disk.</p> : null}
              {!retryable ? <p className="text-muted-foreground">Its outcome needs inspection before another attempt.</p> : null}
            </div>
            <div className="flex shrink-0 gap-2">
              {permanent ? <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void cancelClose(operation.operationId, true)}>Cancel Removal</Button> : null}
              {permanent && operation.lastError?.includes("Trash outcome needs inspection") ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => {
                const workspaceId = operation.lastError?.match(/inspection for ([a-zA-Z0-9_-]+)/)?.[1]
                if (!workspaceId) return
                void (async () => {
                  const answer = await window.electronAPI.dialog.showMessageBox({ type: "question", buttons: ["Cancel", "I Checked Trash"], defaultId: 0, cancelId: 0,
                    title: "Confirm Trash Outcome", message: "Confirm the saved managed folder is in Trash.", detail: `Check Trash for .cozea-remove-${operation.operationId}-${workspaceId}. This acknowledgment only records your inspection; it does not move or delete another folder.` })
                  if (answer.response !== 1) return
                  const result = await requireLocalProjectsApi().confirmTrashOutcome(operation.operationId, workspaceId)
                  if (!result.success) throw new Error(result.error)
                  setRefresh((value) => value + 1)
                })().catch((failure: unknown) => setError(failure instanceof Error ? failure.message : String(failure)))
              }}>Confirm Trash Outcome</Button> : null}
              {isClose ? <Button size="sm" variant="ghost" disabled={busy !== null} onClick={() => void cancelClose(operation.operationId)}>Cancel Close</Button> : null}
              {retryable ? <Button size="sm" variant="outline" disabled={busy !== null} onClick={() => void retry(operation)}>{busy === operation.operationId ? "Recovering…" : "Retry"}</Button> : null}
            </div>
          </div>
        )
      })}
      {error ? <div className="flex items-center justify-between gap-4"><p className="text-sm text-destructive" role="alert">{recoveryMessage(error)}</p><Button size="sm" variant="outline" disabled={busy !== null} onClick={() => { setError(null); setRefresh((value) => value + 1) }}>Refresh</Button></div> : null}
    </section>
  )
}
