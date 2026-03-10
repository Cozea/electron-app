import { app } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { DatabaseSync } from 'node:sqlite'

interface ReplicaStateRecord {
  replicaHead: number
  pendingOps: number
  lastAckedAt: number | null
  ackedOps: string[]
  pathHeads: Record<string, string>
  lastStateVector: number
  lastPersistedAt: number | null
}

export interface SyncOpRecord {
  opId: string
  idempotencyKey: string
  projectId: string
  actorId: string
  actorType: 'user' | 'agent' | 'system'
  source: 'monaco' | 'agent' | 'watcher' | 'remote'
  kind: 'upsert' | 'delete' | 'rename' | 'chmod' | 'yjs_update'
  path: string
  baseHash?: string
  newHash?: string
  isBinary: boolean
  size: number
  timestamp: number
}

export interface MergeCacheRecordPayload {
  key: string
  mergedContent: string
  hasConflicts: boolean
  conflictCount: number
  createdAt: number
  lastUsedAt: number
  hitCount: number
  engine: 'git-merge-file'
  strategy: 'zdiff3' | 'diff3'
  gitVersion: string
  baseHash: string
  localHash: string
  cloudHash: string
}

export interface ConflictResolutionPayload {
  fingerprint: string
  resolvedContent: string
  createdAt: number
  lastUsedAt: number
  hitCount: number
}

export interface SyncHistoryPayload {
  projectId: string
  lastSyncAt: number | null
  cloudPaths: string[]
  version: number
  updatedAt: number
  corrupted: boolean
}

export interface SyncJournalStatePayload {
  projectId: string
  journalHead: number
  pendingOps: number
  lastAckedAt: number | null
  ackedOps: number
  pathHeads: Record<string, string>
  lastJournalCursor: number
  lastPersistedAt: number | null
}

const replicaStateByProject = new Map<string, ReplicaStateRecord>()
const queuedOpsByProject = new Map<string, SyncOpRecord[]>()
const MAX_ACKED_KEYS = 4_000
const MAX_PENDING_OPS_PER_PROJECT = 50_000

export function normalizeSyncPath(input: string): string {
  return input
    .replace(/\\/g, '/')
    .trim()
    .replace(/^\/+/, '')
    .replace(/\/{2,}/g, '/')
}

function buildSyncOpKey(op: Pick<SyncOpRecord, 'opId' | 'idempotencyKey'>): string {
  return `${op.opId}:${op.idempotencyKey}`
}

function createDefaultReplicaState(): ReplicaStateRecord {
  return {
    replicaHead: 0,
    pendingOps: 0,
    lastAckedAt: null,
    ackedOps: [],
    pathHeads: {},
    lastStateVector: 0,
    lastPersistedAt: null,
  }
}

function getReplicaStateRecord(projectId: string): ReplicaStateRecord {
  const existing = replicaStateByProject.get(projectId)
  if (existing) return existing
  const created = createDefaultReplicaState()
  replicaStateByProject.set(projectId, created)
  return created
}

function snapshotReplicaState(projectId: string, state?: ReplicaStateRecord): {
  projectId: string
  replicaHead: number
  pendingOps: number
  lastAckedAt: number | null
  ackedOps: number
  pathHeads: Record<string, string>
  lastStateVector: number
  lastPersistedAt: number | null
} {
  const replica = state ?? getReplicaStateRecord(projectId)
  return {
    projectId,
    replicaHead: replica.replicaHead,
    pendingOps: replica.pendingOps,
    lastAckedAt: replica.lastAckedAt,
    ackedOps: replica.ackedOps.length,
    pathHeads: { ...replica.pathHeads },
    lastStateVector: replica.lastStateVector,
    lastPersistedAt: replica.lastPersistedAt,
  }
}

export function getReplicaStateSnapshot(projectId: string): ReturnType<typeof snapshotReplicaState> {
  const normalizedProjectId = String(projectId)
  const replica = getReplicaStateRecord(normalizedProjectId)
  replica.pendingOps = (queuedOpsByProject.get(normalizedProjectId) ?? []).length
  replica.lastStateVector = replica.replicaHead - replica.pendingOps
  replicaStateByProject.set(normalizedProjectId, replica)
  return snapshotReplicaState(normalizedProjectId, replica)
}

