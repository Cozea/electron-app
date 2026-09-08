/**
 * Register Desktop State Persistence IPC Handlers
 * Conforms to Section 10.2 of docs/perf/navigation-runtime-plan.md
 */

import type { IpcMain } from 'electron';
import { getDesktopStatePersistenceService } from '../services/DesktopStatePersistenceService';
import type {
  DesktopStateNamespace,
  DesktopStateRecord,
} from '@shared/desktopPersistenceTypes';

export function registerDesktopPersistenceHandlers(ipcMain: IpcMain): void {
  const service = getDesktopStatePersistenceService();

  ipcMain.handle(
    'desktopPersistence:load',
    async (_event, options: { namespace: DesktopStateNamespace; keys?: string[] }) => {
      return await service.load(options.namespace, options.keys, true);
    }
  );

  ipcMain.handle(
    'desktopPersistence:commit',
    async (_event, options: { records: DesktopStateRecord[] }) => {
      return await service.commit(options.records, true);
    }
  );

  ipcMain.handle(
    'desktopPersistence:flush',
    async (_event, options?: { targetRevision?: number }) => {
      return await service.flush(options?.targetRevision);
    }
  );

  ipcMain.handle(
    'desktopPersistence:migrateLegacy',
    async (_event, options: { domain: string; rawPayload: string }) => {
      return await service.migrateLegacy(options.domain, options.rawPayload);
    }
  );
}
