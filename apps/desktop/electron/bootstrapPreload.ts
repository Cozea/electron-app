import { contextBridge, ipcRenderer } from 'electron'

import type {
  DesktopBootstrapBridge,
  DesktopBootstrapSession,
  DesktopWorkbenchLocator,
} from '../../../shared/desktopBootstrapTypes'
import './preload'

const desktopBootstrapBridge: DesktopBootstrapBridge = {
  getInitialSnapshot: () => ipcRenderer.invoke('desktopBootstrap:getInitialSnapshot'),
  storeSession: (session: DesktopBootstrapSession) =>
    ipcRenderer.invoke('desktopBootstrap:storeSession', session),
  clearSession: () => ipcRenderer.invoke('desktopBootstrap:clearSession'),
  setLastWorkbenchRoute: (entry: DesktopWorkbenchLocator) =>
    ipcRenderer.invoke('desktopBootstrap:setLastWorkbenchRoute', entry),
  clearLastWorkbenchRoute: (workspaceSelectionId: string) =>
    ipcRenderer.invoke('desktopBootstrap:clearLastWorkbenchRoute', workspaceSelectionId),
  clearLastWorkbenchRoutesForProject: (projectId: string) =>
    ipcRenderer.invoke('desktopBootstrap:clearLastWorkbenchRoutesForProject', projectId),
}

contextBridge.exposeInMainWorld('cozeaBootstrap', desktopBootstrapBridge)
