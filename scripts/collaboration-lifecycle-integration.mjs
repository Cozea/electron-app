#!/usr/bin/env node
// Temporary isolated-checkout integration driver; remove after verified source is committed.
import fs from "node:fs";
const edits = new Map();
function replace(file, before, after) {
  const source = edits.get(file) ?? fs.readFileSync(file, "utf8");
  if (source.includes(after)) return;
  if (source.split(before).length !== 2) throw new Error(`Expected one lifecycle integration anchor in ${file}`);
  edits.set(file, source.replace(before, after));
}
const handlers = "apps/desktop/electron/collaboration/registerCollaborationHandlers.ts";
replace(handlers, 'import { app, BrowserWindow, dialog, type IpcMain, type IpcMainInvokeEvent } from "electron"', 'import { BrowserWindow, type IpcMain, type IpcMainInvokeEvent } from "electron"\nimport { registerCollaborationShutdown } from "./CollaborationShutdown"');
replace(handlers, `  let shutdownComplete = false
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
  })`, '  registerCollaborationShutdown(() => host.shutdown())');
const main = "apps/desktop/electron/main.ts";
replace(main, 'import { registerCollaborationHandlers } from "./collaboration/registerCollaborationHandlers"', 'import { registerCollaborationHandlers } from "./collaboration/registerCollaborationHandlers"\nimport { shutdownCollaboration } from "./collaboration/CollaborationShutdown"\nimport { createDurableQuitHandler } from "../../../shared/durableQuit"');
replace(main, "BrowserWindow, protocol, shell, ipcMain, nativeTheme, session } from 'electron'", "BrowserWindow, protocol, shell, ipcMain, nativeTheme, session, dialog } from 'electron'");
replace(main, `  setBroadcastMainWindow(win)
}`, `  // Do not prevent this event: that would override the renderer's unload
  // protection and discard updates which main has not durably accepted yet.
  win.webContents.on('will-prevent-unload', () => {
    dialog.showErrorBox('Collaboration edits are still being saved', 'This window was kept open because some edits have not been durably accepted. Retry synchronization, then close the window again.')
  })
  setBroadcastMainWindow(win)
}`);
replace(main, `app.on('before-quit', () => {
  appIsQuitting = true
  logAssistantBridge('app-before-quit')
  orgDevAppArtifactService.dispose()
  devAppPreviewService.dispose()
  devAppWorkerHost.dispose()
  publishedDevAppWorkerHost.dispose()
  void disposeContainedDevAppRuntime()
  PreviewSnapshotService.getInstance().dispose()
  LocalAutomationResolverService.getInstance().dispose()
  void disposeWorkspaceCatalogRuntime()
  stopUpdateChecks()
  void stopSubstrateShadowServer()
  unregisterBrowserSurfaceHandlers?.()
  unregisterBrowserSurfaceHandlers = null
  if (t3BrowserSurfaceService) {
    void t3BrowserSurfaceService.dispose()
    t3BrowserSurfaceService = null
  }
})`, `app.on('will-quit', createDurableQuitHandler({
  prepare: async () => {
    // Electron reaches will-quit only after every window accepted unload.
    // Pending renderer IPC therefore cannot lose its persistence owner here.
    appIsQuitting = true
    await shutdownCollaboration()
  },
  dispose: async () => {
    logAssistantBridge('app-will-quit')
    orgDevAppArtifactService.dispose()
    devAppPreviewService.dispose()
    devAppWorkerHost.dispose()
    publishedDevAppWorkerHost.dispose()
    PreviewSnapshotService.getInstance().dispose()
    LocalAutomationResolverService.getInstance().dispose()
    stopUpdateChecks()
    await disposeContainedDevAppRuntime()
    await stopSubstrateShadowServer()
    unregisterBrowserSurfaceHandlers?.()
    unregisterBrowserSurfaceHandlers = null
    if (t3BrowserSurfaceService) {
      await t3BrowserSurfaceService.dispose()
      t3BrowserSurfaceService = null
    }
    await disposeWorkspaceCatalogRuntime()
  },
  quit: () => app.quit(),
  failed: stage => {
    if (stage === 'prepare') {
      appIsQuitting = false
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    }
    dialog.showErrorBox('Cozea could not safely quit', stage === 'prepare'
      ? 'Collaboration recovery could not be saved or workspace shutdown was not acknowledged. Local recovery has been retained. Retry synchronization or Leave, then quit again.'
      : 'A native service did not acknowledge shutdown. Quit again to retry; recovery preparation will not be repeated against disposed services.')
  },
}))`);
replace("apps/desktop/electron/services/WorkbenchSessionManager.ts", "    app.once('before-quit', () => {", "    app.once('quit', () => {");
replace(main, `      logSubstrateShadow('stop-failed', {
        error: error instanceof Error ? error.message : String(error),
      })
    }
    return
  }`, `      logSubstrateShadow('stop-failed', { error: 'Native backend shutdown was not acknowledged' })
      throw new Error('Native backend shutdown was not acknowledged')
    }
    return
  }`);
