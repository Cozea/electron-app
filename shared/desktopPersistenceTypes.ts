export const DESKTOP_STATE_NAMESPACES = ['queryCache', 'workbenchModel', 'workbenchLayout', 'lastWorkbenchRoute', 'sessionRegistry'] as const
export type DesktopStateNamespace = typeof DESKTOP_STATE_NAMESPACES[number]
export const LEGACY_DESKTOP_DOMAINS = ['cozea-query-cache', 'cozea:project-workbench-layouts', 'cozea:project-workbench'] as const
export type LegacyDesktopDomain = typeof LEGACY_DESKTOP_DOMAINS[number]
export interface DesktopStateRecord<T = unknown> {
  schemaVersion: 1
  namespace: DesktopStateNamespace
  key: string
  recordRevision: number
  updatedAt: number
  bindingRevision?: number
  deleted?: boolean
  data: T
}
export interface PersistenceCommitRequest { records: DesktopStateRecord[] }
export interface PersistenceCommitResult {
  status: 'committed' | 'error'
  committedRevisions: Record<string, number>
  /** Main-assigned operation watermark, not the maximum per-record version. */
  watermark?: number
  errorMessage?: string
}
export interface PersistenceLoadRequest { namespace: DesktopStateNamespace; keys?: string[] }
export interface PersistenceLoadResult { records: DesktopStateRecord[] }
export interface PersistenceFlushRequest { targetRevision?: number }
export interface PersistenceFlushResult { status: 'flushed' | 'error'; flushedRevision: number; errorMessage?: string }
export interface LegacyMigrationResult { domain: string; importedCount: number; quarantinedCount: number; backupPath: string }
export function isDesktopStateNamespace(value: unknown): value is DesktopStateNamespace {
  return typeof value === 'string' && (DESKTOP_STATE_NAMESPACES as readonly string[]).includes(value)
}
export function isLegacyDesktopDomain(value: unknown): value is LegacyDesktopDomain {
  return typeof value === 'string' && (LEGACY_DESKTOP_DOMAINS as readonly string[]).includes(value)
}
export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype
}
export function validateDesktopStateRecord(value: unknown): value is DesktopStateRecord {
  if (!isPlainRecord(value)) return false
  return value.schemaVersion === 1 && isDesktopStateNamespace(value.namespace) &&
    typeof value.key === 'string' && value.key.length > 0 && value.key.length <= 8192 &&
    !value.key.includes('\u0000') && Number.isSafeInteger(value.recordRevision) && Number(value.recordRevision) >= 1 &&
    typeof value.updatedAt === 'number' && Number.isFinite(value.updatedAt) &&
    (value.bindingRevision === undefined || (Number.isSafeInteger(value.bindingRevision) && Number(value.bindingRevision) >= 1)) &&
    (value.deleted === undefined || typeof value.deleted === 'boolean') && Object.hasOwn(value, 'data')
}
