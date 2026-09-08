import {
  DESKTOP_STATE_NAMESPACES, LEGACY_DESKTOP_DOMAINS,
  type DesktopStateNamespace, type DesktopStateRecord, type LegacyDesktopDomain,
} from './desktopPersistenceTypes';

export const MAX_PERSISTENCE_BATCH_RECORDS = 16;
export const MAX_PERSISTENCE_KEY_LENGTH = 4096;
export const MAX_LEGACY_PAYLOAD_LENGTH = 64 * 1024 * 1024;
export const MAX_QUERY_PERSISTED_BYTES = 1024 * 1024;
export const QUERY_CACHE_PERSISTED_BUDGET = 16 * 1024 * 1024;
export const MAX_PERSISTED_QUERY_ENTRIES = 250;

export function isPlainRecord(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}
export function isDesktopStateNamespace(value: unknown): value is DesktopStateNamespace {
  return typeof value === 'string' && (DESKTOP_STATE_NAMESPACES as readonly string[]).includes(value);
}
export function isLegacyDesktopDomain(value: unknown): value is LegacyDesktopDomain {
  return typeof value === 'string' && (LEGACY_DESKTOP_DOMAINS as readonly string[]).includes(value);
}
export function isPersistenceKey(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= MAX_PERSISTENCE_KEY_LENGTH &&
    !/[\u0000-\u001f\u007f]/u.test(value);
}
export function isPositiveRevision(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}
/** Cheap envelope check in main; deep payload validation runs only in the worker. */
export function isDesktopStateRecord(value: unknown): value is DesktopStateRecord {
  if (!isPlainRecord(value)) return false;
  return value.schemaVersion === 1 && isDesktopStateNamespace(value.namespace) && isPersistenceKey(value.key) &&
    isPositiveRevision(value.recordRevision) && typeof value.updatedAt === 'number' &&
    Number.isFinite(value.updatedAt) && value.updatedAt >= 0 && Object.hasOwn(value, 'data') &&
    (value.bindingRevision === undefined || isPositiveRevision(value.bindingRevision)) &&
    (value.mutationId === undefined || (typeof value.mutationId === 'string' && value.mutationId.length > 0 && value.mutationId.length <= 256)) &&
    (value.deleted === undefined || typeof value.deleted === 'boolean');
}
export function assertPersistenceBatch(value: unknown, renderer: boolean): asserts value is DesktopStateRecord[] {
  if (!Array.isArray(value) || value.length < 1 || value.length > MAX_PERSISTENCE_BATCH_RECORDS) {
    throw new Error('A desktop persistence batch must contain 1–16 records.');
  }
  const keys = new Set<string>();
  for (const record of value) {
    if (!isDesktopStateRecord(record) || (renderer && record.namespace === 'sessionRegistry')) {
      throw new Error('Invalid or unauthorized desktop persistence record.');
    }
    const key = JSON.stringify([record.namespace, record.key]);
    if (keys.has(key)) throw new Error('Duplicate desktop persistence key in a batch.');
    keys.add(key);
  }
}
export function assertPersistenceLoad(namespace: unknown, keys: unknown, renderer: boolean): asserts namespace is DesktopStateNamespace {
  if (!isDesktopStateNamespace(namespace) || (renderer && namespace === 'sessionRegistry')) {
    throw new Error('Invalid or unauthorized desktop persistence namespace.');
  }
  if (keys !== undefined && (!Array.isArray(keys) || keys.length > 256 || keys.some((key) => !isPersistenceKey(key)))) {
    throw new Error('Invalid desktop persistence load keys.');
  }
}
export function assertLegacyMigration(domain: unknown, rawPayload: unknown, renderer: boolean): asserts domain is LegacyDesktopDomain {
  if (!isLegacyDesktopDomain(domain) || (renderer && domain === 'workbench-session-registry.json')) {
    throw new Error('Invalid or unauthorized legacy migration domain.');
  }
  if (typeof rawPayload !== 'string' || rawPayload.length > MAX_LEGACY_PAYLOAD_LENGTH) {
    throw new Error('Invalid or oversized legacy migration payload.');
  }
}

