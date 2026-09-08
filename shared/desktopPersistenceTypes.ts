/** Wire contracts for the single-writer desktop UI persistence service. */
export const DESKTOP_STATE_NAMESPACES = [
  'queryCache', 'workbenchModel', 'workbenchLayout', 'lastWorkbenchRoute', 'branchKnowledge', 'sessionRegistry',
] as const;
export type DesktopStateNamespace = typeof DESKTOP_STATE_NAMESPACES[number];

export const LEGACY_DESKTOP_DOMAINS = [
  'cozea:project-workbench-layouts',
  'cozea:project-workbench',
  'cozea-query-cache',
  'cozea.lastWorkbenchRoute.v1',
  'cozea:project-branch-sessions:v1',
  'workbench-session-registry.json',
] as const;
export type LegacyDesktopDomain = typeof LEGACY_DESKTOP_DOMAINS[number];

export interface DesktopStateRecord<T = unknown> {
  schemaVersion: 1;
  namespace: DesktopStateNamespace;
  key: string;
  /** Per-record version, checked against the committed predecessor by the worker. */
  recordRevision: number;
  updatedAt: number;
  bindingRevision?: number;
  /** Stable across retries of one immutable write. Not a filename or credential. */
  mutationId?: string;
  deleted?: boolean;
  data: T;
}

export interface PersistenceCommitRequest { records: DesktopStateRecord[] }
export interface PersistenceAcknowledgement {
  namespace: DesktopStateNamespace;
  key: string;
  recordRevision: number;
  mutationId?: string;
  disposition: 'committed' | 'unchanged' | 'not-persisted';
}
export interface PersistenceCommitResult {
  status: 'committed' | 'error' | 'conflict';
  /** Keys are desktopStateRecordKey(namespace, key), not ambiguous naked keys. */
  committedRevisions: Record<string, number>;
  acknowledgements: PersistenceAcknowledgement[];
  /** Main-service operation watermark. Never the maximum per-record version. */
  operationWatermark: number;
  serviceEpoch?: string;
  errorMessage?: string;
}
export interface PersistenceLoadRequest { namespace: DesktopStateNamespace; keys?: string[] }
export interface PersistenceLoadIssue {
  namespace: DesktopStateNamespace;
  key: string | null;
  code: 'corrupt' | 'unreadable' | 'invalid-binding';
  message: string;
}
export interface PersistenceLoadResult {
  records: DesktopStateRecord[];
  issues: PersistenceLoadIssue[];
}
export interface PersistenceFlushRequest {
  /** A watermark previously returned by this main-service epoch. */
  targetRevision?: number;
  serviceEpoch?: string;
}
export interface PersistenceFlushResult {
  status: 'flushed' | 'error';
  flushedRevision: number;
  serviceEpoch?: string;
  errorMessage?: string;
}
export interface LegacyMigrationResult {
  domain: LegacyDesktopDomain;
  importedCount: number;
  quarantinedCount: number;
  skippedCount: number;
  backupPath: string;
  sourceChecksum: string;
}

export interface DesktopPersistenceApi {
  load(options: PersistenceLoadRequest): Promise<PersistenceLoadResult>;
  commit(options: PersistenceCommitRequest): Promise<PersistenceCommitResult>;
  flush(options?: PersistenceFlushRequest): Promise<PersistenceFlushResult>;
  migrateLegacy(options: { domain: LegacyDesktopDomain; rawPayload: string }): Promise<LegacyMigrationResult>;
}

export function desktopStateRecordKey(namespace: DesktopStateNamespace, key: string): string {
  return JSON.stringify([namespace, key]);
}
