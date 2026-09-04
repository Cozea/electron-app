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

  return (
    <div className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center">
      <div className="flex flex-col gap-2 max-w-md">
        <h2 className="text-lg font-semibold text-foreground">
          {headingFor(result)}
        </h2>
        <p className="text-sm text-muted-foreground">
          {descriptionFor(result, projectLabel)}
        </p>

        {"workspace" in result && result.workspace && (
          <p className="mt-1 rounded bg-muted px-3 py-1 font-mono text-xs text-muted-foreground">
            {result.workspace.displayPath}
          </p>
        )}

        {"candidates" in result && result.candidates && result.candidates.length > 0 && (
          <div className="mt-3 flex flex-col gap-1 text-left">
            <p className="text-xs font-medium text-muted-foreground">Possible folders found:</p>
            {result.candidates.map((c) => (
              <button
                key={c.path}
                type="button"
                onClick={() => onAction?.({ kind: "bind-candidate", folderPath: c.path, label: "Use this folder" })}
                className="rounded border border-border bg-muted/50 px-3 py-2 text-left text-xs hover:bg-muted"
              >
                <span className="font-mono">{c.path}</span>
                {c.reasons.length > 0 && (
                  <span className="ml-2 text-muted-foreground">— {c.reasons[0]}</span>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {result.actions.length > 0 && (
        <div className="flex flex-wrap gap-2 justify-center">
          {result.actions.map((action) => (
            <ActionButton
              key={action.kind + ("workspaceId" in action ? action.workspaceId : "")}
              action={action}
              onAction={onAction}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function ActionButton({
  action,
  onAction,
}: {
  action: WorkspaceResolutionAction
  onAction?: (action: WorkspaceResolutionAction) => void
}) {
  const isDestructive = action.kind === "forget"
  return (
    <button
      onClick={() => onAction?.(action)}
      className={
        isDestructive
          ? "rounded-md border border-destructive/40 px-4 py-2 text-sm text-destructive hover:bg-destructive/10"
          : "rounded-md border border-border bg-background px-4 py-2 text-sm hover:bg-muted"
      }
    >
      {action.label}
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
      return "Repository not cloned yet"
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
          return `The linked folder's workspace marker identifies a different project. It may have been reassigned.`
        default:
          return "The linked workspace could not be verified."
      }
    case "ambiguous":
      return `Found ${result.candidates.length} possible folders. Choose one to link.`
    case "needs-clone":
      return `"${projectLabel}" has a repository that hasn't been cloned to this device yet.`
    default:
      return "This workspace is not available."
  }
}
