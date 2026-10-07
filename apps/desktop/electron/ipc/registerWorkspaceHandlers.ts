import type { IpcMain, WebContents } from "electron"
import { shell } from "electron"
import * as Effect from "effect/Effect"
import path from "node:path"
import { realpath } from "node:fs/promises"
import { randomUUID } from "node:crypto"
import type {
  AdvanceProjectOperationRequest,
  BeginProjectOperationRequest,
  CreateLocalProjectEntryRequest,
  CreateLocalProjectRequest,
  OpenLocalProjectRequest,
  ObserveSharedProjectRequest,
  UpdateLocalProjectMetadataRequest,
  LocalProjectResult,
  LocalProjectDTO,
  LocalProjectWorkspaceOutcome,
  RepairLocalProjectRequest,
  CloseLocalProjectWorkspaceRequest, RemoveLocalProjectRequest, LocalProjectRemovalOutcome, ProjectRemovalRendererRequest,
} from "../../../../shared/localProjectTypes.ts"

import type {
  AttachExistingFolderRequest,
  BindExistingFolderRequest,
  CloneWorkspaceForProjectRequest,
  CreateWorkspaceForProjectRequest,
  ImportExistingFolderRequest,
  PreflightExistingFolderRequest,
  ResolveProjectWorkspaceRequest,
} from "../../../../shared/workspaceTypes.ts"
import { WorkspaceCatalog } from "../workspaces/WorkspaceCatalog.ts"
import { waitForWorkspaceCatalogRuntime } from "../workspaces/WorkspaceCatalogRuntime.ts"
import {
  getCatalogSnapshot,
  notifyWorkspaceCatalogChanged,
  flushCatalogSnapshotAfterMutation,
} from "../workspaces/CatalogSnapshot.ts"
import type { AppSettings } from "@cozea/app-contract/electronApi"
import { forgetApprovedExternalReadRoot } from "../fsAccess.ts"
import { DevServerService } from "../services/DevServerService.ts"
import { WorkbenchSessionManager } from "../services/WorkbenchSessionManager.ts"
import { TerminalService } from "../services/TerminalService.ts"
import { getSharedProjectdClient } from "../projectd/ProjectdClient.ts"
import type { LocalProjectRepairHooks } from "../workspaces/LocalProjectRepair.ts"
import type { LocalProjectRemovalHooks } from "../workspaces/LocalProjectRemoval.ts"
import type { LocalProjectCloseHooks } from "../workspaces/LocalProjectClose.ts"
import { getDesktopBackendPool, getPrimaryShadowServerManager } from "../substrate/backend/DesktopBackendPool.ts"

function makeCloseHooks(ensureChatRuntimeReady: () => Promise<void>): LocalProjectCloseHooks { return {
  async prepareRuntime(workspace, roots) {
    const client = getSharedProjectdClient()
    await client.registerWorkspace({ ...workspace })
    const request = { workspaceId: workspace.workspaceId, projectId: workspace.projectId,
      projectRootPath: workspace.projectRootPath, workspaceRevision: workspace.workspaceRevision, preflightOnly: true }
    const check = async (preflightOnly: boolean) => {
      const saved = await client.closeWorkspace({ ...request, preflightOnly })
      if (saved.workspaceId !== request.workspaceId || saved.projectId !== request.projectId || saved.projectRootPath !== request.projectRootPath || saved.workspaceRevision !== request.workspaceRevision) throw new Error("The local session service has not confirmed this workspace close. Retry the saved request.")
    }
    await check(true)
    // Registration is published only after shadow readiness. A close during
    // cold launch must join that preparation rather than see an empty pool.
    await ensureChatRuntimeReady()
    const pool = getDesktopBackendPool()
    const hosts = pool ? pool.listDescriptors().map((descriptor) => pool.getManager(descriptor.id)) : [getPrimaryShadowServerManager()]
    if (!hosts.length || hosts.some((host) => !host)) throw new Error("The chat runtime is unavailable for workspace close. Reconnect and retry.")
    for (const host of hosts) await host!.closeWorkspaceChats({ type: "cozea:workspace-close", requestId: randomUUID(), roots })
    const stopped = await DevServerService.getInstance().stop(workspace.workspaceId)
    if (!stopped.success) throw new Error(stopped.error ?? "The project's Dev Server could not stop. Retry the saved close.")
    // Wait for native terminal exits before session close drops the mirrors.
    await TerminalService.getInstance().closeAllForWorkspace(workspace.workspaceId)
    await WorkbenchSessionManager.getInstance().closeWorkspaceSessions(workspace.projectId, workspace.workspaceId)
    await check(false)
  },
} }