export function getSyncJournalStateSnapshot(projectId: string): SyncJournalStatePayload {
  const snapshot = getReplicaStateSnapshot(projectId)
  return {
    projectId: snapshot.projectId,
    journalHead: snapshot.replicaHead,
    pendingOps: snapshot.pendingOps,
    lastAckedAt: snapshot.lastAckedAt,
    ackedOps: snapshot.ackedOps,
    pathHeads: snapshot.pathHeads,
    lastJournalCursor: snapshot.lastStateVector,
    lastPersistedAt: snapshot.lastPersistedAt,
  }
}

function normalizeSyncOp(projectId: string, op: SyncOpRecord): SyncOpRecord | null {
  const opId = typeof op.opId === 'string' && op.opId.trim() ? op.opId.trim() : null
  const idempotencyKey =
    typeof op.idempotencyKey === 'string' && op.idempotencyKey.trim()
      ? op.idempotencyKey.trim()
      : null
  const actorId = typeof op.actorId === 'string' && op.actorId.trim() ? op.actorId.trim() : 'unknown'
  const pathValue = typeof op.path === 'string' ? normalizeSyncPath(op.path) : ''
  if (!opId || !idempotencyKey || !pathValue) return null

  return {
    opId,
    idempotencyKey,
    projectId,
    actorId,
    actorType: op.actorType,
    source: op.source,
    kind: op.kind,
    path: pathValue,
    baseHash: op.baseHash,
    newHash: op.newHash,
    isBinary: Boolean(op.isBinary),
    size: Math.max(0, Number(op.size) || 0),
    timestamp: Number.isFinite(op.timestamp) ? Number(op.timestamp) : Date.now(),
  }
}

function applyPathHead(replica: ReplicaStateRecord, op: SyncOpRecord): void {
  if (op.kind === 'delete') {
    delete replica.pathHeads[op.path]
    return
  }

  if (op.newHash && op.newHash.length === 64) {
    replica.pathHeads[op.path] = op.newHash
  }
}

export function enqueueSyncOps(projectId: string, incomingOps: SyncOpRecord[]): {
  accepted: number
  acceptedOpIds: string[]
  rejected: number
  replicaState: ReturnType<typeof snapshotReplicaState>
} {
  const normalizedProjectId = String(projectId)
  const queue = queuedOpsByProject.get(normalizedProjectId) ?? []
  const replica = getReplicaStateRecord(normalizedProjectId)
  const seenKeys = new Set<string>([
    ...queue.map((entry) => buildSyncOpKey(entry)),
    ...replica.ackedOps,
  ])

  const sortedOps = [...incomingOps]
    .map((op) => normalizeSyncOp(normalizedProjectId, op))
    .filter((op): op is SyncOpRecord => op !== null)
    .sort((a, b) => {
      if (a.timestamp !== b.timestamp) return a.timestamp - b.timestamp
      return a.opId.localeCompare(b.opId)
    })

  let accepted = 0
  const acceptedOpIds: string[] = []
  let rejected = 0

  for (const op of sortedOps) {
    const key = buildSyncOpKey(op)
    if (seenKeys.has(key)) {
      rejected++
      continue
    }
    if (queue.length >= MAX_PENDING_OPS_PER_PROJECT) {
      rejected++
      continue
    }

    seenKeys.add(key)
    queue.push(op)
    applyPathHead(replica, op)
    accepted++
    acceptedOpIds.push(op.opId)
  }

  queuedOpsByProject.set(normalizedProjectId, queue)
  replica.replicaHead += accepted
  replica.pendingOps = queue.length
  replica.lastStateVector = replica.replicaHead
  replica.lastPersistedAt = Date.now()
  replicaStateByProject.set(normalizedProjectId, replica)
  persistSyncState()

  return {
    accepted,
    acceptedOpIds,
    rejected,
    replicaState: snapshotReplicaState(normalizedProjectId, replica),
  }
}

