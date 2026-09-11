/**
 * Registers projectd IPC handlers in Electron Main.
 *
 * Master Specification: docs/collaboration/collaboration-autogit-master-plan.md
 * Phase: P02
 */

import { ipcMain } from "electron"
import { getSharedProjectdClient } from "./ProjectdClient"

export function registerProjectdHandlers(): void {
  ipcMain.handle("projectd:health", async () => {
    const client = getSharedProjectdClient()
    try {
      const health = await client.health()
      return { success: true, health }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle("projectd:connect", async () => {
    const client = getSharedProjectdClient()
    try {
      await client.connect()
      const health = await client.health()
      return { success: true, health }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle("projectd:disconnect", async () => {
    const client = getSharedProjectdClient()
    client.disconnect()
    return { success: true }
  })

  ipcMain.handle("projectd:workbenches:list", async (_event, projectId: string) => {
    const client = getSharedProjectdClient()
    try {
      const workbenches = await client.listWorkbenches(projectId)
      return { success: true, workbenches }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle("projectd:workbenches:get", async (_event, workbenchId: string) => {
    const client = getSharedProjectdClient()
    try {
      const workbench = await client.getWorkbench(workbenchId)
      return { success: true, workbench }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle(
    "projectd:workbenches:activate",
    async (_event, req: { projectId: string; workbenchId: string }) => {
      const client = getSharedProjectdClient()
      try {
        const result = await client.activateWorkbench(req.projectId, req.workbenchId)
        return { success: true, result }
      } catch (err: any) {
        return { success: false, error: err.message, code: err.code }
      }
    },
  )

  ipcMain.handle(
    "projectd:workbenches:idle",
    async (_event, req: { projectId: string; workbenchId: string }) => {
      const client = getSharedProjectdClient()
      try {
        const result = await client.idleWorkbench(req.projectId, req.workbenchId)
        return { success: true, result }
      } catch (err: any) {
        return { success: false, error: err.message, code: err.code }
      }
    },
  )

  ipcMain.handle("projectd:workspaces:list", async (_event, projectId: string) => {
    const client = getSharedProjectdClient()
    try {
      const workspaces = await client.listWorkspaces(projectId)
      return { success: true, workspaces }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })

  ipcMain.handle("projectd:workspaces:get", async (_event, workspaceId: string) => {
    const client = getSharedProjectdClient()
    try {
      const workspace = await client.getWorkspace(workspaceId)
      return { success: true, workspace }
    } catch (err: any) {
      return { success: false, error: err.message, code: err.code }
    }
  })
}
