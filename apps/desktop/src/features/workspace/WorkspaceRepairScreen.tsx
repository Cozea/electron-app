import { useCallback, useState } from "react"

import { downloadAuthorizedProjectRepository } from "@/features/collaboration/api/downloadAuthorizedProjectRepository"
import type { ResolveProjectWorkspaceResult, WorkspaceResolutionAction } from "@shared/workspaceTypes"

interface ProjectLike {
  _id: string
  slug?: string | null
  name?: string | null
}

interface WorkspaceRepairScreenProps {
  result: Exclude<ResolveProjectWorkspaceResult, { status: "ready" }>
  project: ProjectLike
  onAction?: (action: WorkspaceResolutionAction) => void
}

export function WorkspaceRepairScreen({
  result,
  project,
  onAction,
}: WorkspaceRepairScreenProps) {
  const projectLabel = project.name ?? project.slug ?? project._id
  const [downloading, setDownloading] = useState(false)
  const [downloadError, setDownloadError] = useState<string | null>(null)

  const handleAction = useCallback(async (action: WorkspaceResolutionAction) => {
    if (action.kind !== "clone") {
      onAction?.(action)
      return
    }

    setDownloading(true)
    setDownloadError(null)
    try {
      await downloadAuthorizedProjectRepository({
        projectId: project._id,
        slug: project.slug ?? project._id,
      })
      window.location.reload()
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not download the project"
      // A project without a collaboration repository binding still belongs to
      // the existing local/manual clone flow. Authorization and remote errors
      // remain visible instead of silently embedding credentials in a URL.
      if (message.includes("does not have an enabled organization repository binding")) {
        onAction?.(action)
      } else {
        setDownloadError(message)
      }
    } finally {
      setDownloading(false)
    }
  }, [onAction, project._id, project.slug])

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex max-w-md flex-col gap-2">
        <h2 className="text-lg font-semibold text-foreground">{headingFor(result)}</h2>
        <p className="text-sm text-muted-foreground">{descriptionFor(result, projectLabel)}</p>

        {"workspace" in result && result.workspace ? (
          <p className="mt-1 rounded bg-muted px-3 py-1 font-mono text-xs text-muted-foreground">
            {result.workspace.displayPath}
          </p>
        ) : null}

        {downloadError ? (
          <p role="alert" className="mt-1 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
            {downloadError}
          </p>
        ) : null}

        {"candidates" in result && result.candidates && result.candidates.length > 0 ? (
          <div className="mt-3 flex flex-col gap-1 text-left">
            <p className="text-xs font-medium text-muted-foreground">Possible folders found:</p>
            {result.candidates.map((candidate) => (
              <button
                key={candidate.path}
                type="button"
                disabled={downloading}
                onClick={() => void handleAction({
                  kind: "bind-candidate",
                  folderPath: candidate.path,
                  label: "Use this folder",
                })}
                className="rounded border border-border bg-muted/50 px-3 py-2 text-left text-xs hover:bg-muted disabled:opacity-50"
              >
                <span className="font-mono">{candidate.path}</span>
                {candidate.reasons.length > 0 ? (
                  <span className="ml-2 text-muted-foreground">— {candidate.reasons[0]}</span>
                ) : null}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {result.actions.length > 0 ? (
        <div className="flex flex-wrap justify-center gap-2">
          {result.actions.map((action) => (
            <ActionButton
              key={action.kind + ("workspaceId" in action ? action.workspaceId : "")}
              action={action}
              disabled={downloading}
              loading={downloading && action.kind === "clone"}
              onAction={(next) => void handleAction(next)}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ActionButton({
  action,
  disabled,
  loading,
  onAction,
}: {
  action: WorkspaceResolutionAction
  disabled?: boolean
  loading?: boolean
  onAction?: (action: WorkspaceResolutionAction) => void
}) {
  const isDestructive = action.kind === "forget"
  return (
    <button
      type="button"
      disabled={disabled}
      onClick={() => onAction?.(action)}
      className={
        isDestructive
          ? "rounded-md border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10 disabled:opacity-50"
          : "rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted disabled:opacity-50"
      }
    >
      {loading ? "Downloading…" : action.label}
    </button>
  )
}

function headingFor(result: Exclude<ResolveProjectWorkspaceResult, { status: "ready" }>): string {
  switch (result.status) {
    case "missing-binding":
      return "No local workspace linked"
    case "broken-binding":
      switch (result.reason) {
        case "missing":
          return "Workspace folder not found"
        case "marker-mismatched-project":
          return "Workspace belongs to a different project"
        case "marker-mismatched-workspace":
          return "Workspace identity mismatch"
        case "repo-mismatched":
          return "Repository does not match"
        default:
          return "Workspace needs repair"
      }
    case "ambiguous":
      return "Multiple matching folders found"
    case "needs-clone":
      return "Repository not downloaded yet"
    default:
      return "Workspace unavailable"
  }
}

function descriptionFor(
  result: Exclude<ResolveProjectWorkspaceResult, { status: "ready" }>,
  projectLabel: string,
): string {
  switch (result.status) {
    case "missing-binding":
      return `"${projectLabel}" is not linked to a local folder on this device.`
    case "broken-binding":
      switch (result.reason) {
        case "missing":
          return "The linked folder no longer exists. It may have been moved or deleted."
        case "marker-mismatched-project":
          return "The linked folder's workspace marker identifies a different project. It may have been reassigned."
        default:
          return "The linked workspace could not be verified."
      }
    case "ambiguous":
      return `Found ${result.candidates.length} possible folders. Choose one to link.`
    case "needs-clone":
      return `"${projectLabel}" is available from its organization repository but has not been downloaded to this device.`
    default:
      return "This workspace is not available."
  }
}
