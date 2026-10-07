import { ipcMain } from 'electron'

import type {
  DesktopBootstrapSession,
  DesktopWorkbenchLocator,
  LocalDevicePresentationUpdate,
} from '@cozea/app-contract/desktopBootstrap'
import { DesktopBootstrapStore } from './services/DesktopBootstrapStore'
import { ensureCollabDeviceIdentity } from './collabKeys'

const store = new DesktopBootstrapStore(ensureCollabDeviceIdentity)

ipcMain.handle('desktopBootstrap:getInitialSnapshot', () => store.getInitialSnapshot())
ipcMain.handle('desktopBootstrap:getLocalDevice', () => store.getLocalDevice())
ipcMain.handle('desktopBootstrap:updateLocalDevice', (_event, update: LocalDevicePresentationUpdate) => store.updateLocalDevice(update))
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