const repairHooks: LocalProjectRepairHooks = {
  async prepareRuntime(previous, next) {
    // Daemon registration transaction rejects session-retained roots before
    // catalog publication. A lost reply is reconciled using the same revision.
    const saved = await getSharedProjectdClient().registerWorkspace({
      workspaceId: next.workspaceId, projectId: next.projectId, rootPath: next.rootPath,
      projectRootPath: next.projectRootPath, projectRootRelativePath: next.projectRootRelativePath,
      gitRootPath: next.gitRootPath, gitOriginUrl: next.gitOriginUrl, source: next.source,
      storageOwnership: next.storageOwnership, managedRootId: next.managedRootId,
      markerPolicy: next.markerPolicy, workspaceRevision: next.workspaceRevision,
    })
    if (saved.workspaceId !== next.workspaceId || saved.projectId !== next.projectId ||
      saved.workspaceRevision !== next.workspaceRevision || saved.rootPath !== next.rootPath ||
      saved.projectRootPath !== next.projectRootPath || saved.gitRootPath !== next.gitRootPath ||
      saved.projectRootRelativePath !== next.projectRootRelativePath ||
      saved.storageOwnership !== next.storageOwnership || saved.managedRootId !== next.managedRootId ||
      saved.markerPolicy !== next.markerPolicy) throw new Error("The local session service has not confirmed this repaired binding. Retry the saved repair.")
    const stopped = await DevServerService.getInstance().stop(previous.workspaceId)
    if (!stopped.success) throw new Error(stopped.error ?? "The project's Dev Server could not stop. Retry repair after stopping it.")
    await WorkbenchSessionManager.getInstance().closeWorkspaceSessions(previous.projectId, previous.workspaceId)
    TerminalService.getInstance().killAllForWorkspace(previous.workspaceId)
  },
}

interface RegisterWorkspaceHandlersDeps {
  loadSettings: () => AppSettings
  saveSettings: (settings: Partial<AppSettings>) => void
  ensureChatRuntimeReady: () => Promise<void>
}

async function run<A>(eff: Effect.Effect<A, unknown, WorkspaceCatalog>): Promise<A> {
  const rt = await waitForWorkspaceCatalogRuntime()
  return rt.runPromise(eff as Effect.Effect<A, never, WorkspaceCatalog>)
}

/** Run a catalog mutation, then refresh + broadcast the pushed snapshot. */
async function runMutating<A>(eff: Effect.Effect<A, unknown, WorkspaceCatalog>): Promise<A> {
  const result = await run(eff)
  notifyWorkspaceCatalogChanged()
  return result
}

async function runLocalLifecycle(
  eff: Effect.Effect<LocalProjectResult<LocalProjectWorkspaceOutcome>, unknown, WorkspaceCatalog>,
): Promise<LocalProjectResult<LocalProjectWorkspaceOutcome>> {
  const result = await run(eff)
  if (!result.success) {
    notifyWorkspaceCatalogChanged()
    return result
  }
  const snapshot = await flushCatalogSnapshotAfterMutation()
  const { project, workspace } = result.value
  if (!snapshot.projects?.[project.projectId] ||
    snapshot.entries[project.projectId]?.workspace.workspaceId !== workspace.workspaceId) {
    return { success: false, error: "The project was saved, but its catalog view is not ready. Retry this request to open the same project." }
  }
  return result
}