export function acknowledgeSyncOps(projectId: string, opIds: string[]): {
  acked: number
  replicaState: ReturnType<typeof snapshotReplicaState>
} {
  const normalizedProjectId = String(projectId)
  const replica = getReplicaStateRecord(normalizedProjectId)
  const queue = queuedOpsByProject.get(normalizedProjectId) ?? []
  const ackSet = new Set(opIds.map((id) => String(id)))
  const retained: SyncOpRecord[] = []
  let acked = 0

  for (const op of queue) {
    const key = buildSyncOpKey(op)
    if (ackSet.has(op.opId) || ackSet.has(key) || ackSet.has(op.idempotencyKey)) {
      acked++
      replica.ackedOps.push(key)
      continue
    }
    retained.push(op)
  }

  if (replica.ackedOps.length > MAX_ACKED_KEYS) {
    replica.ackedOps = replica.ackedOps.slice(replica.ackedOps.length - MAX_ACKED_KEYS)
  }
  replica.pendingOps = retained.length
  replica.lastAckedAt = acked > 0 ? Date.now() : replica.lastAckedAt
  replica.lastStateVector = replica.replicaHead - replica.pendingOps
  replica.lastPersistedAt = Date.now()

  queuedOpsByProject.set(normalizedProjectId, retained)
  replicaStateByProject.set(normalizedProjectId, replica)
  persistSyncState()

  return {
    acked,
    replicaState: snapshotReplicaState(normalizedProjectId, replica),
  }
}

function getSyncStatePath(): string {
  return path.join(app.getPath('userData'), 'sync-replica-state.json')
}

function getSyncStateDbPath(): string {
  return path.join(app.getPath('userData'), 'sync-replica-state.sqlite')
}

function normalizeSyncHistoryPaths(paths: string[]): string[] {
  const seen = new Set<string>()
  const normalized: string[] = []
  for (const pathValue of paths) {
    const normalizedPath = normalizeSyncPath(String(pathValue))
    if (!normalizedPath || seen.has(normalizedPath)) continue
    seen.add(normalizedPath)
    normalized.push(normalizedPath)
  }
  normalized.sort((a, b) => a.localeCompare(b))
  return normalized
}

let syncReplicaDb: DatabaseSync | null = null
let syncReplicaDbInitFailed = false

function getSyncReplicaDb(): DatabaseSync | null {
  if (syncReplicaDb) return syncReplicaDb
  if (syncReplicaDbInitFailed) return null

  try {
    const db = new DatabaseSync(getSyncStateDbPath())
    db.exec(`
      PRAGMA journal_mode = WAL;
      PRAGMA synchronous = NORMAL;
      CREATE TABLE IF NOT EXISTS replica_state (
        project_id TEXT PRIMARY KEY,
        replica_head INTEGER NOT NULL,
        pending_ops INTEGER NOT NULL,
        last_acked_at INTEGER,
        acked_ops_json TEXT NOT NULL,
        path_heads_json TEXT NOT NULL,
        last_state_vector INTEGER NOT NULL,
        last_persisted_at INTEGER
      );
      CREATE TABLE IF NOT EXISTS pending_ops (
        project_id TEXT NOT NULL,
        op_id TEXT NOT NULL,
        idempotency_key TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        actor_type TEXT NOT NULL,
        source TEXT NOT NULL,
        kind TEXT NOT NULL,
        path TEXT NOT NULL,
        base_hash TEXT,
        new_hash TEXT,
        is_binary INTEGER NOT NULL,
        size INTEGER NOT NULL,
        timestamp INTEGER NOT NULL,
        PRIMARY KEY (project_id, op_id, idempotency_key)
      );
      CREATE INDEX IF NOT EXISTS idx_pending_ops_project_time
      ON pending_ops (project_id, timestamp, op_id);
      CREATE TABLE IF NOT EXISTS merge_cache (
        cache_key TEXT PRIMARY KEY,
        merged_content TEXT NOT NULL,
        has_conflicts INTEGER NOT NULL,
        conflict_count INTEGER NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL,
        engine TEXT NOT NULL,
        strategy TEXT NOT NULL,
        git_version TEXT NOT NULL,
        base_hash TEXT NOT NULL,
        local_hash TEXT NOT NULL,
        cloud_hash TEXT NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_merge_cache_last_used
      ON merge_cache (last_used_at);
      CREATE TABLE IF NOT EXISTS conflict_resolution_cache (
        fingerprint TEXT PRIMARY KEY,
        resolved_content TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        last_used_at INTEGER NOT NULL,
        hit_count INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_conflict_resolution_last_used
      ON conflict_resolution_cache (last_used_at);
      CREATE TABLE IF NOT EXISTS sync_history (
        project_id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        last_sync_at INTEGER,
        cloud_paths_json TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
    `)
    syncReplicaDb = db
    return syncReplicaDb
  } catch (error) {
    syncReplicaDbInitFailed = true
    console.warn('[Sync] Failed to initialize SQLite replica journal, falling back to JSON:', error)
    return null
  }
}

