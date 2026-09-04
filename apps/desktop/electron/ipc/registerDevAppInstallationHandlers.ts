import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron"

import type { DevAppInstallationService } from "../services/DevAppInstallationService"
import { resolveAuthorizedWorkspaceAccess } from "../workspaces/authorization"

interface RegisterDevAppInstallationHandlersDeps {
  service: DevAppInstallationService
  getMainWindow: () => BrowserWindow | null
}

export function registerDevAppInstallationHandlers(
  ipcMain: IpcMain,
  deps: RegisterDevAppInstallationHandlersDeps,
): () => void {
  const assertMainRenderer = (event: IpcMainInvokeEvent): void => {
    const window = deps.getMainWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents) {
      throw new Error("DevApp installation IPC is restricted to the main Cozea renderer.")
    }
  }
  const respond = <Value>(operation: () => Value): { success: true; value: Value } | { success: false; error: string } => {
    try {
      return { success: true, value: operation() }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : "The DevApp operation failed.",
      }
    }
  }
  const broadcast = deps.service.onChange((installations) => {
    const window = deps.getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send("devApp:installationsChanged", installations)
    }
  })

  ipcMain.handle("devApp:listInstallations", (event) => {
    assertMainRenderer(event)
    const result = respond(() => deps.service.list())
    return result.success
      ? { success: true as const, installations: result.value }
      : result
  })

  ipcMain.handle("devApp:getInstallation", (event, options: { installationId: string }) => {
    assertMainRenderer(event)
    const result = respond(() => deps.service.get(options?.installationId))
    return result.success
      ? { success: true as const, installation: result.value }
      : result
  })

  ipcMain.handle(
    "devApp:installDevelopment",
    async (
      event,
      options: {
        workspaceId: string
        laneId?: string | null
        relativePath: string
      },
    ) => {
      assertMainRenderer(event)
      try {
        if (
          typeof options?.workspaceId !== "string" ||
          typeof options?.relativePath !== "string" ||
          options.relativePath.length > 512
        ) {
          throw new Error("Choose a DevApp package inside an authorized workspace.")
        }
        const access = await resolveAuthorizedWorkspaceAccess({
          workspaceId: options.workspaceId,
          laneId: options.laneId,
          operation: "read-file",
          relativePath: options.relativePath || ".",
        })
        if (!access.fullPath) throw new Error("The DevApp package path could not be resolved.")
        return {
          success: true as const,
          installation: await deps.service.installDevelopment({
            workspaceId: options.workspaceId,
            relativePath: options.relativePath || ".",
            packageRoot: access.fullPath,
          }),
        }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "The DevApp could not be installed.",
        }
      }
    },
  )

  ipcMain.handle(
    "devApp:prepareSurface",
    (event, options: { installationId: string; surfaceId?: string | null }) => {
      assertMainRenderer(event)
      const result = respond(() =>
        deps.service.prepareSurface(options?.installationId, options?.surfaceId),
      )
      return result.success ? { success: true as const, surface: result.value } : result
    },
  )

  ipcMain.handle(
    "devApp:activateRelease",
    (event, options: { installationId: string; releaseId: string }) => {
      assertMainRenderer(event)
      const result = respond(() =>
        deps.service.activateRelease(options?.installationId, options?.releaseId),
      )
      return result.success
        ? { success: true as const, installation: result.value }
        : result
    },
  )

  ipcMain.handle(
    "devApp:uninstall",
    (event, options: { installationId: string; removeData?: boolean }) => {
      assertMainRenderer(event)
      const result = respond(() =>
        deps.service.uninstall(options?.installationId, Boolean(options?.removeData)),
      )
      return result.success ? { success: true as const, removed: result.value } : result
    },
  )

  return () => {
    broadcast()
    for (const channel of [
      "devApp:listInstallations",
      "devApp:getInstallation",
      "devApp:installDevelopment",
      "devApp:prepareSurface",
      "devApp:activateRelease",
      "devApp:uninstall",
    ]) {
      ipcMain.removeHandler(channel)
    }
  }
}
