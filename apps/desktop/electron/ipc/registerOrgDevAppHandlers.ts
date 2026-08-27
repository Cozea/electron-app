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
    "orgDevApp:buildAndPack",
    async (
      _event,
      options: { workspaceId: string; laneId?: string | null },
    ): Promise<
      | {
          success: true
          zip: Uint8Array
          contentHash: string
          entryPath: string
          framework: string
        }
      | { success: false; error: string }
    > => {
      try {
        const access = await resolveAuthorizedWorkspaceAccess({
          workspaceId: options.workspaceId,
          laneId: options.laneId,
          operation: "runtime-detect",
        })
        const result = await service.buildAndPack(access.projectRootPath)
        return {
          success: true,
          zip: result.zip,
          contentHash: result.contentHash,
          entryPath: result.entryPath,
          framework: result.framework,
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
    "orgDevApp:prepareArtifact",
    async (
      _event,
      options: { downloadUrl: string; contentHash: string; entryPath?: string },
    ): Promise<
      | { success: true; originUrl: string; contentHash: string; entryPath: string }
      | { success: false; error: string }
    > => {
      try {
        const result = await service.prepareArtifact(options)
        return {
          success: true,
          originUrl: result.originUrl,
          contentHash: result.contentHash,
          entryPath: result.entryPath,
        }
      } catch (error) {
        return {
          success: false,
          error: error instanceof Error ? error.message : "Failed to cache the DevApp artifact.",
        }
      }
    },
  )
}