async function runLocalPresentation(
  eff: Effect.Effect<LocalProjectResult<LocalProjectDTO>, unknown, WorkspaceCatalog>,
): Promise<LocalProjectResult<LocalProjectDTO>> {
  const result = await run(eff)
  if (!result.success) return result
  const snapshot = await flushCatalogSnapshotAfterMutation()
  const saved = snapshot.projects?.[result.value.projectId]
  if (!saved || saved.localName !== result.value.localName || saved.hidden !== result.value.hidden) {
    return { success: false, error: "The preferences were saved, but their catalog view is not ready. Check the project before retrying." }
  }
  return result
}

export function registerWorkspaceHandlers(
  ipcMain: IpcMain,
  deps: RegisterWorkspaceHandlersDeps,
): void {
  const pendingRenderer = new Map<string, { sender: WebContents; finish(error: string | null): void }>()
  ipcMain.handle("workspace:projects:removalReply", (event, requestId: string, error: string | null) => {
    const pending = pendingRenderer.get(requestId)
    if (!pending || pending.sender !== event.sender || event.senderFrame !== event.sender.mainFrame || error !== null && typeof error !== "string") throw new Error("Invalid removal acknowledgment")
    pending.finish(error?.slice(0, 2000) ?? null)
  })
  const renderer = (sender: WebContents, request: Omit<ProjectRemovalRendererRequest, "requestId">) => new Promise<void>((resolve, reject) => {
    const requestId = randomUUID()
    const finish = (error: string | null) => {
      clearTimeout(timer); pendingRenderer.delete(requestId)
      if (error) reject(new Error(error)); else resolve()
    }
    const timer = setTimeout(() => finish("Device data cleanup has an unknown outcome. Retry its saved removal."), 30_000)
    pendingRenderer.set(requestId, { sender, finish })
    if (sender.isDestroyed()) { finish("The project window is unavailable for saved data cleanup."); return }
    sender.send("workspace:projects:removalRequest", { ...request, requestId })
  })
  const nativeHosts = () => {
    const pool = getDesktopBackendPool()
    const hosts = pool ? pool.listDescriptors().map((descriptor) => pool.getManager(descriptor.id)) : [getPrimaryShadowServerManager()]
    if (!hosts.length || hosts.some((host) => !host)) throw new Error("Reconnect the chat runtime before recovering removal.")
    return hosts.map((host) => host!)
  }
  const removalHooks = (sender: WebContents): LocalProjectRemovalHooks => {
    const daemon = (operationId: string, projectId: string, scope: Parameters<LocalProjectRemovalHooks["prepare"]>[2], phase: "prepare" | "finalize" | "cancel") => getSharedProjectdClient().removeProject({
      operationId, projectId, phase, workspaces: scope.map(({ workspace }) => ({ workspaceId: workspace.workspaceId, projectRootPath: workspace.projectRootPath, workspaceRevision: workspace.workspaceRevision })),
    })
    const presentation = async (operationId: string, projectId: string, scope: Parameters<LocalProjectRemovalHooks["prepare"]>[2], phase: "quiesce" | "erase") => {
      const project = await run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.get(projectId)))
      if (!project) throw new Error("The saved project's local data scope is unavailable.")
      await renderer(sender, { operationId, projectId: project.projectId, slug: project.slug, workspaceIds: scope.map(({ workspace }) => workspace.workspaceId), phase })
    }
    return {
      async prepare(operationId, projectId, scope) {
        notifyWorkspaceCatalogChanged()
        const client = getSharedProjectdClient()
        // Registration is allowed only before daemon exclusion; a replay reads its receipt instead.
        try { await daemon(operationId, projectId, scope, "prepare") }
        catch (firstError) {
          for (const { workspace } of scope) await client.registerWorkspace({ ...workspace })
          try { await daemon(operationId, projectId, scope, "prepare") } catch { throw firstError }
        }
        await deps.ensureChatRuntimeReady()
        const roots = [...new Set(scope.flatMap((entry) => entry.roots))].sort()
        if (roots.length) for (const host of nativeHosts()) await host.closeWorkspaceChats({ type: "cozea:workspace-close", requestId: randomUUID(), roots })
        await presentation(operationId, projectId, scope, "quiesce")
        for (const { workspace } of scope) {
          const stopped = await DevServerService.getInstance().stop(workspace.workspaceId)
          if (!stopped.success) throw new Error(stopped.error ?? "Dev Server shutdown was not confirmed.")
          await TerminalService.getInstance().closeAllForWorkspace(workspace.workspaceId)
          await WorkbenchSessionManager.getInstance().closeWorkspaceSessions(projectId, workspace.workspaceId)
        }
      },
      async removeData(operationId, projectId, scope) {
        const roots = [...new Set(scope.flatMap((entry) => entry.roots))].sort()
        for (const host of nativeHosts()) await host.removeWorkspaceChatData({ type: "cozea:workspace-remove-data", requestId: randomUUID(), operationId, roots })
        await presentation(operationId, projectId, scope, "erase")
      },
      async finalize(operationId, projectId, scope) {
        const saved = await daemon(operationId, projectId, scope, "finalize")
        if (saved.operationId !== operationId || saved.state !== "removed") throw new Error("The daemon removal outcome is not confirmed.")
      },
      async cancel(operationId, projectId) {
        const operation = await run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.getOperation(operationId)))
        if (!operation?.details.removalScopeJson) throw new Error("The saved removal scope is unavailable.")
        await daemon(operationId, projectId, JSON.parse(operation.details.removalScopeJson), "cancel")
      },
      trash: (folder) => shell.trashItem(folder),
    }
  }
  const runRemoval = async (effect: Effect.Effect<LocalProjectResult<LocalProjectRemovalOutcome>, unknown, WorkspaceCatalog>) => {
    const result = await run(effect)
    const snapshot = await flushCatalogSnapshotAfterMutation()
    if (result.success && (snapshot.projects?.[result.value.projectId] || snapshot.entries[result.value.projectId])) return { success: false as const, error: "Removal committed, but its discovery snapshot is not ready. Retry the saved request." }
    return result
  }
  ipcMain.handle("workspace:projects:remove", (event, request: RemoveLocalProjectRequest) => runRemoval(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.remove(request, removalHooks(event.sender)))))
  ipcMain.handle("workspace:projects:resumeRemove", (event, operationId: string) => runRemoval(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.resumeRemove(operationId, removalHooks(event.sender)))))
  ipcMain.handle("workspace:projects:cancelRemove", (event, operationId: string) => runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.cancelRemove(operationId, removalHooks(event.sender)))))
  ipcMain.handle("workspace:projects:confirmTrashOutcome", (_event, operationId: string, workspaceId: string) => runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.confirmTrashOutcome(operationId, workspaceId))))
  const closeHooks = makeCloseHooks(deps.ensureChatRuntimeReady)
  ipcMain.handle("workspace:projects:list", async () =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.list())),
  )
  ipcMain.handle("workspace:projects:get", async (_event, projectId: string) =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.get(projectId))),
  )
  ipcMain.handle("workspace:projects:createEntry", async (_event, req: CreateLocalProjectEntryRequest) =>
    runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.createEntry(req))),
  )
  ipcMain.handle("workspace:projects:updateMetadata", async (_event, req: UpdateLocalProjectMetadataRequest) =>
    runLocalPresentation(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.updateMetadata(req))),
  )
  ipcMain.handle("workspace:projects:observeShared", async (_event, req: ObserveSharedProjectRequest) =>
    runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.observeShared(req))),
  )
  ipcMain.handle("workspace:projects:beginOperation", async (_event, req: BeginProjectOperationRequest) => {
    if (["create", "attach", "repair", "remove"].includes(req?.kind)) return { success: false, error: "Local folder receipts are owned by the desktop lifecycle." }
    return run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.beginOperation(req)))
  })
  ipcMain.handle("workspace:projects:getOperation", async (_event, operationId: string) =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.getOperation(operationId))),
  )
  ipcMain.handle("workspace:projects:getCompletedRepair", async (_event, workspaceId: string, previousFolder: string | null, currentFolder: string, previousRevision?: number) =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.getCompletedRepair(workspaceId, previousFolder, currentFolder, previousRevision))),
  )
  ipcMain.handle("workspace:projects:advanceOperation", async (_event, req: AdvanceProjectOperationRequest) =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => Effect.gen(function* () {
      if (!req || typeof req.operationId !== "string") return { success: false as const, error: "Invalid project operation transition." }
      const operation = yield* c.projects.getOperation(req?.operationId)
      if (operation && ["create", "attach", "repair", "remove"].includes(operation.kind)) return { success: false as const, error: "Local folder receipts are owned by the desktop lifecycle." }
      return yield* c.projects.advanceOperation(req)
    }))),
  )
  ipcMain.handle("workspace:projects:listRecoverableOperations", async (_event, projectId?: string) =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projects.listRecoverableOperations(projectId))),
  )
  ipcMain.handle("workspace:projects:create", async (_event, req: CreateLocalProjectRequest) =>
    runLocalLifecycle(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.create(req))),
  )
  ipcMain.handle("workspace:projects:open", async (_event, req: OpenLocalProjectRequest) => {
    const result = await runLocalLifecycle(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.open(req)))
    if (result.success) {
      const update = forgetApprovedExternalReadRoot(deps.loadSettings(), result.value.workspace.rootPath)
      if (update) deps.saveSettings(update)
    }
    return result
  })
  ipcMain.handle("workspace:projects:resume", async (_event, operationId: string) =>
    runLocalLifecycle(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.resume(operationId))),
  )
  ipcMain.handle("workspace:projects:repair", async (_event, req: RepairLocalProjectRequest) =>
    runLocalLifecycle(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.repair(req, repairHooks))),
  )
  ipcMain.handle("workspace:projects:resumeRepair", async (_event, operationId: string) =>
    runLocalLifecycle(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.resumeRepair(operationId, repairHooks))),
  )
  ipcMain.handle("workspace:projects:close", async (_event, req: CloseLocalProjectWorkspaceRequest) =>
    runLocalLifecycle(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.close(req, closeHooks))),
  )
  ipcMain.handle("workspace:projects:resumeClose", async (_event, operationId: string) =>
    runLocalLifecycle(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.resumeClose(operationId, closeHooks))),
  )
  ipcMain.handle("workspace:projects:cancelClose", async (_event, operationId: string) =>
    runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.projectLifecycle.cancelClose(operationId))),
  )

  ipcMain.handle(
    "workspace:resolveProject",
    async (_event, req: ResolveProjectWorkspaceRequest) =>
      runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.resolveProject(req))),
  )

  ipcMain.handle("workspace:listForProject", async (_event, projectId: string) =>
    run(
      Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
        c.listForProject(projectId),
      ),
    ),
  )

  ipcMain.handle("workspace:getActiveForProject", async (_event, projectId: string) =>
    run(
      Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
        c.getActive(projectId),
      ),
    ),
  )

  ipcMain.handle(
    "workspace:setActiveForProject",
    async (_event, req: { workspaceId: string; projectId: string }) =>
      runMutating(
        Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
          c.setActive(req.workspaceId, req.projectId),
        ),
      ),
  )

  ipcMain.handle(
    "workspace:bindExistingFolder",
    async (_event, req: BindExistingFolderRequest) => {
      const { forceBind: _ignored, ...safeRequest } = req as BindExistingFolderRequest & {
        forceBind?: unknown
      }
      return runMutating(
        Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
          c.bindExistingFolder(safeRequest),
        ),
      )
    },
  )

  ipcMain.handle(
    "workspace:preflightExistingFolder",
    async (_event, req: PreflightExistingFolderRequest) =>
      run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.preflightExistingFolder(req))),
  )

  ipcMain.handle(
    "workspace:attachExistingFolder",
    async (_event, req: AttachExistingFolderRequest) => {
      const result = await runMutating(
        Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.attachExistingFolder(req)),
      )
      if (result.success) {
        const update = forgetApprovedExternalReadRoot(deps.loadSettings(), req.folderPath)
        if (update) deps.saveSettings(update)
      }
      return result
    },
  )

  ipcMain.handle(
    "workspace:importExistingFolder",
    async (_event, req: ImportExistingFolderRequest) =>
      runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.importExistingFolder(req))),
  )

  ipcMain.handle(
    "workspace:createForProject",
    async (_event, req: CreateWorkspaceForProjectRequest) =>
      runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.createForProject(req))),
  )

  ipcMain.handle(
    "workspace:cloneForProject",
    async (_event, req: CloneWorkspaceForProjectRequest) =>
      runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.cloneForProject(req))),
  )

  ipcMain.handle("workspace:verify", async (_event, workspaceId: string) =>
    runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.verify(workspaceId))),
  )

  ipcMain.handle("workspace:findByPath", async (_event, folderPath: string) =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.findByPath(folderPath))),
  )

  ipcMain.handle("workspace:trashManagedWorkspace", async (_event, workspaceId: string) => {
    const target = await run(
      Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
        c.getManagedDeletionTarget(workspaceId),
      ),
    )
    if (!target) {
      return {
        success: false,
        error: "This workspace is attached or its managed ownership could not be verified.",
      }
    }

    try {
      const [managedRootPath, projectRootPath] = await Promise.all([
        realpath(target.managedRootPath),
        realpath(target.projectRootPath),
      ])
      const relative = path.relative(managedRootPath, projectRootPath)
      if (!relative || relative.startsWith("..") || path.isAbsolute(relative)) {
        return {
          success: false,
          error: "The managed workspace path is outside its recorded managed root.",
        }
      }

      await shell.trashItem(projectRootPath)
      return { success: true, movedToTrash: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "Failed to move the workspace to Trash.",
      }
    }
  })

  ipcMain.handle("workspace:forget", async (_event, workspaceId: string) =>
    runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.forget(workspaceId))),
  )

  ipcMain.handle(
    "workspace:listCandidates",
    async (
      _event,
      req: {
        projectId: string
        slug: string
        roots: string[]
        expectedRepo?: unknown
      },
    ) =>
      run(
        Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
          c.listCandidates(req.projectId, req.slug, req.roots, req.expectedRepo as never),
        ),
      ),
  )

  ipcMain.handle("workspace:openInFinder", async (_event, folderPath: string) => {
    // Never hand a raw renderer-supplied path to the OS shell. Only reveal
    // folders the catalog actually tracks, comparing canonical (symlink- and
    // `..`-resolved) paths so a crafted path can't escape the allowlist.
    if (typeof folderPath !== "string" || !path.isAbsolute(folderPath)) {
      return { success: false, error: "A valid absolute folder path is required." }
    }

    let target: string
    try {
      target = await realpath(folderPath)
    } catch {
      return { success: false, error: "Folder is not accessible." }
    }

    const snapshot = await getCatalogSnapshot()
    const candidatePaths = new Set<string>()
    for (const entry of Object.values(snapshot.entries)) {
      const ws = entry.workspace
      for (const candidate of [ws.rootPath, ws.projectRootPath, ws.gitRootPath]) {
        if (candidate) candidatePaths.add(candidate)
      }
    }

    const knownReal = await Promise.all(
      [...candidatePaths].map((candidate) => realpath(candidate).catch(() => null)),
    )
    if (!knownReal.includes(target)) {
      return { success: false, error: "This folder is not a known workspace." }
    }

    const openError = await shell.openPath(target)
    return openError ? { success: false, error: openError } : { success: true }
  })

  ipcMain.handle("workspace:getCatalogSnapshot", async () => getCatalogSnapshot())
}