/** JSON, not arbitrary structured-clone values: never silently lose Map/Date/function data. */
export function assertJsonData(value: unknown): void {
  const ancestors = new Set<object>();
  let visited = 0;
  function visit(current: unknown, depth: number): void {
    if (++visited > 1_000_000 || depth > 100) throw new Error('Desktop state exceeds structural limits.');
    if (current === null || typeof current === 'string' || typeof current === 'boolean') return;
    if (typeof current === 'number' && Number.isFinite(current)) return;
    if (typeof current !== 'object' || current === null || (!Array.isArray(current) && !isPlainRecord(current))) {
      throw new Error('Desktop state must contain JSON-safe data.');
    }
    if (ancestors.has(current)) throw new Error('Desktop state contains a cycle.');
    ancestors.add(current);
    if (Array.isArray(current)) {
      for (const child of current) visit(child, depth + 1);
    } else {
      // Optional object fields have the same omission semantics as the old JSON store.
      for (const child of Object.values(current)) if (child !== undefined) visit(child, depth + 1);
    }
    ancestors.delete(current);
  }
  visit(value, 0);
}

export function isSerializedDesktopLayout(value: unknown): boolean {
  return isPlainRecord(value) && isPlainRecord(value.grid) && isPlainRecord(value.panels);
}
/** Preserve supported data verbatim; do not sanitize unknown state into a new empty workbench. */
export function validateDesktopStateData(record: DesktopStateRecord): void {
  assertJsonData(record.data);
  if (record.deleted) {
    if (record.data !== null) throw new Error('A tombstone must have null data.');
    return;
  }
  const data = record.data;
  if (record.namespace === 'workbenchLayout') {
    if (!isPlainRecord(data) || typeof data.layoutResetKey !== 'number' || !Number.isFinite(data.layoutResetKey) ||
        (data.layout !== null && !isSerializedDesktopLayout(data.layout))) {
      throw new Error('Invalid workbench layout payload.');
    }
  } else if (record.namespace === 'workbenchModel') {
    if (!isPlainRecord(data) || !isPersistenceKey(data.projectId) || !isPersistenceKey(data.laneId) ||
        !(data.workspaceId === null || isPersistenceKey(data.workspaceId)) || !isPlainRecord(data.tiles) ||
        !Array.isArray(data.order) || data.order.some((id) => !isPersistenceKey(id)) ||
        !(data.activeTileId === null || isPersistenceKey(data.activeTileId)) ||
        typeof data.layoutResetKey !== 'number' || !Number.isFinite(data.layoutResetKey)) {
      throw new Error('Invalid workbench model payload.');
    }
    for (const [id, tile] of Object.entries(data.tiles)) {
      if (!isPlainRecord(tile) || tile.id !== id || typeof tile.type !== 'string') throw new Error('Invalid workbench tile payload.');
    }
    if (data.order.some((id) => !Object.hasOwn(data.tiles as object, id))) throw new Error('Workbench order references a missing tile.');
  } else if (record.namespace === 'branchKnowledge') {
    if (!isPlainRecord(data) || !isPersistenceKey(data.projectId) || !isPersistenceKey(data.workspaceId) ||
        typeof data.activeBranch !== 'string' || !data.activeBranch.trim() || typeof data.collabBranch !== 'string' ||
        typeof data.updatedAt !== 'number' || !Number.isFinite(data.updatedAt)) throw new Error('Invalid branch knowledge payload.');
  } else if (record.namespace === 'lastWorkbenchRoute') {
    if (!isPlainRecord(data) || !isPersistenceKey(data.projectId) || !isPersistenceKey(data.laneId) ||
        !isPersistenceKey(data.workspaceSelectionId)) throw new Error('Invalid last workbench locator.');
  } else if (record.namespace === 'sessionRegistry') {
    if (!isPlainRecord(data) || data.version !== 1 || !isPlainRecord(data.sessions)) throw new Error('Invalid session registry payload.');
  }
}
