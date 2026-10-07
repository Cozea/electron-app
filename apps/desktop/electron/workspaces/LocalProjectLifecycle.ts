import fs from "node:fs/promises"
import path from "node:path"
import crypto from "node:crypto"
import * as Effect from "effect/Effect"
import * as Semaphore from "effect/Semaphore"

import type {
  CreateLocalProjectRequest, OpenLocalProjectRequest, LocalProjectResult,
  LocalProjectWorkspaceOutcome, ProjectOperationDetails,
  ProjectOperationStage,
  RepairLocalProjectRequest,
  CloseLocalProjectWorkspaceRequest, RemoveLocalProjectRequest, LocalProjectRemovalOutcome,
  ProjectOperationDTO,
} from "../../../../shared/localProjectTypes.ts"
import type { BindExistingFolderResult, LocalWorkspaceDTO } from "../../../../shared/workspaceTypes.ts"
import type { LocalProjectCatalogInterface } from "./LocalProjectCatalog.ts"
import { readWorkspaceMarker, writeWorkspaceMarker } from "./markers.ts"
import { runGitCommand } from "../gitRuntime.ts"
import { makeLocalProjectRepair, type LocalProjectRepairDependencies, type LocalProjectRepairHooks } from "./LocalProjectRepair.ts"
import type { makeLocalProjectRemoval, LocalProjectRemovalHooks } from "./LocalProjectRemoval.ts"
import { makeLocalProjectClose, type LocalProjectCloseHooks } from "./LocalProjectClose.ts"

interface ManagedRoot {
  rootId: string
  realPath: string
}

export interface LocalProjectLifecycleDependencies {
  removal?: Effect.Success<ReturnType<typeof makeLocalProjectRemoval>>
  projects: LocalProjectCatalogInterface
  resolveManagedRoot: (parentFolder?: string) => Effect.Effect<ManagedRoot, unknown>
  findByPath: (folderPath: string) => Effect.Effect<LocalWorkspaceDTO | null, unknown>
  isPathReserved: (folderPath: string, operationId: string) => Effect.Effect<boolean, unknown>
  getWorkspace: (workspaceId: string) => Effect.Effect<LocalWorkspaceDTO | null, unknown>
  getRuntimeRoots: (workspaceId: string) => Effect.Effect<string[], unknown>
  setActive: (workspaceId: string, projectId: string) => Effect.Effect<void, unknown>
  bindManaged: (projectId: string, folderPath: string, workspaceId: string, rootId: string) => Effect.Effect<BindExistingFolderResult, unknown>
  attach: (projectId: string, folderPath: string) => Effect.Effect<BindExistingFolderResult, unknown>
  prepareRepairBinding: LocalProjectRepairDependencies["prepareBinding"]
  commitRepairBinding: LocalProjectRepairDependencies["commitBinding"]
}

export interface LocalProjectLifecycleInterface {
  create: (request: CreateLocalProjectRequest) => Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  open: (request: OpenLocalProjectRequest) => Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  resume: (operationId: string) => Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  repair: (request: RepairLocalProjectRequest, hooks: LocalProjectRepairHooks) => Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  resumeRepair: (operationId: string, hooks: LocalProjectRepairHooks) => Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  close: (request: CloseLocalProjectWorkspaceRequest, hooks: LocalProjectCloseHooks) => Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  resumeClose: (operationId: string, hooks: LocalProjectCloseHooks) => Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>>
  remove: (request: RemoveLocalProjectRequest, hooks: LocalProjectRemovalHooks) => Effect.Effect<LocalProjectResult<LocalProjectRemovalOutcome>>
  resumeRemove: (operationId: string, hooks: LocalProjectRemovalHooks) => Effect.Effect<LocalProjectResult<LocalProjectRemovalOutcome>>
  cancelRemove: (operationId: string, hooks: LocalProjectRemovalHooks) => Effect.Effect<LocalProjectResult<ProjectOperationDTO>>
  confirmTrashOutcome: (operationId: string, workspaceId: string) => Effect.Effect<LocalProjectResult<ProjectOperationDTO>>
  cancelClose: (operationId: string) => Effect.Effect<LocalProjectResult<ProjectOperationDTO>>
}

function failed(error: string): { success: false; error: string } {
  return { success: false, error }
}

function attempt<A>(run: () => Promise<A>): Effect.Effect<A, Error> {
  return Effect.tryPromise({ try: run, catch: (error) => error instanceof Error ? error : new Error(String(error)) })
}

