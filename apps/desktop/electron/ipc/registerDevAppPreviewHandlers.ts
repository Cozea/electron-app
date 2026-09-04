import type { BrowserWindow, IpcMain, IpcMainInvokeEvent, WebContents } from "electron"

import { resolveAuthorizedWorkspaceAccess } from "../workspaces/authorization"
import type { DevAppPreviewService } from "../services/DevAppPreviewService"

/**
 * IPC for native/web DevApp development preview.
 *
 * The renderer names a workspace and a path relative to it, never a directory. Main resolves
 * that workspace through the same authorization every other project operation uses.
 */
export const DEV_APP_PREVIEW_STATUS_CHANNEL = "devAppPreview:status"

interface RegisterDevAppPreviewHandlersDeps {
  service: DevAppPreviewService
  getMainWindow: () => BrowserWindow | null
}

function isSourceId(value: unknown): value is string {
  return typeof value === "string" && /^[0-9a-f]{32}$/.test(value)
}

export function registerDevAppPreviewHandlers(
  ipcMain: IpcMain,
  deps: RegisterDevAppPreviewHandlersDeps,
): void {
  const { service } = deps
  const assertMainRenderer = (event: IpcMainInvokeEvent): void => {
    const window = deps.getMainWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents) {
      throw new Error("DevApp preview IPC is restricted to the main Cozea renderer.")
    }
  }

  ipcMain.handle(
    "devAppPreview:open",
    async (
      event,
      options: {
        workspaceId: string
        laneId?: string | null
        relativePath: string
        leaseId: string
      },
    ) => {
      try {
        assertMainRenderer(event)
        if (
          typeof options?.workspaceId !== "string" ||
          options.workspaceId.length === 0 ||
          options.workspaceId.length > 160 ||
          typeof options?.relativePath !== "string" ||
          options.relativePath.length === 0 ||
          options.relativePath.length > 512 ||
          options.relativePath.includes("\0") ||
          !isLeaseId(options.leaseId)
        ) {
          return { success: false as const, error: "A path inside the project is required." }
        }
        const access = await resolveAuthorizedWorkspaceAccess({
          workspaceId: options.workspaceId,
          laneId: options.laneId,
          operation: "read-file",
        })
        // Native React ESM is imported by the main renderer rather than an isolated webview.
        // Register a multi-source, authorization-backed protocol handler for that renderer session.
        service.registerRendererProtocol(event.sender.session)
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

  ipcMain.handle(
    "devAppPreview:approve",
    async (
      event,
      options: {
        sourceId: string
        approvalFingerprint: string
      },
    ) => {
      assertMainRenderer(event)
      if (!isSourceId(options?.sourceId)) {
        return { success: false as const, error: "Unknown preview." }
      }
      if (
        typeof options.approvalFingerprint !== "string" ||
        options.approvalFingerprint.length > 512
      ) {
        return { success: false as const, error: "The approval request is invalid." }
      }
      try {
        const status = service.approve(options.sourceId, options.approvalFingerprint)
        return status
          ? { success: true as const, preview: status }
          : { success: false as const, error: "That preview is no longer open." }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "Could not approve the preview.",
        }
      }
    },
  )

  ipcMain.handle("devAppPreview:status", async (event, options: { sourceId: string }) => {
    assertMainRenderer(event)
    if (!isSourceId(options?.sourceId)) {
      return { success: false as const, error: "Unknown preview." }
    }
    const status = service.status(options.sourceId)
    return status
      ? { success: true as const, preview: status }
      : { success: false as const, error: "That preview is no longer open." }
  })

  ipcMain.handle(
    "devAppPreview:invokeTool",
    async (
      event,
      options: {
        sourceId: string
        name: string
        input: unknown
        timeoutMs?: number
      },
    ) => {
      assertMainRenderer(event)
      if (
        !isSourceId(options?.sourceId) ||
        typeof options?.name !== "string" ||
        !/^[a-z][a-z0-9_-]{0,63}$/.test(options.name)
      ) {
        return { success: false as const, error: "The DevApp tool target is invalid." }
      }
      try {
        return {
          success: true as const,
          result: await service.invokeTool(
            options.sourceId,
            options.name,
            options.input,
            options.timeoutMs,
          ),
        }
      } catch (error) {
        return {
          success: false as const,
          error: error instanceof Error ? error.message : "The DevApp tool failed.",
        }
      }
    },
  )

  ipcMain.handle(
    "devAppPreview:close",
    async (event, options: { sourceId: string; leaseId: string }) => {
      assertMainRenderer(event)
      if (isSourceId(options?.sourceId) && isLeaseId(options?.leaseId)) {
        service.close(options.sourceId, options.leaseId)
      }
      return { success: true as const }
    },
  )
}

function isLeaseId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9_-]{1,192}$/.test(value)
}

/** Pushes build generations, extension crashes and preflight changes to open windows. */
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