replace(main, `    logSubstrateShadow('stop-failed', {
      error: error instanceof Error ? error.message : String(error),
    })
  }
}`, `    logSubstrateShadow('stop-failed', { error: 'Native backend shutdown was not acknowledged' })
    throw new Error('Native backend shutdown was not acknowledged')
  }
}`);
const host = "apps/desktop/electron/collaboration/SessionRuntimeHost.ts";
replace(host, "  private openTail: Promise<unknown> = Promise.resolve()", "  private openTail: Promise<unknown> = Promise.resolve()\n  private shuttingDown = false\n  private shutdownInFlight: Promise<void> | null = null");
replace(host, "    if (this.sessions.has(sessionId)) return true\n    const pending = this.opening.get(sessionId)\n    if (pending) return pending", "    if (this.shuttingDown) throw new Error(\"Session recovery is being saved before quit\")\n    const pending = this.opening.get(sessionId)\n    if (pending) return pending\n    const hosted = this.sessions.get(sessionId)\n    if (hosted?.ready) return true\n    if (hosted) { await this.retry(sessionId); return this.sessions.get(sessionId)?.ready ?? false }");
replace(host, "        if (hosted.maintenance || !hosted.ready) return", "        if (this.shuttingDown || hosted.maintenance || !hosted.ready) return");
replace(host, "          if (restart) void this.restartSession(sessionId, sourceWorkspaceId).catch(error => runtime.reportRecoveryError(error))", "          if (restart && !this.shuttingDown && hosted.ready) void this.restartSession(sessionId, sourceWorkspaceId).catch(error => runtime.reportRecoveryError(error))");
replace(host, "    if (!hosted) return\n    clearInterval(hosted.timer)", "    if (!hosted) return\n    hosted.ready = false\n    clearInterval(hosted.timer)");
replace(host, "  async shutdown(): Promise<void> {\n    for (const [sessionId, hosted] of this.sessions) {\n      clearInterval(hosted.timer)\n      await this.stopWorkspaceActions(await this.coordinator.suspendActions(sessionId))\n      await hosted.runtime.stop()\n      hosted.unsubscribe()\n    }\n    this.sessions.clear()\n  }", `  async retry(sessionId: string): Promise<void> {
    const hosted = this.sessions.get(sessionId)
    if (hosted?.ready) { await hosted.runtime.retry(); return }
    const binding = await this.coordinator.getBinding(sessionId)
    if (!binding) throw new Error("Session recovery is unavailable")
    if (hosted) await this.restartSession(sessionId, binding.sourceWorkspaceId)
    else await this.open(sessionId, binding.sourceWorkspaceId)
  }

  shutdown(): Promise<void> {
    if (this.shutdownInFlight) return this.shutdownInFlight
    this.shuttingDown = true
    const operation = (async () => {
      // A join already in flight must finish before taking the shutdown census.
      // No new open or maintenance-triggered restart may enter after this fence.
      await Promise.allSettled([...this.opening.values()])
      for (const hosted of this.sessions.values()) { hosted.ready = false; clearInterval(hosted.timer) }
      await Promise.allSettled([...this.sessions.values()].flatMap(hosted => hosted.maintenance ? [hosted.maintenance] : []))
      for (const [sessionId, hosted] of this.sessions) {
        await this.stopWorkspaceActions(await this.coordinator.suspendActions(sessionId))
        await hosted.publication.catch(() => {})
        await hosted.runtime.stop()
        hosted.unsubscribe()
        // Successful hosts are removed individually. A later failure must not
        // cause the next quit attempt to stop a destroyed CRDT owner twice.
        if (this.sessions.get(sessionId) === hosted) this.sessions.delete(sessionId)
      }
    })()
    this.shutdownInFlight = operation
    void operation.then(() => { this.shutdownInFlight = null }, () => { this.shutdownInFlight = null; this.shuttingDown = false })
    return operation
  }`);
replace(handlers, "      retry: id => host.runtime(id).retry(),", "      retry: id => host.retry(id),");
for (const [file, content] of edits) {
  console.log(file);
  if (!process.argv.includes("--check")) fs.writeFileSync(file, content);
}
