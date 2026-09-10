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
}