function normalizeReplicaRecord(value: Partial<ReplicaStateRecord> | null | undefined): ReplicaStateRecord {
  const replica = value ?? {}
  return {
    replicaHead: Number(replica.replicaHead) || 0,
    pendingOps: Number(replica.pendingOps) || 0,
    lastAckedAt: typeof replica.lastAckedAt === 'number' ? replica.lastAckedAt : null,
    ackedOps: Array.isArray(replica.ackedOps)
      ? replica.ackedOps
          .filter((entry) => typeof entry === 'string' && entry.length > 0)
          .slice(-MAX_ACKED_KEYS)
      : [],
    pathHeads: replica.pathHeads && typeof replica.pathHeads === 'object'
      ? Object.fromEntries(
          Object.entries(replica.pathHeads).filter(
            ([filePath, hash]) => typeof filePath === 'string' && typeof hash === 'string'
          )
        )
      : {},
    lastStateVector:
      typeof replica.lastStateVector === 'number'
        ? replica.lastStateVector
        : Number(replica.replicaHead) || 0,
    lastPersistedAt: typeof replica.lastPersistedAt === 'number' ? replica.lastPersistedAt : null,
  }
}

function loadSyncStateFromSqlite(): boolean {
  const db = getSyncReplicaDb()
  if (!db) return false

  try {
    const replicaRows = db.prepare(`
      SELECT
        project_id,
        replica_head,
        pending_ops,
        last_acked_at,
        acked_ops_json,
        path_heads_json,
        last_state_vector,
        last_persisted_at
      FROM replica_state
    `).all() as Array<{
      project_id: string
      replica_head: number
      pending_ops: number
      last_acked_at: number | null
      acked_ops_json: string
      path_heads_json: string
      last_state_vector: number
      last_persisted_at: number | null
    }>

    for (const row of replicaRows) {
      let ackedOps: string[] = []
      let pathHeads: Record<string, string> = {}
      try {
        const parsedAcked = JSON.parse(row.acked_ops_json)
        if (Array.isArray(parsedAcked)) {
          ackedOps = parsedAcked.filter((entry): entry is string => typeof entry === 'string')
        }
      } catch {
        ackedOps = []
      }

      try {
        const parsedHeads = JSON.parse(row.path_heads_json)
        if (parsedHeads && typeof parsedHeads === 'object') {
          pathHeads = Object.fromEntries(
            Object.entries(parsedHeads as Record<string, unknown>).filter(
              ([filePath, hash]) => typeof filePath === 'string' && typeof hash === 'string'
            )
          )
        }
      } catch {
        pathHeads = {}
      }

      replicaStateByProject.set(
        row.project_id,
        normalizeReplicaRecord({
          replicaHead: row.replica_head,
          pendingOps: row.pending_ops,
          lastAckedAt: row.last_acked_at,
          ackedOps,
          pathHeads,
          lastStateVector: row.last_state_vector,
          lastPersistedAt: row.last_persisted_at,
        })
      )
    }

    const opRows = db.prepare(`
      SELECT
        project_id,
        op_id,
        idempotency_key,
        actor_id,
        actor_type,
        source,
        kind,
        path,
        base_hash,
        new_hash,
        is_binary,
        size,
        timestamp
      FROM pending_ops
      ORDER BY project_id ASC, timestamp ASC, op_id ASC
    `).all() as Array<{
      project_id: string
      op_id: string
      idempotency_key: string
      actor_id: string
      actor_type: 'user' | 'agent' | 'system'
      source: 'monaco' | 'agent' | 'watcher' | 'remote'
      kind: 'upsert' | 'delete' | 'rename' | 'chmod' | 'yjs_update'
      path: string
      base_hash: string | null
      new_hash: string | null
      is_binary: number
      size: number
      timestamp: number
    }>

    for (const row of opRows) {
      const normalizedProjectId = String(row.project_id)
      const normalized = normalizeSyncOp(normalizedProjectId, {
        opId: row.op_id,
        idempotencyKey: row.idempotency_key,
        projectId: normalizedProjectId,
        actorId: row.actor_id,
        actorType: row.actor_type,
        source: row.source,
        kind: row.kind,
        path: row.path,
        baseHash: row.base_hash ?? undefined,
        newHash: row.new_hash ?? undefined,
        isBinary: Boolean(row.is_binary),
        size: row.size,
        timestamp: row.timestamp,
      })
      if (!normalized) continue
      const queue = queuedOpsByProject.get(normalizedProjectId) ?? []
      queue.push(normalized)
      queuedOpsByProject.set(normalizedProjectId, queue)
    }

    for (const [projectId, queue] of queuedOpsByProject.entries()) {
      const replica = getReplicaStateRecord(projectId)
      replica.pendingOps = queue.length
      replica.lastStateVector = replica.replicaHead - replica.pendingOps
      replicaStateByProject.set(projectId, replica)
    }

    return replicaRows.length > 0 || opRows.length > 0
  } catch (error) {
    console.warn('[Sync] Failed to load sync replica state from SQLite:', error)
    return false
  }
}

