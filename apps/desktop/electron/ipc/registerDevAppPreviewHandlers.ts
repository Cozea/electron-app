import type { IpcMain, WebContents } from "electron"

import { resolveAuthorizedWorkspaceAccess } from "../workspaces/authorization"
import type { DevAppPreviewService } from "../services/DevAppPreviewService"

/**
 * IPC for the development preview.
 *
 * The renderer names a workspace and a path relative to it, never a directory. The
 * workspace is resolved through the same authorization every other project operation goes
 * through, and the relative path is joined against the root that resolution returns — so
 * a compromised or confused renderer has no message it can send that reaches outside the
 * project it was granted.
 */

export const DEV_APP_PREVIEW_STATUS_CHANNEL = "devAppPreview:status"

interface RegisterDevAppPreviewHandlersDeps {
  service: DevAppPreviewService
}

/** Source ids are hashes we produced; anything else is not addressing our session. */
function isSourceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value)
}

export function registerDevAppPreviewHandlers(
  ipcMain: IpcMain,
  deps: RegisterDevAppPreviewHandlersDeps,
): void {
  const { service } = deps

  ipcMain.handle(
    "devAppPreview:open",
    async (
      _event,
      options: {
        workspaceId: string
        laneId?: string | null
        relativePath: string
        leaseId: string
      },
    ) => {
      try {
        if (typeof options?.relativePath !== "string" || options.relativePath.length === 0) {
          return { success: false as const, error: "A path inside the project is required." }
        }
        const access = await resolveAuthorizedWorkspaceAccess({
          workspaceId: options.workspaceId,
          laneId: options.laneId,
          operation: "read-file",
        })
        return {
          success: true as const,
          preview: service.open({
            workspaceId: options.workspaceId,
            workspaceRoot: access.projectRootPath,
            relativePath: options.relativePath,
            leaseId: options.leaseId,
          }),
        }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Could not open the preview.",
        }
      }
    },
  )

  ipcMain.handle("devAppPreview:approve", async (_event, options: { sourceId: string }) => {
    if (!isSourceId(options?.sourceId)) return { success: false as const, error: "Unknown preview." }
    const status = service.approve(options.sourceId)
    return status
      ? { success: true as const, preview: status }
      : { success: false as const, error: "That preview is no longer open." }
  })

  ipcMain.handle("devAppPreview:status", async (_event, options: { sourceId: string }) => {
    if (!isSourceId(options?.sourceId)) return { success: false as const, error: "Unknown preview." }
    const status = service.status(options.sourceId)
    return status
      ? { success: true as const, preview: status }
      : { success: false as const, error: "That preview is no longer open." }
  })

  ipcMain.handle("devAppPreview:close", async (_event, options: { sourceId: string }) => {
    if (isSourceId(options?.sourceId)) service.close(options.sourceId)
    return { success: true as const }
  })
}

/** Pushes status changes — reloads, crashes, preflight verdicts — to open windows. */
export function broadcastDevAppPreviewStatus(
  targets: () => WebContents[],
  sourceId: string,
  status: unknown,
): void {
  for (const contents of targets()) {
    if (contents.isDestroyed()) continue
    contents.send(DEV_APP_PREVIEW_STATUS_CHANNEL, { sourceId, status })
  }
}
