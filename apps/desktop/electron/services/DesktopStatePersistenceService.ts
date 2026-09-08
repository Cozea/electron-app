/**
 * Desktop State Persistence Service Facade (Main Process)
 * Conforms to Section 10.2 of docs/perf/navigation-runtime-plan.md
 */

import { app } from 'electron';
import type {
  DesktopStateNamespace,
  DesktopStateRecord,
  PersistenceCommitResult,
  PersistenceLoadResult,
  PersistenceFlushResult,
  LegacyMigrationResult,
} from '@shared/desktopPersistenceTypes';
import { DesktopStatePersistenceWorkerCore } from '../workers/desktopStatePersistenceWorkerCore';

const ALLOWED_RENDERER_NAMESPACES = new Set<DesktopStateNamespace>([
  'queryCache',
  'workbenchModel',
  'workbenchLayout',
  'lastWorkbenchRoute',
]);

export class DesktopStatePersistenceService {
  private readonly core: DesktopStatePersistenceWorkerCore;

  constructor(userDataPath?: string) {
    const resolvedPath = userDataPath ?? (app ? app.getPath('userData') : '/tmp/cozea-test-user-data');
    this.core = new DesktopStatePersistenceWorkerCore({ userDataPath: resolvedPath });
  }

  async load(
    namespace: DesktopStateNamespace,
    keys?: string[],
    isRenderer = true
  ): Promise<PersistenceLoadResult> {
    if (isRenderer && !ALLOWED_RENDERER_NAMESPACES.has(namespace)) {
      throw new Error(`Namespace not accessible from renderer: ${namespace}`);
    }
    return this.core.load(namespace, keys);
  }

  async commit(
    records: DesktopStateRecord[],
    isRenderer = true
  ): Promise<PersistenceCommitResult> {
    if (isRenderer) {
      for (const rec of records) {
        if (!ALLOWED_RENDERER_NAMESPACES.has(rec.namespace)) {
          throw new Error(`Namespace not accessible from renderer: ${rec.namespace}`);
        }
      }
    }
    return this.core.commit(records);
  }

  async flush(targetRevision?: number): Promise<PersistenceFlushResult> {
    return this.core.flush(targetRevision);
  }

  async migrateLegacy(
    domain: string,
    rawPayload: string
  ): Promise<LegacyMigrationResult> {
    return this.core.migrateLegacyDomain(domain, rawPayload);
  }
}

let persistenceServiceInstance: DesktopStatePersistenceService | null = null;

export function getDesktopStatePersistenceService(userDataPath?: string): DesktopStatePersistenceService {
  if (!persistenceServiceInstance) {
    persistenceServiceInstance = new DesktopStatePersistenceService(userDataPath);
  }
  return persistenceServiceInstance;
}
