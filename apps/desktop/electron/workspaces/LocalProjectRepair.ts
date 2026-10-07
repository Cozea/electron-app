import fs from "node:fs/promises"
import path from "node:path"
import * as Effect from "effect/Effect"

import type {
  LocalProjectResult, LocalProjectWorkspaceOutcome, ProjectOperationDTO,
  RepairLocalProjectRequest,
} from "../../../../shared/localProjectTypes.ts"
import type { LocalWorkspaceDTO } from "../../../../shared/workspaceTypes.ts"
import type { LocalProjectCatalogInterface } from "./LocalProjectCatalog.ts"

export interface LocalProjectRepairHooks {
  /** Must stop old local ownership and acknowledge the exact new daemon binding. */
  prepareRuntime: (previous: LocalWorkspaceDTO, next: LocalWorkspaceDTO) => Promise<void>
}

export interface LocalProjectRepairDependencies {
  projects: LocalProjectCatalogInterface
  getWorkspace: (workspaceId: string) => Effect.Effect<LocalWorkspaceDTO | null, unknown>
  setActive: (workspaceId: string, projectId: string) => Effect.Effect<void, unknown>
  prepareBinding: (workspaceId: string, folder: string, expectedRevision: number) => Effect.Effect<LocalProjectResult<LocalWorkspaceDTO>, unknown>
  commitBinding: (workspaceId: string, folder: string, expectedRevision: number) => Effect.Effect<LocalProjectResult<LocalWorkspaceDTO>, unknown>
}

const failed = (error: string): { success: false; error: string } => ({ success: false, error })
const attempt = <A>(run: () => Promise<A>) => Effect.tryPromise({
  try: run, catch: (error) => error instanceof Error ? error : new Error(String(error)),
})

/** Folder location changes retain project/workspace/lane identity and immutable evidence. */
export function makeLocalProjectRepair(deps: LocalProjectRepairDependencies) {
  const resume = (operationId: string, hooks: LocalProjectRepairHooks): Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>> => Effect.gen(function* () {
    let operation = yield* deps.projects.getOperation(operationId)
    if (!operation || operation.kind !== "repair" || operation.state === "cancelled") return failed("An active folder repair receipt is required.")
    const project = yield* deps.projects.get(operation.projectId)
    if (!project || project.status === "removed") return failed("This project is no longer active on this device.")
    const { sourceFolder, workspaceId, expectedWorkspaceRevision } = operation.details
    if (!sourceFolder || !workspaceId || !expectedWorkspaceRevision) return failed("The repair receipt has no complete binding evidence.")
    const advance = (state: ProjectOperationDTO["state"], stage?: ProjectOperationDTO["stage"]) => Effect.gen(function* () {
      const result = yield* deps.projects.advanceOperation({ operationId, expectedRevision: operation!.revision, state, stage })
      if (!result.success) return yield* Effect.fail(new Error(result.error))
      operation = result.value
    })
    return yield* Effect.gen(function* () {
      const stat = yield* attempt(() => fs.stat(sourceFolder))
      if (!stat.isDirectory() || (yield* attempt(() => fs.realpath(sourceFolder))) !== sourceFolder ||
        String(stat.dev) !== operation!.details.sourceDevice || String(stat.ino) !== operation!.details.sourceInode ||
        String(stat.birthtimeMs) !== operation!.details.sourceBirthtime) {
        return yield* Effect.fail(new Error("The repair folder changed. Its contents were preserved; select the original folder again."))
      }
      const previous = yield* deps.getWorkspace(workspaceId)
      if (!previous || previous.projectId !== project.projectId) return failed("The original workspace binding is unavailable.")
      if (operation!.state === "completed") {
        if (previous.projectRootPath !== sourceFolder || previous.workspaceRevision !== Number(expectedWorkspaceRevision) + 1) return failed("This repair was superseded by another binding. Open the current project instead.")
        yield* deps.setActive(workspaceId, project.projectId)
        return { success: true as const, value: { project, workspace: { ...previous, isActive: true }, operationId, reusedExisting: true } }
      }
      yield* advance("running", operation!.stage)
      const prepared = yield* deps.prepareBinding(workspaceId, sourceFolder, Number(expectedWorkspaceRevision))
      if (!prepared.success) return yield* Effect.fail(new Error(prepared.error))
      // On replay the catalog may already be committed. The daemon receipt is
      // still required; a reply lost after registration must not invent v+2.
      yield* attempt(() => hooks.prepareRuntime(previous, prepared.value))
      if (operation!.stage === "requested") yield* advance("running", "prepared")
      const committed = yield* deps.commitBinding(workspaceId, sourceFolder, Number(expectedWorkspaceRevision))
      if (!committed.success) return yield* Effect.fail(new Error(committed.error))
      yield* advance("running", "binding_committed")
      yield* deps.setActive(workspaceId, project.projectId)
      const activated = yield* deps.projects.completeRepairedCreation(operation!)
      if (!activated.success) return yield* Effect.fail(new Error(activated.error))
      yield* advance("completed")
      return { success: true as const, value: { project: activated.value, workspace: { ...committed.value, isActive: true }, operationId, reusedExisting: true } }
    }).pipe(Effect.catch((error) => Effect.gen(function* () {
      const message = error instanceof Error ? error.message : String(error)
      const current = yield* deps.projects.getOperation(operationId)
      if (current?.state === "running" && current.revision === operation!.revision) yield* deps.projects.advanceOperation({
        operationId, expectedRevision: current.revision, state: "unknown", lastError: message.slice(0, 2000),
      })
      return failed(message)
    })))
  })

  const repair = (request: RepairLocalProjectRequest, hooks: LocalProjectRepairHooks): Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>> => Effect.gen(function* () {
    if (!request || typeof request.folderPath !== "string" || !path.isAbsolute(request.folderPath) || request.folderPath.length > 4096) return failed("A valid absolute repair folder is required.")
    const folder = yield* attempt(() => fs.realpath(request.folderPath))
    const workspace = yield* deps.getWorkspace(request.workspaceId)
    if (!workspace || workspace.projectId !== request.projectId) return failed("The selected workspace does not belong to this project.")
    const namedOperation = yield* deps.projects.getOperation(request.operationId)
    const existing = namedOperation ?? (yield* deps.projects.getPendingRepair(request.workspaceId))
    if (existing) {
      if (existing.kind !== "repair" || existing.projectId !== request.projectId || existing.details.workspaceId !== request.workspaceId || existing.details.sourceFolder !== folder) return failed("This workspace has another repair in progress. Retry its recorded folder before starting a different repair.")
      return yield* resume(existing.operationId, hooks)
    }
    // Inspect before allocating a receipt: an unrelated/copy/replacement folder
    // must not pin recovery to an invalid selection.
    const prepared = yield* deps.prepareBinding(request.workspaceId, folder, workspace.workspaceRevision)
    if (!prepared.success) return prepared
    const stat = yield* attempt(() => fs.stat(folder))
    const started = yield* deps.projects.beginOperation({
      operationId: request.operationId, projectId: request.projectId, kind: "repair", details: {
        workspaceId: request.workspaceId, previousFolder: workspace.projectRootPath,
        expectedWorkspaceRevision: String(workspace.workspaceRevision), sourceFolder: folder,
        sourceDevice: String(stat.dev), sourceInode: String(stat.ino), sourceBirthtime: String(stat.birthtimeMs),
      },
    })
    if (!started.success) return started
    return yield* resume(request.operationId, hooks)
  }).pipe(Effect.catch((error) => Effect.succeed(failed(error instanceof Error ? error.message : String(error)))))

  return { repair, resume }
}
