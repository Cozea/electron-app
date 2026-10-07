import fs from "node:fs/promises"
import path from "node:path"
import * as Effect from "effect/Effect"
import * as SqlClient from "@effect/sql/SqlClient"
import type {
  LocalProjectResult, LocalProjectRemovalOutcome, RemoveLocalProjectRequest, ProjectOperationDTO,
  ProjectOperationEffect, ProjectRemovalWorkspace,
} from "../../../../shared/localProjectTypes.ts"
import type { LocalProjectCatalogInterface } from "./LocalProjectCatalog.ts"

export interface LocalProjectRemovalHooks {
  prepare(operationId: string, projectId: string, scope: readonly ProjectRemovalWorkspace[]): Promise<void>
  removeData(operationId: string, projectId: string, scope: readonly ProjectRemovalWorkspace[]): Promise<void>
  finalize(operationId: string, projectId: string, scope: readonly ProjectRemovalWorkspace[]): Promise<void>
  cancel(operationId: string, projectId: string): Promise<void>
  trash(folder: string): Promise<void>
}
interface RemovalDependencies {
  projects: LocalProjectCatalogInterface
  capture(projectId: string, operationId: string, trash: boolean): Effect.Effect<ProjectRemovalWorkspace[], unknown>
}
const failure = (error: string): LocalProjectResult<never> => ({ success: false, error })
const fingerprint = (scope: readonly ProjectRemovalWorkspace[]) => JSON.stringify(scope.map(({ workspace: w, roots }) => ({
  workspaceId: w.workspaceId, projectId: w.projectId, revision: w.workspaceRevision, rootPath: w.rootPath,
  projectRootPath: w.projectRootPath, ownership: w.storageOwnership, managedRootId: w.managedRootId, roots,
})).sort((a, b) => a.workspaceId.localeCompare(b.workspaceId)))
const stat = async (folder: string) => { try { return await fs.lstat(folder) } catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return null; throw error } }
const matches = (entry: Awaited<ReturnType<typeof stat>>, proof: NonNullable<ProjectRemovalWorkspace["trash"]>) => Boolean(entry?.isDirectory() && String(entry.dev) === proof.device && String(entry.ino) === proof.inode && String(entry.birthtimeMs) === proof.birthtime)

async function prepareQuarantine(proof: NonNullable<ProjectRemovalWorkspace["trash"]>, operationId: string, workspaceId: string): Promise<void> {
  const container = path.dirname(proof.staging)
  const markerPath = path.join(container, ".cozea-removal.json")
  let created = false
  try { await fs.mkdir(container, { mode: 0o700 }); created = true }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
  const physical = await fs.lstat(container)
  if (!physical.isDirectory()) throw new Error("The saved quarantine container was replaced.")
  const evidence = JSON.stringify({ operationId, workspaceId, device: String(physical.dev), inode: String(physical.ino), birthtime: String(physical.birthtimeMs) })
  if (created) {
    const marker = await fs.open(markerPath, "wx", 0o600)
    try { await marker.writeFile(evidence); await marker.sync() } finally { await marker.close() }
  }
  if (await fs.readFile(markerPath, "utf8") !== evidence || (await fs.readdir(container)).some((name) => !["source", ".cozea-removal.json"].includes(name))) throw new Error("The quarantine contains unproven data. Inspect it before continuing removal.")
}

