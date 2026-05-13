import type { IpcMain } from "electron"
import { shell } from "electron"
import * as Effect from "effect/Effect"

import type {
  BindExistingFolderRequest,
  CloneWorkspaceForProjectRequest,
  CreateWorkspaceForProjectRequest,
  ImportExistingFolderRequest,
  ResolveProjectWorkspaceRequest,
} from "../../shared/workspaceTypes.ts"
import { WorkspaceCatalog } from "../workspaces/WorkspaceCatalog.ts"
import { waitForWorkspaceCatalogRuntime } from "../workspaces/WorkspaceCatalogRuntime.ts"

async function run<A>(eff: Effect.Effect<A, unknown, WorkspaceCatalog>): Promise<A> {
  const rt = await waitForWorkspaceCatalogRuntime()
  return rt.runPromise(eff as Effect.Effect<A, never, WorkspaceCatalog>)
}

export function registerWorkspaceHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    "workspace:resolveProject",
    async (_event, req: ResolveProjectWorkspaceRequest) =>
      run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.resolveProject(req))),
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
      run(
        Effect.flatMap(Effect.service(WorkspaceCatalog), (c) =>
          c.setActive(req.workspaceId, req.projectId),
        ),
      ),
  )

  ipcMain.handle(
    "workspace:bindExistingFolder",
    async (_event, req: BindExistingFolderRequest) =>
      run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.bindExistingFolder(req))),
  )

  ipcMain.handle(
    "workspace:importExistingFolder",
    async (_event, req: ImportExistingFolderRequest) =>
      run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.importExistingFolder(req))),
  )

  ipcMain.handle(
    "workspace:createForProject",
    async (_event, req: CreateWorkspaceForProjectRequest) => {
      console.log("[IPC] workspace:createForProject called with:", req)
      return run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.createForProject(req)))
    }
  )

  ipcMain.handle(
    "workspace:cloneForProject",
    async (_event, req: CloneWorkspaceForProjectRequest) =>
      run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.cloneForProject(req))),
  )

  ipcMain.handle("workspace:verify", async (_event, workspaceId: string) =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.verify(workspaceId))),
  )

  ipcMain.handle("workspace:forget", async (_event, workspaceId: string) =>
    run(Effect.flatMap(Effect.service(WorkspaceCatalog), (c) => c.forget(workspaceId))),
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
    await shell.openPath(folderPath)
  })
}