function loadSyncStateFromJson(): boolean {
  try {
    const statePath = getSyncStatePath()
    if (!fs.existsSync(statePath)) return false
    const parsed = JSON.parse(fs.readFileSync(statePath, 'utf-8')) as {
      replicas?: Record<string, ReplicaStateRecord>
      queues?: Record<string, SyncOpRecord[]>
    }

    const replicas = parsed.replicas ?? {}
    const queues = parsed.queues ?? {}
    for (const [projectId, replica] of Object.entries(replicas)) {
      replicaStateByProject.set(projectId, normalizeReplicaRecord(replica))
    }
    for (const [projectId, ops] of Object.entries(queues)) {
      if (!Array.isArray(ops)) {
        queuedOpsByProject.set(projectId, [])
        continue
      }
      const normalizedOps = ops
        .map((op) => normalizeSyncOp(projectId, op))
        .filter((op): op is SyncOpRecord => op !== null)
      queuedOpsByProject.set(projectId, normalizedOps)
      const replica = getReplicaStateRecord(projectId)
      replica.pendingOps = normalizedOps.length
      replica.lastStateVector = replica.replicaHead - replica.pendingOps
      replicaStateByProject.set(projectId, replica)
    }
    return Object.keys(replicas).length > 0 || Object.keys(queues).length > 0
  } catch (error) {
    console.warn('[Sync] Failed to load sync replica state from JSON:', error)
    return false
  }
}

function persistSyncStateToJson(): void {
  try {
    const statePath = getSyncStatePath()
    const replicas = Object.fromEntries(replicaStateByProject.entries())
    const queues = Object.fromEntries(queuedOpsByProject.entries())
    fs.writeFileSync(statePath, JSON.stringify({ replicas, queues }, null, 2), 'utf-8')
  } catch (error) {
    console.warn('[Sync] Failed to persist sync replica state to JSON:', error)
  }
}

