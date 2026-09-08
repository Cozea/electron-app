/**
 * Desktop State Persistence Types & Envelopes
 * Conforms to Section 10.2 of docs/perf/navigation-runtime-plan.md
 */

export type DesktopStateNamespace =
  | 'queryCache'
  | 'workbenchModel'
  | 'workbenchLayout'
  | 'lastWorkbenchRoute'
  | 'sessionRegistry';

export interface DesktopStateRecord<T = unknown> {
  schemaVersion: 1;
  namespace: DesktopStateNamespace;
  key: string;
  recordRevision: number;
  updatedAt: number;
  bindingRevision?: number;
  data: T;
}

export interface PersistenceCommitRequest {
  records: DesktopStateRecord[];
}

export interface PersistenceCommitResult {
  status: 'committed' | 'error';
  committedRevisions: Record<string, number>;
  errorMessage?: string;
}

export interface PersistenceLoadRequest {
  namespace: DesktopStateNamespace;
  keys?: string[];
}

export interface PersistenceLoadResult {
  records: DesktopStateRecord[];
}

export interface PersistenceFlushRequest {
  targetRevision?: number;
}

export interface PersistenceFlushResult {
  status: 'flushed' | 'error';
  flushedRevision: number;
  errorMessage?: string;
}

export interface LegacyMigrationResult {
  domain: string;
  importedCount: number;
  quarantinedCount: number;
  backupPath: string;
}
