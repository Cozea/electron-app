import type { BrowserWindow, IpcMain } from 'electron';
import { getDesktopStatePersistenceService } from '../services/DesktopStatePersistenceService';
import { assertTrustedMainDesktopSender } from './trustedDesktopSender';
import { assertLegacyMigration, assertPersistenceBatch, assertPersistenceLoad, isPlainRecord } from '@shared/desktopPersistenceValidation';
import type { DesktopStateNamespace, LegacyDesktopDomain } from '@shared/desktopPersistenceTypes';

interface DesktopPersistenceHandlerOptions { getMainWindow: () => BrowserWindow | null }
export function registerDesktopPersistenceHandlers(ipcMain: IpcMain, options: DesktopPersistenceHandlerOptions): () => void {
  const service = getDesktopStatePersistenceService();
  const channels = [
    'desktopPersistence:load', 'desktopPersistence:commit', 'desktopPersistence:flush', 'desktopPersistence:migrateLegacy',
  ] as const;
  ipcMain.handle(channels[0], (event, input: unknown) => {
    assertTrustedMainDesktopSender(event, options.getMainWindow);
    if (!isPlainRecord(input)) throw new Error('Invalid desktop state load request.');
    assertPersistenceLoad(input.namespace, input.keys, true);
    return service.load(input.namespace as DesktopStateNamespace, input.keys as string[] | undefined, true);
  });
  ipcMain.handle(channels[1], (event, input: unknown) => {
    assertTrustedMainDesktopSender(event, options.getMainWindow);
    if (!isPlainRecord(input)) throw new Error('Invalid desktop state commit request.');
    assertPersistenceBatch(input.records, true);
    return service.commit(input.records, true);
  });
  ipcMain.handle(channels[2], (event, input: unknown) => {
    assertTrustedMainDesktopSender(event, options.getMainWindow);
    if (input !== undefined && !isPlainRecord(input)) throw new Error('Invalid desktop state flush request.');
    const target = isPlainRecord(input) ? input.targetRevision : undefined;
    const epoch = isPlainRecord(input) ? input.serviceEpoch : undefined;
    if ((target !== undefined && (typeof target !== 'number' || !Number.isSafeInteger(target) || target < 0)) ||
        (epoch !== undefined && (typeof epoch !== 'string' || epoch.length > 128))) throw new Error('Invalid persistence watermark.');
    return service.flush(target as number | undefined, epoch as string | undefined);
  });
  ipcMain.handle(channels[3], (event, input: unknown) => {
    assertTrustedMainDesktopSender(event, options.getMainWindow);
    if (!isPlainRecord(input)) throw new Error('Invalid migration request.');
    assertLegacyMigration(input.domain, input.rawPayload, true);
    return service.migrateLegacy(input.domain as LegacyDesktopDomain, input.rawPayload as string, true);
  });
  return () => { for (const channel of channels) ipcMain.removeHandler(channel); };
}