export const makeLocalProjectRemoval = (deps: RemovalDependencies) => Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const effects = (operationId: string) => sql<ProjectOperationEffect>`SELECT effect_id, state, evidence_json FROM project_operation_effects WHERE operation_id = ${operationId}`
  const saveEffect = (operationId: string, effectId: string, state: ProjectOperationEffect["state"], evidenceJson = "{}") => sql`
    INSERT INTO project_operation_effects(operation_id, effect_id, state, evidence_json, updated_at)
    VALUES (${operationId}, ${effectId}, ${state}, ${evidenceJson}, ${Date.now()})
    ON CONFLICT(operation_id, effect_id) DO UPDATE SET state = excluded.state, updated_at = excluded.updated_at
    WHERE project_operation_effects.evidence_json = excluded.evidence_json
  `.pipe(Effect.asVoid)
  const receipt = (operationId: string) => Effect.gen(function* () {
    const op = yield* deps.projects.getOperation(operationId)
    if (!op || op.kind !== "remove" || op.requestDetails.closeOnly !== false || !op.details.removalScopeJson) return yield* Effect.fail(new Error("This receipt is not a permanent local removal."))
    const scope = JSON.parse(op.details.removalScopeJson) as ProjectRemovalWorkspace[]
    return { op, scope }
  })
  const invoke = <A>(run: () => Promise<A>) => Effect.tryPromise({ try: run, catch: (error) => error })
  const resume = (operationId: string, hooks: LocalProjectRemovalHooks): Effect.Effect<LocalProjectResult<LocalProjectRemovalOutcome>> => Effect.gen(function* () {
    let { op, scope } = yield* receipt(operationId)
    const outcome = () => ({ success: true as const, value: { projectId: op.projectId, operationId, retainedLocalData: !op.requestDetails.removeLocalData } })
    if (op.state === "completed") return outcome()
    if (op.state === "cancelled") return failure("This removal was cancelled.")
    const lease = yield* sql<{ operationId: string; scopeJson: string }>`SELECT operation_id, scope_json FROM project_exclusions WHERE project_id = ${op.projectId}`
    if (lease[0]?.operationId !== operationId || lease[0].scopeJson !== op.details.removalScopeJson) return failure("The saved removal does not own this project's exclusion.")
    const progress = yield* deps.projects.advanceOperation({ operationId, expectedRevision: op.revision, state: "running", stage: op.stage === "requested" ? "prepared" : op.stage })
    if (!progress.success) return progress
    op = progress.value
    const run = yield* Effect.gen(function* () {
      let saved = yield* effects(operationId)
      if (!saved.some((effect) => effect.effectId === "catalog" && effect.state === "applied")) {
        const current = yield* deps.capture(op.projectId, operationId, false)
        if (fingerprint(current) !== fingerprint(scope)) return yield* Effect.fail(new Error("The project bindings changed. Review this saved removal before proceeding."))
        // Native exclusion and quiescence are rechecked on every explicit retry.
        yield* invoke(() => hooks.prepare(operationId, op.projectId, scope))
        if (op.requestDetails.removeLocalData && !saved.some((effect) => effect.effectId === "data" && effect.state === "applied")) {
          yield* saveEffect(operationId, "data", "requested")
          yield* invoke(() => hooks.removeData(operationId, op.projectId, scope))
          yield* saveEffect(operationId, "data", "applied")
        }
        for (const entry of scope) {
          if (!entry.trash) continue
          const proof = entry.trash
          const quarantineId = `quarantine:${entry.workspace.workspaceId}`
          const trashId = `trash:${entry.workspace.workspaceId}`
          saved = yield* effects(operationId)
          if (saved.some((effect) => effect.effectId === trashId && effect.state === "applied")) continue
          const staged = yield* invoke(() => stat(proof.staging))
          const original = yield* invoke(() => stat(proof.folder))
          const quarantine = saved.find((effect) => effect.effectId === quarantineId)
          if (!quarantine) yield* saveEffect(operationId, quarantineId, "requested", JSON.stringify(proof))
          if (staged && !matches(staged, proof)) return yield* Effect.fail(new Error("The quarantine location contains a different folder. Nothing there was moved to Trash."))
          if (!staged) {
            if (quarantine?.state === "applied" || saved.some((effect) => effect.effectId === trashId)) return yield* Effect.fail(new Error(`Trash outcome needs inspection for ${entry.workspace.workspaceId}. Confirm it explicitly after checking Trash; Retry never deletes a replacement.`))
            if (!matches(original, proof)) return yield* Effect.fail(new Error("The original managed folder changed. Nothing was moved to Trash."))
            yield* invoke(() => prepareQuarantine(proof, operationId, entry.workspace.workspaceId))
            yield* invoke(() => fs.rename(proof.folder, proof.staging))
            const moved = yield* invoke(() => stat(proof.staging))
            if (!matches(moved, proof)) return yield* Effect.fail(new Error("The staged folder's identity is unavailable. Inspect its saved removal."))
          } else if (original && matches(original, proof)) return yield* Effect.fail(new Error("The original folder also exists. The quarantine needs inspection."))
          yield* invoke(() => prepareQuarantine(proof, operationId, entry.workspace.workspaceId))
          yield* saveEffect(operationId, quarantineId, "applied", JSON.stringify(proof))
          const previousTrash = saved.find((effect) => effect.effectId === trashId)
          if (previousTrash) return yield* Effect.fail(new Error(`Trash outcome needs inspection for ${entry.workspace.workspaceId}. Retry never repeats an uncertain Trash call.`))
          yield* saveEffect(operationId, trashId, "requested")
          yield* invoke(() => hooks.trash(path.dirname(proof.staging)))
          if (yield* invoke(() => stat(path.dirname(proof.staging)))) return yield* Effect.fail(new Error("Trash has not confirmed disposal of the staged folder. Inspect this saved removal."))
          yield* saveEffect(operationId, trashId, "applied")
        }
        yield* invoke(() => hooks.finalize(operationId, op.projectId, scope))
        // Retain a permanent exclusion and the journal keys after detaching rows.
        yield* sql.withTransaction(Effect.gen(function* () {
          const current = yield* deps.capture(op.projectId, operationId, false)
          if (fingerprint(current) !== fingerprint(scope)) return yield* Effect.fail(new Error("The saved removal's bindings changed before commit."))
          yield* sql`DELETE FROM workspace_lanes WHERE project_id = ${op.projectId}`
          yield* sql`DELETE FROM local_workspaces WHERE project_id = ${op.projectId}`
          yield* sql`DELETE FROM local_projects_cache WHERE project_id = ${op.projectId}`
          yield* sql`UPDATE local_projects SET status = 'removed', updated_at = ${Date.now()} WHERE project_id = ${op.projectId}`
          yield* sql`UPDATE project_exclusions SET state = 'removed', updated_at = ${Date.now()} WHERE project_id = ${op.projectId} AND operation_id = ${operationId}`
          yield* saveEffect(operationId, "catalog", "applied")
        }))
      }
      const completed = yield* deps.projects.advanceOperation({ operationId, expectedRevision: op.revision, state: "completed" })
      if (!completed.success) return yield* Effect.fail(new Error(completed.error))
      return outcome()
    }).pipe(Effect.result)
    if (run._tag === "Success") return run.success
    const error = run.failure instanceof Error ? run.failure.message : String(run.failure)
    yield* deps.projects.advanceOperation({ operationId, expectedRevision: op.revision, state: "unknown", lastError: error.slice(0, 2000) })
    return failure(error)
  }).pipe(Effect.catch((error) => Effect.succeed(failure(error instanceof Error ? error.message : String(error)))))

  const remove = (request: RemoveLocalProjectRequest, hooks: LocalProjectRemovalHooks) => Effect.gen(function* () {
    if (!request || !/^[a-zA-Z0-9_-]{1,128}$/.test(request.operationId) || typeof request.removeLocalData !== "boolean" || typeof request.trashManagedFolder !== "boolean") return failure("A valid immutable removal request is required.")
    const existing = yield* deps.projects.getOperation(request.operationId)
    if (existing) {
      if (existing.projectId !== request.projectId || existing.requestDetails.removeLocalData !== request.removeLocalData || existing.requestDetails.trashManagedFolder !== request.trashManagedFolder) return failure("This operation ID belongs to a different retention choice.")
      return yield* resume(request.operationId, hooks)
    }
    const project = yield* deps.projects.get(request.projectId)
    if (!project || project.status !== "active") return failure("This local project is unavailable.")
    const pending = (yield* deps.projects.listRecoverableOperations(request.projectId)).find((operation) => operation.kind === "remove" && operation.requestDetails.closeOnly === false)
    if (pending) return failure("Recover or cancel the saved removal before choosing another retention policy.")
    const scope = yield* deps.capture(request.projectId, request.operationId, request.trashManagedFolder)
    if (scope.length > 32 || request.removeLocalData && !scope.length) return failure("The project's retained data scope needs inspection.")
    const scopeJson = JSON.stringify(scope)
    const reserved = yield* sql.withTransaction(Effect.gen(function* () {
      if (fingerprint(yield* deps.capture(request.projectId, request.operationId, false)) !== fingerprint(scope)) return failure("The project bindings changed before removal was reserved.")
      const unfinished = yield* deps.projects.listRecoverableOperations(request.projectId)
      if (unfinished.some((operation) => ["create", "attach", "repair", "remove", "share", "github_repo"].includes(operation.kind))) return failure("Finish or cancel the project's saved operations before removing it.")
      const op = yield* deps.projects.beginOperation({ operationId: request.operationId, projectId: request.projectId, kind: "remove", details: {
        closeOnly: false, removeLocalData: request.removeLocalData, trashManagedFolder: request.trashManagedFolder, removalScopeJson: scopeJson,
      } })
      if (!op.success) return op
      yield* sql`INSERT INTO project_exclusions(project_id, operation_id, state, scope_json, updated_at) VALUES (${request.projectId}, ${request.operationId}, 'removing', ${scopeJson}, ${Date.now()})`
      return op
    }))
    if (!reserved.success) return reserved
    return yield* resume(request.operationId, hooks)
  }).pipe(Effect.catch((error) => Effect.succeed(failure(error instanceof Error ? error.message : String(error)))))
  const cancel = (operationId: string, hooks: LocalProjectRemovalHooks): Effect.Effect<LocalProjectResult<ProjectOperationDTO>> => Effect.gen(function* () {
    let { op } = yield* receipt(operationId)
    if (op.state === "cancelled") return { success: true as const, value: op }
    if (op.state === "completed" || (yield* effects(operationId)).length) return failure("Removal already reached a data or folder effect. Recover its saved scope; cancelling cannot restore erased data.")
    yield* invoke(() => hooks.cancel(operationId, op.projectId))
    return yield* sql.withTransaction(Effect.gen(function* () {
      if (op.state !== "failed") {
        const result = yield* deps.projects.advanceOperation({ operationId, expectedRevision: op.revision, state: "failed" })
        if (!result.success) return result
        op = result.value
      }
      const result = yield* deps.projects.advanceOperation({ operationId, expectedRevision: op.revision, state: "cancelled" })
      if (result.success) yield* sql`DELETE FROM project_exclusions WHERE project_id = ${op.projectId} AND operation_id = ${operationId} AND state = 'removing'`
      return result
    }))
  }).pipe(Effect.catch((error) => Effect.succeed(failure(error instanceof Error ? error.message : String(error)))))
  const confirmTrashOutcome = (operationId: string, workspaceId: string): Effect.Effect<LocalProjectResult<ProjectOperationDTO>> => Effect.gen(function* () {
    const { op, scope } = yield* receipt(operationId)
    const entry = scope.find((item) => item.workspace.workspaceId === workspaceId)
    const pending = (yield* effects(operationId)).find((effect) => effect.effectId === `trash:${workspaceId}`)
    if (!entry?.trash || !pending || op.state === "completed" || op.state === "cancelled") return failure("There is no uncertain Trash effect for this workspace.")
    if (yield* invoke(() => stat(path.dirname(entry.trash!.staging)))) return failure("The staged folder still exists. Inspect it before confirming Trash.")
    yield* saveEffect(operationId, `trash:${workspaceId}`, "applied")
    return { success: true as const, value: op }
  }).pipe(Effect.catch((error) => Effect.succeed(failure(error instanceof Error ? error.message : String(error)))))
  return { remove, resume, cancel, confirmTrashOutcome }
})
