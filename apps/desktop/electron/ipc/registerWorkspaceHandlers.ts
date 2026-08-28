import type { IpcMain } from "electron"
import { shell } from "electron"
import * as Effect from "effect/Effect"
import path from "node:path"
import { realpath } from "node:fs/promises"

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
} from "../workspaces/CatalogSnapshot.ts"
import type { AppSettings } from "../../../../shared/electronApiTypes.ts"
import { forgetApprovedExternalReadRoot } from "../fsAccess.ts"

interface RegisterWorkspaceHandlersDeps {
  loadSettings: () => AppSettings
  saveSettings: (settings: Partial<AppSettings>) => void
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

export function registerWorkspaceHandlers(
  ipcMain: IpcMain,
  deps: RegisterWorkspaceHandlersDeps,
): void {
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
