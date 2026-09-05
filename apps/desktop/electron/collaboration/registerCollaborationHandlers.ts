import { app, BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from "electron"
import * as Effect from "effect/Effect"
import path from "node:path"
import type { CollaborationDesktopAPI, CollaborationWorkspaceAuthority } from "../../../../shared/collaborationDesktop"
import type { CollaborationRepositoryCredentialResponse } from "../../../../shared/collaborationRepository"
import { WorkspaceCatalog, type WorkspaceCatalogInterface } from "../workspaces/WorkspaceCatalog"
import { waitForWorkspaceCatalogRuntime } from "../workspaces/WorkspaceCatalogRuntime"
import { notifyWorkspaceCatalogChanged } from "../workspaces/CatalogSnapshot"
import { getTrustedDeviceGatewayBaseUrl } from "../services/DeviceGatewayPolicy"
import { runGitCommand } from "../gitRuntime"
import { SessionWorkspaceCoordinator } from "./SessionWorkspaceCoordinator"
import { SessionRuntimeHost } from "./SessionRuntimeHost"
import { AuthorizedRepositoryDownloader } from "./AuthorizedRepositoryDownloader"
import { DeviceCollaborationGateway } from "./DeviceCollaborationGateway"
import { WorkbenchSessionManager } from "../services/WorkbenchSessionManager"

async function catalog<A>(operation: (catalog: WorkspaceCatalogInterface) => Effect.Effect<A>): Promise<A> {
  const runtime = await waitForWorkspaceCatalogRuntime()
  return runtime.runPromise(Effect.flatMap(Effect.service(WorkspaceCatalog), operation))
}

async function post<T>(route: string, body: unknown, token: string): Promise<T> {
  if (typeof token !== "string" || !token || token.length > 16_384) throw new Error("Device authentication is required")
  const response = await fetch(`${getTrustedDeviceGatewayBaseUrl()}${route}`, {
    method: "POST", redirect: "error", cache: "no-store", signal: AbortSignal.timeout(30_000),
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  })
  if (!response.ok) throw new Error(`Collaboration request failed (${response.status}); reconnect or check repository access`)
  return await response.json() as T
}

/** The trusted gateway and Git installation credentials never cross into the renderer. */
export function registerCollaborationHandlers(ipcMain: IpcMain, userData: string): void {
  const gateway = new DeviceCollaborationGateway()
  const downloader = new AuthorizedRepositoryDownloader({
    binding: projectId => gateway.post("/collab/v2/control", { operation: "repository.getBinding", args: { projectId } }),
    credential: projectId => gateway.post("/collab/repository/credential", { projectId, operation: "read" }),
    async allocate(projectId, slug, prepare) {
      const result = await catalog(service => service.createPreparedWorkspace({ projectId, slug, setActive: false }, prepare, `github-download:g3:${projectId}`))
      if (!result.success || !result.workspace) throw new Error(result.error ?? "Repository workspace preparation failed")
      return result.workspace
    },
    git: (args, options) => runGitCommand(args, { ...options, timeoutMs: 300_000, maxOutputBytes: 4 * 1024 * 1024 }),
    async activate(workspace) { await catalog(service => service.setActive(workspace.workspaceId, workspace.projectId)); notifyWorkspaceCatalogChanged() },
    progress(progress) { for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("collaboration:downloadProgress", progress) },
  })
  const coordinator = new SessionWorkspaceCoordinator({
    git: (args, options) => runGitCommand(args, { ...options, timeoutMs: 120_000 }),
    getWorkspace: id => catalog(asyncEffectCatalog => asyncEffectCatalog.verify(id).pipe(Effect.map(result => result.workspace))),
    async allocate(projectId, sessionId, prepare) {
      const result = await catalog(service => service.createPreparedWorkspace(
        { projectId, slug: `collab-${sessionId}`, setActive: false }, prepare, `collaboration:g3:${sessionId}`,
      ))
      if (!result.success || !result.workspace) throw new Error(result.error ?? "Session workspace creation failed")
      return result.workspace
    },
    async setActive(workspaceId, projectId) {
      await catalog(service => service.setActive(workspaceId, projectId))
      notifyWorkspaceCatalogChanged()
    },
    read: key => catalog(service => service.getSetting(key)),
    write: (key, value) => catalog(service => service.setSetting(key, value)),
    authorize: (sessionId, token) => post<CollaborationWorkspaceAuthority>("/collab/v2/workspace-context", { sessionId }, token),
    credential: (projectId, sessionId, operation, token) => post<CollaborationRepositoryCredentialResponse>("/collab/repository/credential", { projectId, sessionId, operation }, token),
    async verifyPush(sessionId, commitSha, token) { await post("/collab/repository/verify-push", { sessionId, commitSha }, token) },
    scratchRoot: path.join(userData, "collaboration", "g3", "scratch"),
  })
  const host = new SessionRuntimeHost(coordinator, path.join(userData, "collaboration"), sessionId => {
    for (const window of BrowserWindow.getAllWindows()) if (!window.isDestroyed()) window.webContents.send("collaboration:runtimeChanged", sessionId)
  }, workspaceId => WorkbenchSessionManager.getInstance().closeWorkspace(workspaceId))
  let shutdownComplete = false
  let shuttingDown = false
  app.on("before-quit", event => {
    if (shutdownComplete) return
    event.preventDefault()
    if (shuttingDown) return
    shuttingDown = true
    void host.shutdown().then(() => { shutdownComplete = true; app.quit() }).catch(() => {
      shuttingDown = false
      dialog.showErrorBox("Collaboration recovery needs attention", "Pending edits could not be saved. Free local storage and retry synchronization before quitting.")
    })
  })
  const api: CollaborationDesktopAPI = {
    downloadRepository: input => downloader.download(input.projectId, input.slug),
    cancelDownload: async projectId => downloader.cancel(projectId),
    onDownloadProgress: () => { throw new Error("Subscriptions are provided by preload") },
    runtime: {
      setup: id => host.setup(id),
      resolve: input => host.resolve(input),
      control: input => host.control(input.operation, input.args),
      open: input => host.open(input.sessionId, input.sourceWorkspaceId),
      active: async projectId => host.active(projectId),
      snapshot: async id => host.runtime(id).snapshot(),
      openFile: input => host.runtime(input.sessionId).openFile(input.path),
      editorState: async id => host.runtime(id).editorState(),
      edit: input => host.runtime(input.sessionId).applyEditorUpdate(input.update),
      createFile: input => host.runtime(input.sessionId).createFile(input.path, input.content),
      renameFile: input => host.runtime(input.sessionId).renameFile(input.fileId, input.path),
      deleteFile: input => host.runtime(input.sessionId).deleteFile(input.fileId),
      restoreFile: input => host.runtime(input.sessionId).restoreFile(input.fileId, input.path),
      commit: input => host.prepareCommit(input),
      push: id => host.push(id),
      prepared: id => coordinator.getPrepared(id),
      discard: id => host.discard(id),
      importChanges: input => host.importChanges(input.sessionId, input.selected),
      leave: input => host.leave(input.sessionId, input.end ?? false),
      retry: id => host.runtime(id).retry(),
      onChanged: () => { throw new Error("Subscriptions are provided by preload") },
    },
    prepare: input => coordinator.prepare(input.sessionId, input.sourceWorkspaceId, input.accessToken),
    leave: input => coordinator.leave(input.sessionId, input.ended),
    getBinding: id => coordinator.getBinding(id),
    bindingForWorkspace: id => coordinator.bindingForWorkspace(id),
    inspectImportableChanges: id => coordinator.inspectImportableChanges(id),
    readReviewedImport: input => coordinator.readReviewedImport(input.sessionId, input.selected, input.accessToken),
    prepareCommit: input => coordinator.prepareCommit(input),
    pushPrepared: input => coordinator.pushPrepared(input.sessionId, input.accessToken),
    adoptPublished: input => coordinator.adoptPublished(input.sessionId, input.accessToken, input.sharedPaths),
  }
  // Electron's normal preload is not installed in browser/DevApp guests.
  // Recheck the sender frame as defense in depth before local filesystem work.
  const authorized = <Input, Output>(method: (input: Input) => Promise<Output>) => async (event: IpcMainInvokeEvent, input: Input): Promise<Output> => {
    if (event.sender.getType() !== "window" || event.senderFrame !== event.sender.mainFrame) throw new Error("Collaboration requires the application window")
    return method(input)
  }
  ipcMain.handle("collaboration:prepare", authorized(api.prepare))
  ipcMain.handle("collaboration:downloadRepository", authorized(api.downloadRepository))
  ipcMain.handle("collaboration:cancelDownload", authorized(api.cancelDownload))
  ipcMain.handle("collaboration:leave", authorized(api.leave))
  ipcMain.handle("collaboration:getBinding", authorized(api.getBinding))
  ipcMain.handle("collaboration:bindingForWorkspace", authorized(api.bindingForWorkspace))
  ipcMain.handle("collaboration:inspectImport", authorized(api.inspectImportableChanges))
  ipcMain.handle("collaboration:readImport", authorized(api.readReviewedImport))
  ipcMain.handle("collaboration:prepareCommit", authorized(api.prepareCommit))
  ipcMain.handle("collaboration:pushPrepared", authorized(api.pushPrepared))
  ipcMain.handle("collaboration:adoptPublished", authorized(api.adoptPublished))
  ipcMain.handle("collaboration:control", authorized(api.runtime.control))
  ipcMain.handle("collaboration:runtimeSetup", authorized(api.runtime.setup))
  ipcMain.handle("collaboration:runtimeResolve", authorized(api.runtime.resolve))
  ipcMain.handle("collaboration:runtimeImport", authorized(api.runtime.importChanges))
  ipcMain.handle("collaboration:runtimeDiscard", authorized(api.runtime.discard))
  ipcMain.handle("collaboration:runtimeOpen", authorized(api.runtime.open))
  ipcMain.handle("collaboration:runtimeActive", authorized(api.runtime.active))
  ipcMain.handle("collaboration:runtimeSnapshot", authorized(api.runtime.snapshot))
  ipcMain.handle("collaboration:runtimeOpenFile", authorized(api.runtime.openFile))
  ipcMain.handle("collaboration:runtimeEditorState", authorized(api.runtime.editorState))
  ipcMain.handle("collaboration:runtimeEdit", authorized(api.runtime.edit))
  ipcMain.handle("collaboration:runtimeCreateFile", authorized(api.runtime.createFile))
  ipcMain.handle("collaboration:runtimeRenameFile", authorized(api.runtime.renameFile))
  ipcMain.handle("collaboration:runtimeDeleteFile", authorized(api.runtime.deleteFile))
  ipcMain.handle("collaboration:runtimeRestoreFile", authorized(api.runtime.restoreFile))
  ipcMain.handle("collaboration:runtimeCommit", authorized(api.runtime.commit))
  ipcMain.handle("collaboration:runtimePush", authorized(api.runtime.push))
  ipcMain.handle("collaboration:runtimePrepared", authorized(api.runtime.prepared))
  ipcMain.handle("collaboration:runtimeLeave", authorized(api.runtime.leave))
  ipcMain.handle("collaboration:runtimeRetry", authorized(api.runtime.retry))
}