function persistProjectSyncStateToSqlite(projectId: string): boolean {
  const db = getSyncReplicaDb()
  if (!db) return false

  try {
    const normalizedProjectId = String(projectId)
    const replica = getReplicaStateRecord(normalizedProjectId)
    const queue = queuedOpsByProject.get(normalizedProjectId) ?? []
    replica.pendingOps = queue.length
    replica.lastStateVector = replica.replicaHead - replica.pendingOps
    replica.lastPersistedAt = Date.now()
    replicaStateByProject.set(normalizedProjectId, replica)

    db.exec('BEGIN IMMEDIATE')
    db.prepare(`
      INSERT INTO replica_state (
        project_id,
        replica_head,
        pending_ops,
        last_acked_at,
        acked_ops_json,
        path_heads_json,
        last_state_vector,
        last_persisted_at
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        replica_head = excluded.replica_head,
        pending_ops = excluded.pending_ops,
        last_acked_at = excluded.last_acked_at,
        acked_ops_json = excluded.acked_ops_json,
        path_heads_json = excluded.path_heads_json,
        last_state_vector = excluded.last_state_vector,
        last_persisted_at = excluded.last_persisted_at
    `).run(
      normalizedProjectId,
      replica.replicaHead,
      replica.pendingOps,
      replica.lastAckedAt,
      JSON.stringify(replica.ackedOps.slice(-MAX_ACKED_KEYS)),
      JSON.stringify(replica.pathHeads),
      replica.lastStateVector,
      replica.lastPersistedAt
    )

    db.prepare(`DELETE FROM pending_ops WHERE project_id = ?`).run(normalizedProjectId)
    const insertPending = db.prepare(`
      INSERT INTO pending_ops (
        project_id,
        op_id,
        idempotency_key,
        actor_id,
        actor_type,
        source,
        kind,
        path,
        base_hash,
        new_hash,
        is_binary,
        size,
        timestamp
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `)

    for (const op of queue) {
      insertPending.run(
        normalizedProjectId,
        op.opId,
        op.idempotencyKey,
        op.actorId,
        op.actorType,
        op.source,
        op.kind,
        op.path,
        op.baseHash ?? null,
        op.newHash ?? null,
        op.isBinary ? 1 : 0,
        op.size,
        op.timestamp
      )
    }

    db.exec('COMMIT')
    return true
  } catch (error) {
    try {
      const db = getSyncReplicaDb()
      if (db) db.exec('ROLLBACK')
    } catch {
      // ignore rollback errors
    }
    console.warn(`[Sync] Failed to persist sync replica state to SQLite for ${projectId}:`, error)
    return false
  }
}

export function loadSyncState(): void {
  replicaStateByProject.clear()
  queuedOpsByProject.clear()

  const loadedFromSqlite = loadSyncStateFromSqlite()
  if (loadedFromSqlite) return

  const loadedFromJson = loadSyncStateFromJson()
  if (loadedFromJson) {
    // One-time migration path for older JSON-only state.
    persistSyncState()
  }
}

function persistSyncState(): void {
  const projectIds = Array.from(
    new Set<string>([
      ...replicaStateByProject.keys(),
      ...queuedOpsByProject.keys(),
    ])
  )

  for (const projectId of projectIds) {
    persistProjectSyncStateToSqlite(projectId)
  }

  // Keep JSON mirror as a compatibility and recovery fallback.
  persistSyncStateToJson()
}

export function getSyncHistory(projectId: string): SyncHistoryPayload {
  const normalizedProjectId = String(projectId)
  const db = getSyncReplicaDb()
  if (!db) {
    return {
      projectId: normalizedProjectId,
      lastSyncAt: null,
      cloudPaths: [],
      version: 1,
      updatedAt: 0,
      corrupted: false,
    }
  }

  try {
    const row = db.prepare(`
      SELECT
        project_id,
        version,
        last_sync_at,
        cloud_paths_json,
        updated_at
      FROM sync_history
      WHERE project_id = ?
    `).get(normalizedProjectId) as
      | {
          project_id: string
          version: number
          last_sync_at: number | null
          cloud_paths_json: string
          updated_at: number
        }
      | undefined

    if (!row) {
      return {
        projectId: normalizedProjectId,
        lastSyncAt: null,
        cloudPaths: [],
        version: 1,
        updatedAt: 0,
        corrupted: false,
      }
    }

    try {
      const parsed = JSON.parse(row.cloud_paths_json)
      const cloudPaths = Array.isArray(parsed)
        ? normalizeSyncHistoryPaths(
            parsed.filter((entry): entry is string => typeof entry === 'string')
          )
        : []
      return {
        projectId: row.project_id,
        version: Number(row.version) || 1,
        lastSyncAt: typeof row.last_sync_at === 'number' ? row.last_sync_at : null,
        cloudPaths,
        updatedAt: Number(row.updated_at) || 0,
        corrupted: false,
      }
    } catch {
      return {
        projectId: row.project_id,
        version: Number(row.version) || 1,
        lastSyncAt: typeof row.last_sync_at === 'number' ? row.last_sync_at : null,
        cloudPaths: [],
        updatedAt: Number(row.updated_at) || 0,
        corrupted: true,
      }
    }
  } catch (error) {
    console.warn('[Sync] Failed to load sync history:', error)
    return {
      projectId: normalizedProjectId,
      lastSyncAt: null,
      cloudPaths: [],
      version: 1,
      updatedAt: 0,
      corrupted: true,
    }
  }
}

