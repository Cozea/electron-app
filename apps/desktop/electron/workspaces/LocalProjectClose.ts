import * as Effect from "effect/Effect"
import type { CloseLocalProjectWorkspaceRequest, LocalProjectResult, LocalProjectWorkspaceOutcome, ProjectOperationDTO } from "../../../../shared/localProjectTypes.ts"
import type { LocalWorkspaceDTO } from "../../../../shared/workspaceTypes.ts"
import type { LocalProjectCatalogInterface } from "./LocalProjectCatalog.ts"

export interface LocalProjectCloseHooks {
  /** Must acknowledge scoped native shutdown; it must never delete source or history. */
  prepareRuntime(workspace: LocalWorkspaceDTO, roots: readonly string[]): Promise<void>
}

interface CloseDependencies {
  projects: LocalProjectCatalogInterface
  getWorkspace(workspaceId: string): Effect.Effect<LocalWorkspaceDTO | null, unknown>
  getRuntimeRoots(workspaceId: string): Effect.Effect<string[], unknown>
}

function failure(error: string): LocalProjectResult<never> { return { success: false, error } }
const validId = (value: unknown): value is string => typeof value === "string" && /^[a-zA-Z0-9_-]{1,128}$/.test(value)

/** Preservation-only close. Binding, lanes, private conversations and disk are retained. */
export function makeLocalProjectClose(deps: CloseDependencies) {
  const resume = (operationId: string, hooks: LocalProjectCloseHooks): Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>> => Effect.gen(function* () {
    let operation = yield* deps.projects.getOperation(operationId)
    if (!operation || operation.kind !== "remove" || operation.requestDetails.closeOnly !== true ||
      operation.requestDetails.removeLocalData !== false || operation.requestDetails.trashManagedFolder !== false ||
      !operation.details.workspaceId || !operation.details.sourceFolder || !operation.details.expectedWorkspaceRevision || !operation.details.runtimeRootsJson) return failure("This receipt is not a preservation-only workspace close.")
    const project = yield* deps.projects.get(operation.projectId)
    const workspace = yield* deps.getWorkspace(operation.details.workspaceId)
    if (!project || project.status !== "active" || !workspace || workspace.projectId !== project.projectId) return failure("The original project binding is unavailable. Close did not remove any files.")
    // A completed request remains idempotent even after a later repair/reopen.
    if (operation.state === "completed") return { success: true as const, value: { project, workspace, operationId, reusedExisting: true } }
    if (operation.state === "cancelled") return failure("This workspace close was cancelled.")
    const roots = yield* deps.getRuntimeRoots(workspace.workspaceId)
    if (workspace.workspaceRevision !== Number(operation.details.expectedWorkspaceRevision) || workspace.projectRootPath !== operation.details.sourceFolder || JSON.stringify(roots) !== operation.details.runtimeRootsJson) return failure("The workspace changed since close was requested. Its saved scope must be reviewed before retrying.")
    const running = yield* deps.projects.advanceOperation({ operationId, expectedRevision: operation.revision, state: "running", stage: "prepared" })
    if (!running.success) return running
    operation = running.value
    const stopped = yield* Effect.tryPromise({ try: () => hooks.prepareRuntime(workspace, roots), catch: (error) => error }).pipe(Effect.result)
    const current = yield* deps.getWorkspace(workspace.workspaceId)
    const currentRoots = yield* deps.getRuntimeRoots(workspace.workspaceId)
    const error = stopped._tag === "Failure" ? String(stopped.failure instanceof Error ? stopped.failure.message : stopped.failure)
      : !current || current.projectId !== workspace.projectId || current.workspaceRevision !== workspace.workspaceRevision || current.projectRootPath !== workspace.projectRootPath || JSON.stringify(currentRoots) !== operation.details.runtimeRootsJson
        ? "The workspace changed while closing. Retry after reviewing its binding." : null
    const saved = yield* deps.projects.advanceOperation({ operationId, expectedRevision: operation.revision,
      state: error ? "unknown" : "completed", lastError: error?.slice(0, 2000) ?? null })
    if (!saved.success) return saved
    if (error) return failure(error)
    return { success: true as const, value: { project, workspace: current!, operationId, reusedExisting: true } }
  }).pipe(Effect.catch((error) => Effect.succeed(failure(error instanceof Error ? error.message : String(error)))))

  const close = (request: CloseLocalProjectWorkspaceRequest, hooks: LocalProjectCloseHooks) => Effect.gen(function* () {
    if (!request || !validId(request.operationId) || !validId(request.projectId) || !validId(request.workspaceId)) return failure("A valid project, workspace and close request are required.")
    const existing = yield* deps.projects.getOperation(request.operationId)
    if (existing) {
      if (existing.projectId !== request.projectId || existing.details.workspaceId !== request.workspaceId) return failure("This operation ID belongs to another workspace.")
      return yield* resume(existing.operationId, hooks)
    }
    const project = yield* deps.projects.get(request.projectId)
    const workspace = yield* deps.getWorkspace(request.workspaceId)
    if (!project || project.status !== "active" || !workspace || workspace.projectId !== request.projectId) return failure("The local workspace is unavailable.")
    if (yield* deps.projects.getPendingRepair(workspace.workspaceId)) return failure("Recover the saved folder repair before closing this workspace.")
    const pending = yield* deps.projects.getPendingClose(workspace.workspaceId)
    if (pending) return yield* resume(pending.operationId, hooks)
    const roots = yield* deps.getRuntimeRoots(workspace.workspaceId)
    if (!roots.length || roots.length > 64 || JSON.stringify(roots).length > 4096) return failure("The workspace's runtime scope needs inspection before closing.")
    const reserved = yield* deps.projects.beginOperation({ operationId: request.operationId, projectId: project.projectId, kind: "remove", details: {
      closeOnly: true, removeLocalData: false, trashManagedFolder: false, workspaceId: workspace.workspaceId,
      sourceFolder: workspace.projectRootPath, expectedWorkspaceRevision: String(workspace.workspaceRevision), runtimeRootsJson: JSON.stringify(roots),
    } })
    if (!reserved.success) return reserved
    return yield* resume(reserved.value.operationId, hooks)
  }).pipe(Effect.catch((error) => Effect.succeed(failure(error instanceof Error ? error.message : String(error)))))
  const cancel = (operationId: string): Effect.Effect<LocalProjectResult<ProjectOperationDTO>> => Effect.gen(function* () {
    let operation = yield* deps.projects.getOperation(operationId)
    if (!operation || operation.kind !== "remove" || operation.requestDetails.closeOnly !== true || operation.requestDetails.removeLocalData !== false || operation.requestDetails.trashManagedFolder !== false) return failure("This receipt is not a preservation-only workspace close.")
    if (operation.state === "cancelled") return { success: true as const, value: operation }
    if (operation.state === "completed") return failure("This workspace close already completed. Reopen the project to continue.")
    if (operation.state !== "failed") {
      const saved = yield* deps.projects.advanceOperation({ operationId, expectedRevision: operation.revision, state: "failed" })
      if (!saved.success) return saved
      operation = saved.value
    }
    return yield* deps.projects.advanceOperation({ operationId, expectedRevision: operation.revision, state: "cancelled" })
  })
  return { close, resume, cancel }
}