/** Owns local folder effects. No cloud calls, renderer callbacks or deletion. */
export const makeLocalProjectLifecycle = (deps: LocalProjectLifecycleDependencies) => Effect.gen(function* () {
  // Serialize path allocation and binding in this catalog, including competing
  // import requests. Operation revision checks also reject stale IPC updates.
  const semaphore = yield* Semaphore.make(1)
  const projects = deps.projects

  const reconcile = (operationId: string): Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>> => Effect.gen(function* () {
    let operation = yield* projects.getOperation(operationId)
    if (!operation || (operation.kind !== "create" && operation.kind !== "attach")) return failed("A local create or attachment operation is required.")
    const initialProject = yield* projects.get(operation.projectId)
    if (!initialProject || initialProject.status === "removed" || operation.state === "cancelled") return failed("This project operation is no longer active.")

    const verifySource = (folder: string) => Effect.gen(function* () {
      const stat = yield* attempt(() => fs.stat(folder))
      const canonical = yield* attempt(() => fs.realpath(folder))
      if (!stat.isDirectory() || canonical !== folder || String(stat.dev) !== operation!.details.sourceDevice ||
        String(stat.ino) !== operation!.details.sourceInode || String(stat.birthtimeMs) !== operation!.details.sourceBirthtime) {
        return yield* Effect.fail(new Error("The selected source folder changed. Open the intended folder again; Cozea has preserved its contents."))
      }
    })

    const verifyBinding = (workspace: LocalWorkspaceDTO) => Effect.gen(function* () {
      if (operation!.kind === "attach") return yield* verifySource(operation!.details.sourceFolder!)
      const folder = workspace.projectRootPath
      const stat = yield* attempt(() => fs.lstat(folder))
      const canonical = yield* attempt(() => fs.realpath(folder))
      const marker = yield* attempt(() => readWorkspaceMarker(folder))
      if (!stat.isDirectory() || stat.isSymbolicLink() || canonical !== folder ||
        marker?.marker.projectId !== initialProject.projectId || marker.marker.workspaceId !== workspace.workspaceId) {
        return yield* Effect.fail(new Error("The created folder's ownership changed. Locate it explicitly before continuing."))
      }
    })

    const advance = (stage: ProjectOperationStage, details?: ProjectOperationDetails) => Effect.gen(function* () {
      const result = yield* projects.advanceOperation({
        operationId, expectedRevision: operation!.revision, state: "running", stage, details,
      })
      if (!result.success) return yield* Effect.fail(new Error(result.error))
      operation = result.value
    })

    const finish = (workspace: LocalWorkspaceDTO) => Effect.gen(function* () {
      const activated = yield* projects.setStatus(initialProject.projectId, "active")
      if (!activated.success) return yield* Effect.fail(new Error(activated.error))
      if (operation!.state !== "completed") {
        const completed = yield* projects.advanceOperation({
          operationId, expectedRevision: operation!.revision, state: "completed",
        })
        if (!completed.success) return yield* Effect.fail(new Error(completed.error))
        operation = completed.value
      }
      return { success: true as const, value: {
        project: activated.value, workspace, operationId, reusedExisting: false,
      } }
    })

    const run = Effect.gen(function* () {
      const recordedWorkspace = operation!.details.workspaceId
        ? yield* deps.getWorkspace(operation!.details.workspaceId)
        : null
      if (recordedWorkspace) {
        const expectedPath = operation!.kind === "create" ? operation!.details.destinationFolder : operation!.details.sourceFolder
        if (recordedWorkspace.projectId !== initialProject.projectId || recordedWorkspace.projectRootPath !== expectedPath) {
          return yield* Effect.fail(new Error("The recorded workspace no longer matches this operation. Locate its folder before continuing."))
        }
        yield* verifyBinding(recordedWorkspace)
        if (operation!.state !== "completed") {
          yield* advance("binding_committed")
          yield* deps.setActive(recordedWorkspace.workspaceId, recordedWorkspace.projectId)
        }
        return yield* finish(recordedWorkspace)
      }
      if (operation!.state === "completed") return failed("This completed operation's workspace was forgotten. Open the folder explicitly to attach it again.")

      // A process can exit after the row is inserted but before the receipt is
      // advanced. Find that binding before attempting any filesystem effect.
      const recordedPath = operation!.details.destinationFolder ?? operation!.details.sourceFolder
      const existing = recordedPath ? yield* deps.findByPath(recordedPath) : null
      if (existing) {
        if (existing.projectId !== initialProject.projectId) return yield* Effect.fail(new Error("This folder is already attached to another project."))
        yield* verifyBinding(existing)
        yield* advance("binding_committed", { workspaceId: existing.workspaceId })
        yield* deps.setActive(existing.workspaceId, existing.projectId)
        return yield* finish(existing)
      }
      yield* advance(operation!.stage)

      let binding: BindExistingFolderResult
      if (operation!.kind === "attach") {
        const folder = operation!.details.sourceFolder
        if (!folder) return yield* Effect.fail(new Error("The attachment has no recorded source folder."))
        yield* verifySource(folder)
        binding = yield* deps.attach(initialProject.projectId, folder)
      } else {
        if (!operation!.details.destinationFolder) {
          const root = yield* deps.resolveManagedRoot(operation!.details.parentFolder)
          let candidate = path.join(root.realPath, initialProject.slug)
          let suffix = 1
          while (true) {
            const exists = yield* attempt(async () => {
              try { await fs.lstat(candidate); return true }
              catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") return false; throw error }
            })
            if (!exists && !(yield* deps.isPathReserved(candidate, operationId))) break
            if (suffix >= 1000) return yield* Effect.fail(new Error("No available project folder was found. Choose another parent folder."))
            candidate = path.join(root.realPath, `${initialProject.slug}-${++suffix}`)
          }
          yield* advance("prepared", {
            destinationFolder: candidate, managedRootId: root.rootId,
            workspaceId: `lws_${crypto.randomUUID().replace(/-/g, "")}`,
          })
        }
        const folder = operation!.details.destinationFolder!
        const workspaceId = operation!.details.workspaceId!
        const rootId = operation!.details.managedRootId!
        const parent = yield* attempt(() => fs.realpath(path.dirname(folder)))
        const root = yield* deps.resolveManagedRoot(operation!.details.parentFolder)
        if (parent !== root.realPath || rootId !== root.rootId) return yield* Effect.fail(new Error("The managed parent folder changed. Locate the intended folder before continuing."))
        if (operation!.stage === "effect_applied" || operation!.stage === "binding_committed") {
          yield* attempt(() => fs.access(folder))
        }
        const created = yield* attempt(async () => {
          try { await fs.mkdir(folder); return true }
          catch (error) { if ((error as NodeJS.ErrnoException).code === "EEXIST") return false; throw error }
        })
        if (!created) {
          const stat = yield* attempt(() => fs.lstat(folder))
          const marker = yield* attempt(() => readWorkspaceMarker(folder))
          if (!stat.isDirectory() || stat.isSymbolicLink() || marker?.marker.projectId !== initialProject.projectId ||
            marker.marker.workspaceId !== workspaceId) {
            return yield* Effect.fail(new Error("The reserved folder exists without this operation's ownership marker. Its contents were preserved; locate it explicitly to recover."))
          }
        } else {
          // Write ownership before Git initialization or any project contents.
          // A crash between mkdir and this write remains explicitly uncertain.
          yield* attempt(() => writeWorkspaceMarker(folder, {
            version: 1, workspaceId, projectId: initialProject.projectId, createdBy: "cozea", createdAt: operation!.createdAt,
          }))
        }
        if (operation!.stage === "prepared") {
          const gitResult = yield* attempt(() => runGitCommand(["init"], { cwd: folder }))
          if (!gitResult.success) return yield* Effect.fail(new Error(gitResult.stderr || "Git initialization failed. Retry this operation to retain its folder."))
          yield* attempt(async () => {
            try { await fs.writeFile(path.join(folder, ".gitignore"), "node_modules/\n.env\n", { encoding: "utf8", flag: "wx" }) }
            catch (error) { if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error }
          })
          yield* advance("effect_applied")
        }
        binding = yield* deps.bindManaged(initialProject.projectId, folder, workspaceId, rootId)
      }
      if (!binding.success || !binding.workspace) return yield* Effect.fail(new Error(binding.error ?? "The folder could not be bound to this project."))
      yield* advance("binding_committed", { workspaceId: binding.workspace.workspaceId })
      return yield* finish(binding.workspace)
    })

    return yield* run.pipe(Effect.catch((error) => Effect.gen(function* () {
      const message = error instanceof Error ? error.message : String(error)
      const latest = yield* projects.getOperation(operationId)
      if (latest?.state === "running" && latest.revision === operation!.revision) {
        yield* projects.advanceOperation({ operationId, expectedRevision: latest.revision, state: "unknown", lastError: message.slice(0, 2000) })
      }
      return failed(message)
    })))
  })

  const create = (request: CreateLocalProjectRequest) => semaphore.withPermits(1)(Effect.gen(function* () {
    if (!request || (request.parentFolder !== undefined && (typeof request.parentFolder !== "string" || !path.isAbsolute(request.parentFolder) || request.parentFolder.length > 4096))) return failed("A valid absolute parent folder is required.")
    const entry = yield* projects.createEntry({
      operationId: request.operationId, name: request.name, slug: request.slug,
      details: { parentFolder: request.parentFolder, initGit: true },
    })
    if (!entry.success) return entry
    return yield* reconcile(request.operationId)
  }))

  const open = (request: OpenLocalProjectRequest) => semaphore.withPermits(1)(Effect.gen(function* () {
    if (!request || typeof request.folderPath !== "string" || !path.isAbsolute(request.folderPath) || request.folderPath.length > 4096) return failed("A valid absolute source folder is required.")
    const folder = yield* attempt(() => fs.realpath(request.folderPath))
    const stat = yield* attempt(() => fs.stat(folder))
    if (!stat.isDirectory()) return failed("The selected source is not a directory.")
    const existing = yield* deps.findByPath(folder)
    if (existing) {
      yield* projects.backfillWorkspaceEntries()
      const project = yield* projects.get(existing.projectId)
      if (!project || project.status === "removed") return failed("This workspace has no active local project entry.")
      if (project.status === "provisioning") {
        const operation = yield* projects.getCreationOperation(project.projectId)
        if (!operation) return failed("This project's creation receipt is missing. Recover it before continuing.")
        return yield* reconcile(operation.operationId)
      }
      yield* deps.setActive(existing.workspaceId, existing.projectId)
      return { success: true as const, value: { project, workspace: { ...existing, isActive: true }, operationId: null, reusedExisting: true } }
    }
    // A prior attachment may have committed its intent before the binding or
    // reply was lost. Reopening that folder reconciles the same local identity.
    const interrupted = yield* projects.getPendingAttachment(folder)
    if (interrupted) return yield* reconcile(interrupted.operationId)
    const entry = yield* projects.createEntry({
      operationId: request.operationId, kind: "attach", name: request.name, slug: request.slug,
      details: { sourceFolder: folder, sourceDevice: String(stat.dev), sourceInode: String(stat.ino), sourceBirthtime: String(stat.birthtimeMs) },
    })
    if (!entry.success) return entry
    return yield* reconcile(request.operationId)
  }).pipe(Effect.catch((error) => Effect.succeed(failed(error instanceof Error ? error.message : String(error))))))

  const repairs = makeLocalProjectRepair({ projects, getWorkspace: deps.getWorkspace, setActive: deps.setActive,
    prepareBinding: deps.prepareRepairBinding, commitBinding: deps.commitRepairBinding })
  const closes = makeLocalProjectClose({ projects, getWorkspace: deps.getWorkspace, getRuntimeRoots: deps.getRuntimeRoots })
  return {
    create, open, resume: (operationId: string) => semaphore.withPermits(1)(reconcile(operationId)),
    repair: (request, hooks) => semaphore.withPermits(1)(repairs.repair(request, hooks)),
    resumeRepair: (operationId, hooks) => semaphore.withPermits(1)(repairs.resume(operationId, hooks)),
    close: (request, hooks) => semaphore.withPermits(1)(closes.close(request, hooks)),
    resumeClose: (operationId, hooks) => semaphore.withPermits(1)(closes.resume(operationId, hooks)),
    remove: (request, hooks) => semaphore.withPermits(1)(deps.removal ? deps.removal.remove(request, hooks) : Effect.succeed(failed("Removal is unavailable."))),
    resumeRemove: (operationId, hooks) => semaphore.withPermits(1)(deps.removal ? deps.removal.resume(operationId, hooks) : Effect.succeed(failed("Removal is unavailable."))),
    cancelRemove: (operationId, hooks) => semaphore.withPermits(1)(deps.removal ? deps.removal.cancel(operationId, hooks) : Effect.succeed(failed("Removal is unavailable."))),
    confirmTrashOutcome: (operationId, workspaceId) => semaphore.withPermits(1)(deps.removal ? deps.removal.confirmTrashOutcome(operationId, workspaceId) : Effect.succeed(failed("Removal is unavailable."))),
    cancelClose: (operationId) => semaphore.withPermits(1)(closes.cancel(operationId)),
  } satisfies LocalProjectLifecycleInterface
})
