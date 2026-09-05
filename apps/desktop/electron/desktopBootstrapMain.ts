import { ipcMain } from 'electron'
import { performance } from 'node:perf_hooks'

import type {
  DesktopBootstrapSession,
  DesktopWorkbenchLocator,
} from '../../../shared/desktopBootstrapTypes'
import { DesktopBootstrapStore } from './services/DesktopBootstrapStore'

declare global {
  var __COZEA_MAIN_ENTRY_AT__: number | undefined
}

globalThis.__COZEA_MAIN_ENTRY_AT__ ??= performance.now()

const store = new DesktopBootstrapStore()

ipcMain.handle('desktopBootstrap:getInitialSnapshot', () => store.getInitialSnapshot())
ipcMain.handle('desktopBootstrap:storeSession', async (_event, session: DesktopBootstrapSession) => {
  await store.storeSession(session)
  return { success: true as const }
})
ipcMain.handle('desktopBootstrap:clearSession', async () => {
  await store.clearSession()
  return { success: true as const }
})
ipcMain.handle('desktopBootstrap:setLastWorkbenchRoute', async (_event, entry: DesktopWorkbenchLocator) => {
  await store.setLastWorkbenchRoute(entry)
  return { success: true as const }
})
ipcMain.handle('desktopBootstrap:clearLastWorkbenchRoute', async (_event, workspaceSelectionId: string) => {
  await store.clearLastWorkbenchRoute(workspaceSelectionId)
  return { success: true as const }
})
ipcMain.handle('desktopBootstrap:clearLastWorkbenchRoutesForProject', async (_event, projectId: string) => {
  await store.clearLastWorkbenchRoutesForProject(projectId)
  return { success: true as const }
})
