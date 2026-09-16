import type { ResolveProjectWorkspaceResult, WorkspaceResolutionAction } from "@shared/workspaceTypes"

import { Spinner } from "@/components/ui/spinner"
import { cn } from "@/lib/utils"

interface ProjectLike {
  _id: string
  slug?: string | null
  name?: string | null
}

interface WorkspaceRepairScreenProps {
  result: Exclude<ResolveProjectWorkspaceResult, { status: "ready" }>
  project: ProjectLike
  onAction?: (action: WorkspaceResolutionAction) => void
  /** The action currently running. Every control waits on it; the one that started it shows progress. */
  pendingAction?: WorkspaceResolutionAction | null
}

/** Two actions are the same request when their kind and target match. */
function isSameAction(a: WorkspaceResolutionAction, b: WorkspaceResolutionAction): boolean {
  if (a.kind !== b.kind) return false
  if (a.kind === "bind-candidate" && b.kind === "bind-candidate") return a.folderPath === b.folderPath
  if (a.kind === "forget" && b.kind === "forget") return a.workspaceId === b.workspaceId
  return true
}

function workingLabelFor(action: WorkspaceResolutionAction): string {
  switch (action.kind) {
    case "clone":
      return "Cloning repository…"
    case "create":
      return "Creating local folder…"
    case "locate":
    case "bind-candidate":
    case "force-bind":
      return "Linking folder…"
    case "forget":
      return "Forgetting…"
    case "open-found":
      return "Opening…"
  }
}

export function WorkspaceRepairScreen({
  result,
  project,
  onAction,
  pendingAction = null,
}: WorkspaceRepairScreenProps) {
  // A raw project ID means nothing to people; without a name the text reads without one.
  const projectLabel = project.name ?? project.slug ?? null
  const isBusy = pendingAction !== null

  return (
    <div
      className="flex h-full flex-col items-center justify-center gap-6 p-8 text-center"
      aria-busy={isBusy}
    >
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
            {result.candidates.map((c) => {
              const candidateAction: WorkspaceResolutionAction = {
                kind: "bind-candidate",
                folderPath: c.path,
                label: "Use this folder",
              }
              const isThisPending = pendingAction !== null && isSameAction(pendingAction, candidateAction)
              return (
                <button
                  key={c.path}
                  type="button"
                  disabled={isBusy}
                  onClick={() => onAction?.(candidateAction)}
                  className="flex items-center gap-2 rounded border border-border bg-muted/50 px-3 py-2 text-left text-xs hover:bg-muted disabled:cursor-default disabled:opacity-60 disabled:hover:bg-muted/50"
                >
                  {isThisPending ? <Spinner size="xs" label="Linking folder" /> : null}
                  <span className="font-mono">{c.path}</span>
                  {c.reasons.length > 0 && (
                    <span className="ml-2 text-muted-foreground">— {c.reasons[0]}</span>
                  )}
                </button>
              )
            })}
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
              disabled={isBusy}
              pending={pendingAction !== null && isSameAction(pendingAction, action)}
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
  disabled,
  pending,
}: {
  action: WorkspaceResolutionAction
  onAction?: (action: WorkspaceResolutionAction) => void
  disabled: boolean
  pending: boolean
}) {
  const isDestructive = action.kind === "forget"
  return (
    <button
      type="button"
      disabled={disabled}
      aria-busy={pending}
      onClick={() => onAction?.(action)}
      className={cn(
        "inline-flex items-center gap-2 rounded-md border px-4 py-2 text-sm disabled:cursor-default",
        isDestructive
          ? "border-destructive/40 text-destructive hover:bg-destructive/10 disabled:hover:bg-transparent"
          : "border-border bg-background hover:bg-muted disabled:hover:bg-background",
        // The button doing the work stays at full strength; the ones waiting on it step back.
        disabled && !pending && "opacity-60",
      )}
    >
      {pending ? <Spinner size="sm" /> : null}
      <span aria-live="polite">{pending ? workingLabelFor(action) : action.label}</span>
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
  projectLabel: string | null,
): string {
  const project = projectLabel ? `"${projectLabel}"` : "This project"
  switch (result.status) {
    case "missing-binding":
      return `${project} is not linked to a local folder on this device.`
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
      return `${project} has a repository that hasn't been cloned to this device yet.`
    default:
      return "This workspace is not available."
  }
}
