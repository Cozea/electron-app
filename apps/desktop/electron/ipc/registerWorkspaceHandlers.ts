import type { IpcMain } from "electron"
import { shell } from "electron"
import * as Effect from "effect/Effect"
import path from "node:path"
import { realpath } from "node:fs/promises"

import type {
  BindExistingFolderRequest,
  CloneWorkspaceForProjectRequest,
  CreateWorkspaceForProjectRequest,
  ImportExistingFolderRequest,
  ResolveProjectWorkspaceRequest,
} from "../../../../shared/workspaceTypes.ts"
import { WorkspaceCatalog } from "../workspaces/WorkspaceCatalog.ts"
import { waitForWorkspaceCatalogRuntime } from "../workspaces/WorkspaceCatalogRuntime.ts"
import {
  getCatalogSnapshot,
  notifyWorkspaceCatalogChanged,
} from "../workspaces/CatalogSnapshot.ts"

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

export function registerWorkspaceHandlers(ipcMain: IpcMain): void {
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
    async (_event, req: BindExistingFolderRequest) =>
      runMutating(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.bindExistingFolder(req))),
  )

  ipcMain.handle(
    "workspace:importExistingFolder",
    async (_event, req: ImportExistingFolderRequest) =>
      run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.importExistingFolder(req))),
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
