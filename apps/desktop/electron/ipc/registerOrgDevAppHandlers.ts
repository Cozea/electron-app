import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from "electron"

import { resolveAuthorizedWorkspaceAccess } from "../workspaces/authorization"
import type { OrgDevAppArtifactService } from "../services/OrgDevAppArtifactService"
import type { OrgDevAppInstallationService } from "../services/OrgDevAppInstallationService"
import type { OrgDevAppInstallRequest } from "../../../../shared/orgDevAppInstallation"
import {
  getDevAppRuntimeBuild,
  startDevAppRuntimeBuild,
} from "../services/DevAppRuntimeBuildClient"

interface RegisterOrgDevAppHandlersDeps {
  service: OrgDevAppArtifactService
  installations: OrgDevAppInstallationService
  getMainWindow: () => BrowserWindow | null
}

export function registerOrgDevAppHandlers(
  ipcMain: IpcMain,
  deps: RegisterOrgDevAppHandlersDeps,
): void {
  const { service, installations } = deps

  const assertMainRenderer = (event: IpcMainInvokeEvent): void => {
    const window = deps.getMainWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents) {
      throw new Error("DevApp installation IPC is restricted to the main Cozea renderer.")
    }
  }

  const sendInstallations = installations.onChange((next) => {
    const window = deps.getMainWindow()
    if (window && !window.isDestroyed()) {
      window.webContents.send("orgDevApp:installationsChanged", next)
    }
  })

  ipcMain.handle("orgDevApp:listInstallations", (event) => {
    assertMainRenderer(event)
    return { success: true as const, installations: installations.list() }
  })

  ipcMain.handle("orgDevApp:getInstallation", (event, options: { ref: string }) => {
    assertMainRenderer(event)
    return { success: true as const, installation: installations.resolve(options.ref) }
  })

  ipcMain.handle("orgDevApp:install", async (event, request: OrgDevAppInstallRequest) => {
    assertMainRenderer(event)
    try {
      return { success: true as const, installation: await installations.install(request) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to install the DevApp." }
    }
  })

  ipcMain.handle("orgDevApp:prepareInstalled", async (event, options: { ref: string }) => {
    assertMainRenderer(event)
    try {
      return { success: true as const, artifact: await installations.prepare(options.ref) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to open the installed DevApp." }
    }
  })

  ipcMain.handle("orgDevApp:uninstallPublication", (event, options: { publicationId: string }) => {
    assertMainRenderer(event)
    try {
      return { success: true as const, removed: installations.uninstallPublication(options.publicationId) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to uninstall the DevApp." }
    }
  })

  ipcMain.handle("orgDevApp:removeInstalledVersion", (event, options: { ref: string }) => {
    assertMainRenderer(event)
    try {
      return { success: true as const, removed: installations.removeVersion(options.ref) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to remove the DevApp release." }
    }
  })

  ipcMain.handle(
    "orgDevApp:buildAndUpload",
    async (
      event,
      options: {
        workspaceId: string
        laneId?: string | null
        operationId?: string
        uploadUrl: string
      },
    ): Promise<
      | {
          success: true
          storageId: string
          contentHash: string
          entryPath: string
          framework: string
          runtimeKind: "static" | "service"
          manifestVersion?: number
          platform?: string
          arch?: string
          permissionSetHash?: string
        }
      | { success: false; error: string }
    > => {
      try {
        assertMainRenderer(event)
        const access = await resolveAuthorizedWorkspaceAccess({
          workspaceId: options.workspaceId,
          laneId: options.laneId,
          operation: "runtime-detect",
        })
        const result = await service.buildAndUpload(access.projectRootPath, options.uploadUrl, {
          operationId: options.operationId,
        })
        return {
          success: true,
          storageId: result.storageId,
          contentHash: result.contentHash,
          entryPath: result.entryPath,
          framework: result.framework,
          runtimeKind: result.runtimeKind,
          ...(result.manifestVersion ? { manifestVersion: result.manifestVersion } : {}),
          ...(result.platform ? { platform: result.platform } : {}),
          ...(result.arch ? { arch: result.arch } : {}),
          ...(result.permissionSetHash ? { permissionSetHash: result.permissionSetHash } : {}),
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to build the DevApp.",
        }
      }
    },
  )

  ipcMain.handle("orgDevApp:startRuntimeBuild", async (event, options: {
    workspaceId: string
    laneId?: string | null
    projectId: string
    uploadReservationId: string
    gatewayBaseUrl: string
    accessToken: string
  }) => {
    assertMainRenderer(event)
    try {
      const access = await resolveAuthorizedWorkspaceAccess({
        workspaceId: options.workspaceId,
        laneId: options.laneId,
        operation: "runtime-detect",
      })
      const build = await startDevAppRuntimeBuild({
        projectRoot: access.projectRootPath,
        projectId: options.projectId,
        uploadReservationId: options.uploadReservationId,
        gatewayBaseUrl: options.gatewayBaseUrl,
        accessToken: options.accessToken,
      })
      return { success: true as const, build }
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to start the contained DevApp build.",
      }
    }
  })

  ipcMain.handle("orgDevApp:getRuntimeBuild", async (event, options: {
    buildId: string
    gatewayBaseUrl: string
    accessToken: string
  }) => {
    assertMainRenderer(event)
    try {
      return { success: true as const, build: await getDevAppRuntimeBuild(options) }
    } catch (error) {
      return {
        success: false as const,
        error: error instanceof Error ? error.message : "Failed to read the contained DevApp build.",
      }
    }
  })

  ipcMain.handle(
    "orgDevApp:cancelBuild",
    (_event, options: { operationId: string }): { cancelled: boolean } => ({
      cancelled: service.cancelBuild(options.operationId),
    }),
  )

  ipcMain.handle(
    "orgDevApp:prepareArtifact",
    async (
      _event,
      options: { downloadUrl: string; contentHash: string; entryPath?: string; runtimeKind?: "static" | "service" },
    ): Promise<
      | { success: true; originUrl: string; contentHash: string; entryPath: string; runtimeKind: "static" | "service"; servicePermissions?: { network: boolean; persistentData: boolean } }
      | { success: false; error: string }
    > => {
      try {
        const result = await service.prepareArtifact(options)
        return {
          success: true,
          originUrl: result.originUrl,
          contentHash: result.contentHash,
          entryPath: result.entryPath,
          runtimeKind: result.runtimeKind,
          ...(result.manifest ? { servicePermissions: result.manifest.permissions } : {}),
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to cache the DevApp artifact.",
        }
      }
    },
  )

  ipcMain.handle("orgDevApp:getRuntimeTrust", (_event, options: { contentHash: string; publicationId: string; permissionSetHash: string }) => {
    try {
      return { success: true as const, trusted: service.isRuntimeTrusted(options.contentHash, options.publicationId, options.permissionSetHash) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to inspect Service DevApp trust." }
    }
  })

  ipcMain.handle("orgDevApp:approveRuntime", (_event, options: { contentHash: string; publicationId: string; permissionSetHash: string }) => {
    try {
      service.approveRuntime(options.contentHash, options.publicationId, options.permissionSetHash)
      return { success: true as const }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to approve Service DevApp." }
    }
  })

  ipcMain.handle("orgDevApp:getRuntimeEnvironment", (_event, options: { contentHash: string; publicationId: string }) => {
    try {
      return { success: true as const, status: service.getRuntimeEnvironmentStatus(options.contentHash, options.publicationId) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to inspect Service DevApp configuration." }
    }
  })

  ipcMain.handle("orgDevApp:setRuntimeEnvironment", (_event, options: { contentHash: string; publicationId: string; values: Record<string, string | null> }) => {
    try {
      return { success: true as const, status: service.setRuntimeEnvironment(options.contentHash, options.publicationId, options.values) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to save Service DevApp configuration." }
    }
  })

  ipcMain.handle("orgDevApp:startRuntime", async (_event, options: { contentHash: string; publicationId?: string; permissionSetHash?: string; leaseId?: string }) => {
    try {
      return { success: true as const, state: await service.startRuntime(options.contentHash, options.publicationId, options.permissionSetHash, options.leaseId) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to start Service DevApp." }
    }
  })

  ipcMain.handle("orgDevApp:releaseRuntime", (_event, options: { contentHash: string; publicationId: string; leaseId: string }) => ({
    released: service.releaseRuntime(options.contentHash, options.publicationId, options.leaseId),
  }))

  ipcMain.handle("orgDevApp:stopRuntime", (_event, options: { contentHash: string; publicationId: string }) => {
    try {
      return { success: true as const, state: service.stopRuntime(options.contentHash, options.publicationId) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to stop Service DevApp." }
    }
  })

  ipcMain.handle("orgDevApp:getRuntimeState", (_event, options: { contentHash: string; publicationId: string }) => {
    try {
      return { success: true as const, state: service.getRuntimeState(options.contentHash, options.publicationId) }
    } catch (error) {
      return { success: false as const, error: error instanceof Error ? error.message : "Failed to inspect Service DevApp." }
    }
  })

  void sendInstallations
}
