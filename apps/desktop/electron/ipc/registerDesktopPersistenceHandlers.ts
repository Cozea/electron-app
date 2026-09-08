import type { BrowserWindow, IpcMain, IpcMainInvokeEvent } from 'electron'
import { getDesktopStatePersistenceService } from '../services/DesktopStatePersistenceService'
import {
  isDesktopStateNamespace, isLegacyDesktopDomain, isPlainRecord, validateDesktopStateRecord,
} from '../../../../shared/desktopPersistenceTypes'

interface PersistenceHandlerDependencies {
  getMainWindow: () => BrowserWindow | null
  isTrustedURL: (url: string) => boolean
}
export function registerDesktopPersistenceHandlers(ipcMain: IpcMain, dependencies: PersistenceHandlerDependencies): void {
  const trusted = (event: IpcMainInvokeEvent): void => {
    const window = dependencies.getMainWindow()
    if (!window || window.isDestroyed() || event.sender !== window.webContents ||
      !event.senderFrame || event.senderFrame !== event.sender.mainFrame ||
      !dependencies.isTrustedURL(event.senderFrame.url)) throw new Error('Untrusted desktop persistence sender')
  }
  ipcMain.handle('desktopPersistence:load', (event, options: unknown) => {
    trusted(event)
    if (!isPlainRecord(options) || !isDesktopStateNamespace(options.namespace) || options.namespace === 'sessionRegistry' ||
      (options.keys !== undefined && (!Array.isArray(options.keys) || options.keys.length > 256 || options.keys.some(key => typeof key !== 'string' || !key || key.length > 8192)))) throw new Error('Invalid load request')
    return getDesktopStatePersistenceService().load(options.namespace, options.keys as string[] | undefined)
  })
  ipcMain.handle('desktopPersistence:commit', (event, options: unknown) => {
    trusted(event)
    if (!isPlainRecord(options) || !Array.isArray(options.records) || !options.records.length || options.records.length > 16 ||
      !options.records.every(validateDesktopStateRecord) || options.records.some(record => record.namespace === 'sessionRegistry')) throw new Error('Invalid commit request')
    return getDesktopStatePersistenceService().commit(options.records)
  })
  ipcMain.handle('desktopPersistence:flush', (event, options: unknown) => {
    trusted(event)
    if (options !== undefined && (!isPlainRecord(options) || (options.targetRevision !== undefined &&
      (!Number.isSafeInteger(options.targetRevision) || Number(options.targetRevision) < 0)))) throw new Error('Invalid flush request')
    return getDesktopStatePersistenceService().flush((options as { targetRevision?: number } | undefined)?.targetRevision)
  })
  ipcMain.handle('desktopPersistence:migrateLegacy', (event, options: unknown) => {
    trusted(event)
    if (!isPlainRecord(options) || !isLegacyDesktopDomain(options.domain) || typeof options.rawPayload !== 'string' ||
      options.rawPayload.length > 128 * 1024 * 1024) throw new Error('Invalid migration request')
    return getDesktopStatePersistenceService().migrateLegacy(options.domain, options.rawPayload)
  })
}