export function setSyncHistory(projectId: string, history: {
  lastSyncAt: number
  cloudPaths: string[]
}): SyncHistoryPayload {
  const normalizedProjectId = String(projectId)
  const normalizedPaths = normalizeSyncHistoryPaths(history.cloudPaths)
  const now = Date.now()
  const payload: SyncHistoryPayload = {
    projectId: normalizedProjectId,
    lastSyncAt: Number(history.lastSyncAt) || now,
    cloudPaths: normalizedPaths,
    version: 1,
    updatedAt: now,
    corrupted: false,
  }
  const db = getSyncReplicaDb()
  if (!db) {
    return payload
  }

  try {
    db.prepare(`
      INSERT INTO sync_history (
        project_id,
        version,
        last_sync_at,
        cloud_paths_json,
        updated_at
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(project_id) DO UPDATE SET
        version = excluded.version,
        last_sync_at = excluded.last_sync_at,
        cloud_paths_json = excluded.cloud_paths_json,
        updated_at = excluded.updated_at
    `).run(
      payload.projectId,
      payload.version,
      payload.lastSyncAt,
      JSON.stringify(payload.cloudPaths),
      payload.updatedAt
    )
  } catch (error) {
    console.warn('[Sync] Failed to persist sync history:', error)
    return {
      ...payload,
      corrupted: true,
    }
  }

  return payload
}

export function mergeCacheGet(key: string): MergeCacheRecordPayload | null {
  const db = getSyncReplicaDb()
  if (!db || !key) return null
  try {
    const row = db.prepare(`
      SELECT
        cache_key,
        merged_content,
        has_conflicts,
        conflict_count,
        created_at,
        last_used_at,
        hit_count,
        engine,
        strategy,
        git_version,
        base_hash,
        local_hash,
        cloud_hash
      FROM merge_cache
      WHERE cache_key = ?
    `).get(key) as
      | {
          cache_key: string
          merged_content: string
          has_conflicts: number
          conflict_count: number
          created_at: number
          last_used_at: number
          hit_count: number
          engine: 'git-merge-file'
          strategy: 'zdiff3' | 'diff3'
          git_version: string
          base_hash: string
          local_hash: string
          cloud_hash: string
        }
      | undefined
    if (!row) return null
    return {
      key: row.cache_key,
      mergedContent: row.merged_content,
      hasConflicts: Boolean(row.has_conflicts),
      conflictCount: Number(row.conflict_count) || 0,
      createdAt: Number(row.created_at) || Date.now(),
      lastUsedAt: Number(row.last_used_at) || Date.now(),
      hitCount: Number(row.hit_count) || 0,
      engine: row.engine,
      strategy: row.strategy,
      gitVersion: row.git_version,
      baseHash: row.base_hash,
      localHash: row.local_hash,
      cloudHash: row.cloud_hash,
    }
  } catch (error) {
    console.warn('[Sync] Failed to read merge cache entry:', error)
    return null
  }
}

