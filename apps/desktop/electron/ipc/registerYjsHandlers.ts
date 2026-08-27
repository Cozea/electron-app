import type { IpcMain } from "electron"

import { setYjsInterestRootsFromRenderer } from "../yjsNotify"

export function registerYjsHandlers(ipcMain: IpcMain): void {
  ipcMain.handle(
    "yjs:setInterestRoots",
    (event, payload: { roots?: string[] } | undefined) => {
      setYjsInterestRootsFromRenderer(event.sender.id, payload?.roots ?? [])
      return { success: true as const }
    },
  )
}
