import type { IpcMain } from "electron"

import { resolveAuthorizedWorkspaceAccess } from "../workspaces/authorization"
import type { OrgDevAppArtifactService } from "../services/OrgDevAppArtifactService"

interface RegisterOrgDevAppHandlersDeps {
  service: OrgDevAppArtifactService
}

export function registerOrgDevAppHandlers(
  ipcMain: IpcMain,
  deps: RegisterOrgDevAppHandlersDeps,
): void {
  const { service } = deps

  ipcMain.handle(
    "orgDevApp:buildAndUpload",
    async (
      _event,
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
}