export function mergeCacheSet(record: MergeCacheRecordPayload): boolean {
  const db = getSyncReplicaDb()
  if (!db) return false
  try {
    db.prepare(`
      INSERT INTO merge_cache (
        cache_key,
        merged_content,
        has_conflicts,
        conflict_count,
        created_at,
        last_used_at,
        hit_count,
        engine,
        strategy,
        git_version,
        base_hash,
        local_hash,
        cloud_hash
      )
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(cache_key) DO UPDATE SET
        merged_content = excluded.merged_content,
        has_conflicts = excluded.has_conflicts,
        conflict_count = excluded.conflict_count,
        created_at = excluded.created_at,
        last_used_at = excluded.last_used_at,
        hit_count = excluded.hit_count,
        engine = excluded.engine,
        strategy = excluded.strategy,
        git_version = excluded.git_version,
        base_hash = excluded.base_hash,
        local_hash = excluded.local_hash,
        cloud_hash = excluded.cloud_hash
    `).run(
      record.key,
      record.mergedContent,
      record.hasConflicts ? 1 : 0,
      Math.max(0, record.conflictCount),
      record.createdAt,
      record.lastUsedAt,
      Math.max(0, record.hitCount),
      record.engine,
      record.strategy,
      record.gitVersion,
      record.baseHash,
      record.localHash,
      record.cloudHash
    )
    return true
  } catch (error) {
    console.warn('[Sync] Failed to persist merge cache entry:', error)
    return false
  }
}

export function mergeCacheDelete(key: string): boolean {
  const db = getSyncReplicaDb()
  if (!db) return false
  try {
    db.prepare(`DELETE FROM merge_cache WHERE cache_key = ?`).run(key)
    return true
  } catch (error) {
    console.warn('[Sync] Failed to delete merge cache entry:', error)
    return false
  }
}

export function mergeCacheGetResolvedConflict(fingerprint: string): ConflictResolutionPayload | null {
  const db = getSyncReplicaDb()
  if (!db || !fingerprint) return null
  try {
    const row = db.prepare(`
      SELECT
        fingerprint,
        resolved_content,
        created_at,
        last_used_at,
        hit_count
      FROM conflict_resolution_cache
      WHERE fingerprint = ?
    `).get(fingerprint) as
      | {
          fingerprint: string
          resolved_content: string
          created_at: number
          last_used_at: number
          hit_count: number
        }
      | undefined
    if (!row) return null
    return {
      fingerprint: row.fingerprint,
      resolvedContent: row.resolved_content,
      createdAt: Number(row.created_at) || Date.now(),
      lastUsedAt: Number(row.last_used_at) || Date.now(),
      hitCount: Number(row.hit_count) || 0,
    }
  } catch (error) {
    console.warn('[Sync] Failed to read conflict resolution cache entry:', error)
    return null
  }
}

export function mergeCacheSaveResolvedConflict(record: ConflictResolutionPayload): boolean {
  const db = getSyncReplicaDb()
  if (!db) return false
  try {
    db.prepare(`
      INSERT INTO conflict_resolution_cache (
        fingerprint,
        resolved_content,
        created_at,
        last_used_at,
        hit_count
      )
      VALUES (?, ?, ?, ?, ?)
      ON CONFLICT(fingerprint) DO UPDATE SET
        resolved_content = excluded.resolved_content,
        created_at = excluded.created_at,
        last_used_at = excluded.last_used_at,
        hit_count = excluded.hit_count
    `).run(
      record.fingerprint,
      record.resolvedContent,
      record.createdAt,
      record.lastUsedAt,
      Math.max(0, record.hitCount)
    )
    return true
  } catch (error) {
    console.warn('[Sync] Failed to persist conflict resolution cache entry:', error)
    return false
  }
}

export function mergeCachePrune(threshold: number, maxEntries?: number): { removed: number } {
  const db = getSyncReplicaDb()
  if (!db) return { removed: 0 }
  let removed = 0
  try {
    const stale = db.prepare(`DELETE FROM merge_cache WHERE created_at < ?`).run(threshold)
    removed += Number(stale.changes) || 0

    if (typeof maxEntries === 'number' && maxEntries > 0) {
      const countRow = db.prepare(`SELECT COUNT(*) as count FROM merge_cache`).get() as { count: number }
      const count = Number(countRow?.count) || 0
      if (count > maxEntries) {
        const overflow = count - maxEntries
        const overflowDelete = db.prepare(`
          DELETE FROM merge_cache
          WHERE cache_key IN (
            SELECT cache_key
            FROM merge_cache
            ORDER BY last_used_at ASC
            LIMIT ?
          )
        `).run(overflow)
        removed += Number(overflowDelete.changes) || 0
      }
    }

    return { removed }
  } catch (error) {
    console.warn('[Sync] Failed to prune merge cache:', error)
    return { removed }
  }
}
