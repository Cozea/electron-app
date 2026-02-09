import { app, BrowserWindow, shell, ipcMain, dialog, Menu, clipboard, nativeTheme, type WebFrameMain } from 'electron'
import windowStateKeeper from 'electron-window-state'
import { fileURLToPath } from 'node:url'
import path from 'node:path'
import fs from 'node:fs' // Used by DevServer logic
import { createHash, randomUUID } from 'node:crypto'
import { exec } from 'node:child_process'
import { DatabaseSync } from 'node:sqlite'
import { promisify } from 'node:util'
import { performance } from 'node:perf_hooks'
import { cancelToolRuns, runTool } from './tools'
import { autoUpdater } from 'electron-updater'
import { BRIDGE_SCRIPT } from '../shared/previewBridgeScript'
import * as pty from 'node-pty' // Still used for DevServer PTY
import { resolvePathWithinDirectory } from './pathUtils'
import { notifyFileChanged, notifyFileDeleted, notifyFileMetaChanged } from './yjsNotify'
import { markInternalFsChange, startProjectWatcher, stopProjectWatcher } from './projectWatcher'
import { createApplicationMenu } from './menu'
import { getManifestFromWorker, getManifestFromWorkerIncremental } from './workers/fileOpsManager'
import {
  loadManifestCache,
  saveManifestCache,
  consumeManifestDirtyPaths,
} from './services/manifestCache'
import {
  getGitRuntimeHealth,
  mergeTextWithGit,
  mergeTreeWithGit,
  runGitCommand as runGitRuntimeCommand,
} from './gitRuntime'

// Services
import { AuthService } from './services/AuthService'
import { TerminalService } from './services/TerminalService'
import { IntegrationService } from './services/IntegrationService'
import { DatabaseService } from './services/DatabaseService'
import { PerformanceService, type PerfBatch } from './services/PerformanceService'
import { DiagnosticsService } from './services/DiagnosticsService'
import { DependenciesService } from './services/DependenciesService'

function sha256Hex(content: Buffer | Uint8Array): string {
  return createHash('sha256').update(content).digest('hex')
}

// Dev server process management
// Maps projectPath to running PTY instance for proper terminal emulation
const devServerProcesses = new Map<string, pty.IPty>()
const localManifestRequests = new Map<
  string,
  Promise<{
    manifest: Array<{ path: string; hash: string; size: number; mtime: number }>
    totalFiles: number
  }>
>()

interface ReplicaStateRecord {
  replicaHead: number
  pendingOps: number
  lastAckedAt: number | null
  ackedOps: string[]
  pathHeads: Record<string, string>
  lastStateVector: number
  lastPersistedAt: number | null
}

interface SyncOpRecord {
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

interface MergeCacheRecordPayload {
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

interface ConflictResolutionPayload {
  fingerprint: string
  resolvedContent: string
  createdAt: number
  lastUsedAt: number
  hitCount: number
}

interface SyncHistoryPayload {
  projectId: string
  lastSyncAt: number | null
  cloudPaths: string[]
  version: number
  updatedAt: number
  corrupted: boolean
}

const replicaStateByProject = new Map<string, ReplicaStateRecord>()
const queuedOpsByProject = new Map<string, SyncOpRecord[]>()
const MAX_ACKED_KEYS = 4_000
const MAX_PENDING_OPS_PER_PROJECT = 50_000

function normalizeSyncPath(input: string): string {
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

function enqueueSyncOps(projectId: string, incomingOps: SyncOpRecord[]): {
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

function acknowledgeSyncOps(projectId: string, opIds: string[]): {
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

function loadSyncState(): void {
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

function getSyncHistory(projectId: string): SyncHistoryPayload {
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

function setSyncHistory(projectId: string, history: {
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

function mergeCacheGet(key: string): MergeCacheRecordPayload | null {
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

function mergeCacheSet(record: MergeCacheRecordPayload): boolean {
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

function mergeCacheDelete(key: string): boolean {
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

function mergeCacheGetResolvedConflict(fingerprint: string): ConflictResolutionPayload | null {
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

function mergeCacheSaveResolvedConflict(record: ConflictResolutionPayload): boolean {
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

function mergeCachePrune(threshold: number, maxEntries?: number): { removed: number } {
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

// ============================================
// Terminal Management (VS Code-style multi-terminal)
// ============================================
// Logic moved to TerminalService

const execAsync = promisify(exec)
const mainStart = performance.now()

const __dirname = path.dirname(fileURLToPath(import.meta.url))

process.env.APP_ROOT = path.join(__dirname, '..')

// Dev server URL from electron-vite (ELECTRON_RENDERER_URL) or legacy var
export const VITE_DEV_SERVER_URL =
  process.env['VITE_DEV_SERVER_URL'] || process.env['ELECTRON_RENDERER_URL']

export const MAIN_DIST = path.join(process.env.APP_ROOT, 'out/main')
export const RENDERER_DIST = path.join(process.env.APP_ROOT, 'out/renderer')

process.env.VITE_PUBLIC = VITE_DEV_SERVER_URL ? path.join(process.env.APP_ROOT, 'public') : RENDERER_DIST

const DEFAULT_PROTOCOL = VITE_DEV_SERVER_URL ? 'cozea-dev' : 'cozea'
const PROTOCOL = process.env.COZEA_PROTOCOL || DEFAULT_PROTOCOL
const LEGACY_PROTOCOL = 'cozea'
const SUPPORTED_PROTOCOLS = PROTOCOL === LEGACY_PROTOCOL ? [PROTOCOL] : [PROTOCOL, LEGACY_PROTOCOL]

function matchesProtocolUrl(url: string, routePrefix: string): boolean {
  return SUPPORTED_PROTOCOLS.some((scheme) => url.startsWith(`${scheme}://${routePrefix}`))
}

function findProtocolArg(commandLine: string[]): string | undefined {
  return commandLine.find((arg) => SUPPORTED_PROTOCOLS.some((scheme) => arg.startsWith(`${scheme}://`)))
}

// Default settings
interface AppSettings {
  projectsDirectory: string
}

// Lazy-loaded paths (app.getPath not available at module load time in ESM)
let _settingsPath: string | null = null
let _defaultSettings: AppSettings | null = null

function getSettingsPath(): string {
  if (!_settingsPath) _settingsPath = path.join(app.getPath('userData'), 'settings.json')
  return _settingsPath
}

function getDefaultSettings(): AppSettings {
  if (!_defaultSettings) {
    _defaultSettings = {
      projectsDirectory: path.join(app.getPath('home'), 'Developer', 'Cozea'),
    }
  }
  return _defaultSettings
}

function loadSettings(): AppSettings {
  try {
    if (fs.existsSync(getSettingsPath())) {
      const data = fs.readFileSync(getSettingsPath(), 'utf-8')
      return { ...getDefaultSettings(), ...JSON.parse(data) }
    }
  } catch (err) {
    console.error('Failed to load settings:', err)
  }
  return getDefaultSettings()
}

function saveSettings(settings: Partial<AppSettings>): void {
  try {
    const current = loadSettings()
    const updated = { ...current, ...settings }
    fs.writeFileSync(getSettingsPath(), JSON.stringify(updated, null, 2))
  } catch (err) {
    console.error('Failed to save settings:', err)
  }
}

let win: InstanceType<typeof BrowserWindow> | null
const performanceService = PerformanceService.getInstance()

type UpdateStatus =
  | 'idle'
  | 'checking'
  | 'available'
  | 'downloading'
  | 'downloaded'
  | 'not-available'
  | 'error'

interface UpdateProgress {
  percent: number
  transferred: number
  total: number
  bytesPerSecond: number
}

interface UpdateState {
  status: UpdateStatus
  version?: string
  releaseName?: string
  releaseNotes?: string
  progress?: UpdateProgress
  error?: string
}

const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000
let updateState: UpdateState = { status: 'idle' }
let updateInterval: NodeJS.Timeout | null = null

const isAutoUpdateEnabled = () => app.isPackaged

function broadcastUpdateState(state: UpdateState): void {
  BrowserWindow.getAllWindows().forEach((window) => {
    window.webContents.send('updates:status', state)
  })
}

function setUpdateState(next: Partial<UpdateState>): void {
  updateState = { ...updateState, ...next }
  broadcastUpdateState(updateState)
}

function normalizeReleaseNotes(releaseNotes: unknown): string | undefined {
  if (!releaseNotes) return undefined
  if (typeof releaseNotes === 'string') return releaseNotes
  if (Array.isArray(releaseNotes)) {
    return releaseNotes
      .map((note) => {
        if (typeof note === 'string') return note
        if (note && typeof note === 'object' && 'note' in note) {
          return String((note as { note?: unknown }).note ?? '')
        }
        return ''
      })
      .filter(Boolean)
      .join('\n\n')
  }
  return String(releaseNotes)
}

function registerAutoUpdater(): void {
  if (!isAutoUpdateEnabled()) return

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true

  autoUpdater.on('checking-for-update', () => {
    setUpdateState({ status: 'checking', error: undefined })
  })

  autoUpdater.on('update-available', (info) => {
    setUpdateState({
      status: 'available',
      version: info?.version,
      releaseName: info?.releaseName,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      error: undefined,
    })
  })

  autoUpdater.on('update-not-available', () => {
    setUpdateState({ status: 'not-available', error: undefined, progress: undefined })
  })

  autoUpdater.on('download-progress', (progress) => {
    setUpdateState({
      status: 'downloading',
      progress: {
        percent: progress.percent,
        transferred: progress.transferred,
        total: progress.total,
        bytesPerSecond: progress.bytesPerSecond,
      },
      error: undefined,
    })
  })

  autoUpdater.on('update-downloaded', (info) => {
    setUpdateState({
      status: 'downloaded',
      version: info?.version,
      releaseName: info?.releaseName,
      releaseNotes: normalizeReleaseNotes(info?.releaseNotes),
      error: undefined,
      progress: undefined,
    })
  })

  autoUpdater.on('error', (err) => {
    setUpdateState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  })
}

async function checkForUpdates(): Promise<void> {
  if (!isAutoUpdateEnabled()) return
  try {
    await autoUpdater.checkForUpdates()
  } catch (err) {
    setUpdateState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

function startUpdateChecks(): void {
  if (!isAutoUpdateEnabled()) return
  void checkForUpdates()
  updateInterval = setInterval(() => {
    void checkForUpdates()
  }, UPDATE_CHECK_INTERVAL_MS)
}

function stopUpdateChecks(): void {
  if (updateInterval) {
    clearInterval(updateInterval)
    updateInterval = null
  }
}

// Session management logic moved to AuthService

// Handle billing callback (success/cancel from Stripe)
function handleBillingCallback(url: string): void {
  const urlObj = new URL(url)
  const urlPath = urlObj.pathname // '/success' or '/canceled'
  const type = urlObj.searchParams.get('type') // 'subscription' or 'credits'

  // Focus the window
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()

    // Navigate to billing page with appropriate query params
    const isSuccess = urlPath === '/success' || urlPath === '//success'
    const isCanceled = urlPath === '/canceled' || urlPath === '//canceled'

    let queryString = ''
    if (isSuccess) {
      queryString = `?success=${type || 'true'}`
    } else if (isCanceled) {
      queryString = '?canceled=true'
    }

    if (queryString) {
      if (VITE_DEV_SERVER_URL) {
        win.loadURL(`${VITE_DEV_SERVER_URL}/workspace/billing${queryString}`)
      } else {
        // For production, load index.html - the SPA will handle routing
        win.loadFile(path.join(RENDERER_DIST, 'index.html'))
        // Send a message to navigate after the page loads
        win.webContents.once('did-finish-load', () => {
          win?.webContents.send('navigate', `/workspace/billing${queryString}`)
        })
      }
    }
  }
}

// Handle custom protocol callback
async function handleAuthCallback(url: string): Promise<void> {
  await AuthService.getInstance().handleAuthCallback(url, win)
}

// Register custom protocol
if (process.defaultApp) {
  if (process.argv.length >= 2) {
    app.setAsDefaultProtocolClient(PROTOCOL, process.execPath, [path.resolve(process.argv[1])])
  }
} else {
  app.setAsDefaultProtocolClient(PROTOCOL)
}

// Handle protocol on macOS
app.on('open-url', async (event, url) => {
  event.preventDefault()
  if (matchesProtocolUrl(url, 'auth/callback')) {
    handleAuthCallback(url)
  } else if (matchesProtocolUrl(url, 'billing/')) {
    handleBillingCallback(url)
  } else if (matchesProtocolUrl(url, 'oauth/callback')) {
    // Handle integration OAuth callback
    try {
      await IntegrationService.getInstance().handleOAuthCallback(url)
      // Success handled by Service via win.webContents if needed, 
      // but wait, Service assumes it returns a result?
      // Let's check Service implementation. 
      // Service.handleOAuthCallback calls oauthHandler.handleOAuthCallback which returns Promise<Result>.
      // Service just returns that promise.
      // So main.ts needs to handle the response broadcasting.

      const result = await IntegrationService.getInstance().handleOAuthCallback(url)
      if (result.success) {
        win?.webContents.send('integrations:oauthSuccess', result)
      } else {
        win?.webContents.send('integrations:oauthError', { provider: result.provider, error: result.error || 'OAuth failed' })
      }
    } catch (err) {
      console.error('[OAuth] Callback handling error:', err)
      win?.webContents.send('integrations:oauthError', {
        provider: 'unknown',
        error: err instanceof Error ? err.message : 'OAuth callback failed',
      })
    }
  }

  // Focus the window
  if (win) {
    if (win.isMinimized()) win.restore()
    win.focus()
  }
})


// Handle protocol on Windows/Linux (single instance)
const gotTheLock = app.requestSingleInstanceLock()

if (!gotTheLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, commandLine) => {
    // Someone tried to run a second instance, focus the window
    if (win) {
      if (win.isMinimized()) win.restore()
      win.focus()
    }

    // Handle protocol URL on Windows/Linux
    const url = findProtocolArg(commandLine)
    if (url) {
      if (matchesProtocolUrl(url, 'auth/callback')) {
        handleAuthCallback(url)
      } else if (matchesProtocolUrl(url, 'billing/')) {
        handleBillingCallback(url)
      } else if (matchesProtocolUrl(url, 'oauth/callback')) {
        // Handle integration OAuth callback
        IntegrationService.getInstance().handleOAuthCallback(url)
          .then((result) => {
            if (result.success) {
              win?.webContents.send('integrations:oauthSuccess', result)
            } else {
              win?.webContents.send('integrations:oauthError', { provider: result.provider, error: result.error || 'OAuth failed' })
            }
          })
          .catch((err) => {
            console.error('[OAuth] Callback handling error:', err)
            win?.webContents.send('integrations:oauthError', {
              provider: 'unknown',
              error: err instanceof Error ? err.message : 'OAuth callback failed',
            })
          })
      }
    }
  })
}

function createWindow() {
  const isMac = process.platform === 'darwin'
  const isWindows = process.platform === 'win32'
  const themedOpaqueBackground = nativeTheme.shouldUseDarkColors ? '#101014' : '#f7f7f8'

  // Load window state
  const mainWindowState = windowStateKeeper({
    defaultWidth: 1200,
    defaultHeight: 800,
  })

  win = new BrowserWindow({
    x: mainWindowState.x,
    y: mainWindowState.y,
    width: mainWindowState.width,
    height: mainWindowState.height,
    show: false, // Hide initially for smooth launch
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      nodeIntegration: false,
      contextIsolation: true,
    },
    // Native material effects:
    // - macOS: transparent window + vibrancy so translucent sidebar can blur behind.
    // - Windows 11: system backdrop material.
    transparent: isMac,
    backgroundColor: isMac ? '#00000000' : themedOpaqueBackground,
    vibrancy: isMac ? 'sidebar' : undefined, // options: 'sidebar' | 'under-window' | 'hud' | 'popover' ...
    visualEffectState: isMac ? 'active' : undefined,
    backgroundMaterial: isWindows ? 'mica' : undefined,
    titleBarStyle: 'hiddenInset',
    trafficLightPosition: { x: 15, y: 10 },
  })

  // Set application menu
  createApplicationMenu()

  // Register window state listeners
  mainWindowState.manage(win)

  // Show window when ready to prevent flickering
  win.once('ready-to-show', () => {
    performanceService.recordMainMetric('window.ready_to_show', performance.now() - mainStart)
    win?.show()
    win?.focus()
  })

  win.webContents.once('did-finish-load', () => {
    performanceService.recordMainMetric('window.did_finish_load', performance.now() - mainStart)
  })

  // Update background color on system theme change
  nativeTheme.on('updated', () => {
    if (!win) return
    if (process.platform === 'darwin') {
      // Keep transparent on macOS so vibrancy remains visible.
      win.setBackgroundColor('#00000000')
      return
    }
    const bgColor = nativeTheme.shouldUseDarkColors ? '#101014' : '#f7f7f8'
    win.setBackgroundColor(bgColor)
  })

  if (VITE_DEV_SERVER_URL) {
    win.loadURL(VITE_DEV_SERVER_URL)
    win.webContents.openDevTools()
  } else {
    win.loadFile(path.join(RENDERER_DIST, 'index.html'))
  }
}

// IPC Handlers
// Register Services
AuthService.getInstance().registerIpcHandlers()
TerminalService.getInstance().registerIpcHandlers()
IntegrationService.getInstance().registerIpcHandlers()
DatabaseService.getInstance().registerIpcHandlers()
DiagnosticsService.getInstance().registerIpcHandlers()
DependenciesService.getInstance().registerIpcHandlers()
performanceService.start()

// Local tool execution (agent runtime)
ipcMain.handle('tools:run', async (_event, request: {
  name: string
  input: Record<string, unknown>
  projectPath?: string
  runId?: string
  toolCallId?: string
}) => {
  return runTool(request)
})

ipcMain.handle('performance:report', async (_event, payload: PerfBatch) => {
  return performanceService.reportRendererBatch(payload)
})

ipcMain.handle('tools:cancel', async (_event, request: { runId: string }) => {
  return cancelToolRuns(request.runId)
})

// Auto-updater IPC handlers
ipcMain.handle('updates:getState', () => updateState)

ipcMain.handle('updates:check', async () => {
  if (!isAutoUpdateEnabled()) return updateState
  await checkForUpdates()
  return updateState
})

ipcMain.handle('updates:download', async () => {
  if (!isAutoUpdateEnabled()) return updateState
  try {
    await autoUpdater.downloadUpdate()
  } catch (err) {
    setUpdateState({
      status: 'error',
      error: err instanceof Error ? err.message : String(err),
    })
  }
  return updateState
})

ipcMain.handle('updates:install', async () => {
  if (!isAutoUpdateEnabled()) {
    return { success: false, error: 'Updates are disabled in development builds.' }
  }
  try {
    autoUpdater.quitAndInstall()
    return { success: true }
  } catch (err) {
    return { success: false, error: err instanceof Error ? err.message : String(err) }
  }
})

// Open URL in system browser
ipcMain.handle('shell:openExternal', async (_event, url: string) => {
  await shell.openExternal(url)
  return { success: true }
})

// Window state handlers
ipcMain.handle('window:isFullScreen', () => {
  return win?.isFullScreen() ?? false
})

interface PreviewInjectBridgeResult {
  success: boolean
  error?: string
}

function isExpectedPreviewConnectivityError(message: string): boolean {
  return (
    message.includes('ERR_CONNECTION_REFUSED') ||
    message.includes('ERR_CONNECTION_RESET') ||
    message.includes('ERR_NETWORK_CHANGED')
  )
}

async function loadUrlForCapture(
  targetWindow: BrowserWindow,
  targetUrl: string,
  timeoutMs: number
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    let settled = false

    const finish = (callback: () => void) => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      targetWindow.webContents.removeListener('did-finish-load', onFinishLoad)
      targetWindow.webContents.removeListener('did-fail-load', onFailLoad)
      callback()
    }

    const onFinishLoad = () => {
      finish(resolve)
    }

    const onFailLoad = (
      _event: Electron.Event,
      errorCode: number,
      errorDescription: string,
      _validatedURL: string,
      isMainFrame: boolean
    ) => {
      if (!isMainFrame) return
      finish(() => reject(new Error(`Failed to load page: ${errorDescription} (${errorCode})`)))
    }

    const timer = setTimeout(() => {
      finish(() => reject(new Error('Page load timeout')))
    }, timeoutMs)

    targetWindow.webContents.on('did-finish-load', onFinishLoad)
    targetWindow.webContents.on('did-fail-load', onFailLoad)

    void targetWindow.loadURL(targetUrl).catch((error: unknown) => {
      const err = error instanceof Error ? error : new Error(String(error))
      finish(() => reject(err))
    })
  })
}

function isAllowedPreviewUrl(url: URL): boolean {
  if (url.protocol !== 'http:' && url.protocol !== 'https:') return false
  return url.hostname === 'localhost' || url.hostname === '127.0.0.1' || url.hostname === '::1'
}

function summarizePreviewFrames(maxFrames = 12): Array<{
  name: string
  url: string
  frameTreeNodeId: number
  routingId: number
}> {
  if (!win) return []
  return win.webContents.mainFrame.frames
    .filter((frame) => frame !== win?.webContents.mainFrame)
    .slice(0, maxFrames)
    .map((frame) => ({
      name: frame.name || '(unnamed)',
      url: frame.url,
      frameTreeNodeId: frame.frameTreeNodeId,
      routingId: frame.routingId,
    }))
}

async function findFrameByUrl(
  targetUrl: string,
  options?: { attempts?: number; delayMs?: number; frameName?: string }
): Promise<WebFrameMain | null> {
  const attempts = options?.attempts ?? 15
  const delayMs = options?.delayMs ?? 50
  const frameName = options?.frameName?.trim() || null

  if (!win) return null

  let targetOrigin: string | null = null
  try {
    targetOrigin = new URL(targetUrl).origin
  } catch {
    targetOrigin = null
  }

  for (let attempt = 0; attempt < attempts; attempt++) {
    const frames = win.webContents.mainFrame.frames.filter((f) => f !== win?.webContents.mainFrame)
    const namedFrames = frameName ? frames.filter((f) => f.name === frameName) : frames
    const candidates = frameName ? namedFrames : frames

    if (frameName && candidates.length === 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs))
      continue
    }

    const exact = candidates.find((f) => f.url === targetUrl)
    if (exact) return exact

    if (targetOrigin) {
      const sameOrigin = candidates.find((f) => {
        try {
          return new URL(f.url).origin === targetOrigin
        } catch {
          return false
        }
      })
      if (sameOrigin) return sameOrigin
    }

    await new Promise((resolve) => setTimeout(resolve, delayMs))
  }

  return null
}

// Inject the preview bridge into the project's dev-server iframe (cross-origin safe via WebFrameMain)
ipcMain.handle(
  'preview:injectBridge',
  async (
    _event,
    { url, frameName }: { url: string; frameName?: string }
  ): Promise<PreviewInjectBridgeResult> => {
    console.log('[PreviewBridge][Main] Injection requested', {
      url,
      frameName: frameName || '(none)',
    })

    if (!win) return { success: false, error: 'No window available' }
    if (!url || typeof url !== 'string') return { success: false, error: 'Missing url' }

    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return { success: false, error: 'Invalid url' }
    }

    if (!isAllowedPreviewUrl(parsedUrl)) {
      return { success: false, error: 'Only localhost preview URLs are supported' }
    }

    // Avoid injecting into the app's own main frame origin.
    try {
      const mainUrl = win.webContents.getURL()
      const mainOrigin = new URL(mainUrl).origin
      if (mainOrigin === parsedUrl.origin) {
        return { success: false, error: 'Refusing to inject into main frame origin' }
      }
    } catch {
      // ignore parse errors (e.g. about:blank during startup)
    }

    const frame = await findFrameByUrl(url, { frameName })
    if (!frame) {
      console.warn('[PreviewBridge][Main] Frame not found for injection', {
        url,
        frameName: frameName || '(none)',
        availableFrames: summarizePreviewFrames(),
      })
      return { success: false, error: 'Preview frame not found' }
    }

    try {
      console.log('[PreviewBridge][Main] Matched frame', {
        requestedUrl: url,
        requestedFrameName: frameName || '(none)',
        matchedFrameName: frame.name || '(unnamed)',
        matchedFrameUrl: frame.url,
        frameTreeNodeId: frame.frameTreeNodeId,
        routingId: frame.routingId,
      })

      // Force-refresh bridge instance so style/script updates apply immediately.
      await frame.executeJavaScript(`
        try {
          window.__COZEA_BRIDGE_LOADED__ = false;
          document.getElementById('cozea-highlight')?.remove();
          document.getElementById('cozea-selected')?.remove();
          document.getElementById('cozea-highlight-label')?.remove();
          document.getElementById('cozea-selected-label')?.remove();
        } catch {}
      `)
      await frame.executeJavaScript(BRIDGE_SCRIPT)
      console.log('[PreviewBridge][Main] Bridge script injected successfully', {
        matchedFrameName: frame.name || '(unnamed)',
        matchedFrameUrl: frame.url,
      })
      return { success: true }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to inject preview bridge'
      console.error('[PreviewBridge][Main] Bridge script injection failed', {
        requestedUrl: url,
        requestedFrameName: frameName || '(none)',
        matchedFrameName: frame.name || '(unnamed)',
        matchedFrameUrl: frame.url,
        error: message,
      })
      return { success: false, error: message }
    }
  }
)

// Capture a screenshot of a URL using a hidden BrowserWindow
ipcMain.handle(
  'preview:captureScreenshot',
  async (
    _event,
    { url, width = 1280, height = 800 }: { url: string; width?: number; height?: number }
  ): Promise<{ success: boolean; base64?: string; error?: string }> => {
    // Validate URL
    let parsedUrl: URL
    try {
      parsedUrl = new URL(url)
    } catch {
      return { success: false, error: 'Invalid URL' }
    }

    // Only allow localhost URLs for security
    if (!isAllowedPreviewUrl(parsedUrl)) {
      return { success: false, error: 'Only localhost URLs are supported' }
    }

    // Create a hidden browser window for capturing
    const captureWindow = new BrowserWindow({
      width,
      height,
      show: false,
      webPreferences: {
        nodeIntegration: false,
        contextIsolation: true,
        offscreen: true,
      },
    })

    try {
      // Load the URL with explicit timeout + listener cleanup to avoid unhandled rejections
      await loadUrlForCapture(captureWindow, url, 30000)

      // Wait a bit for any animations/rendering to complete
      await new Promise((resolve) => setTimeout(resolve, 500))

      // Capture the page
      const image = await captureWindow.webContents.capturePage()
      const base64 = image.toPNG().toString('base64')

      return { success: true, base64 }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Screenshot capture failed'
      if (!isExpectedPreviewConnectivityError(message)) {
        console.error('[Preview] Screenshot capture failed:', err)
      }
      return { success: false, error: message }
    } finally {
      // Always clean up the window
      captureWindow.destroy()
    }
  }
)

// Settings handlers
ipcMain.handle('settings:get', () => {
  return loadSettings()
})

ipcMain.handle('settings:set', (_event, settings: Partial<AppSettings>) => {
  saveSettings(settings)
  return { success: true }
})

// Dialog to select a directory
ipcMain.handle('dialog:selectDirectory', async () => {
  if (!win) return { success: false, error: 'No window available' }

  const result = await dialog.showOpenDialog(win, {
    properties: ['openDirectory', 'createDirectory'],
    title: 'Select Projects Directory',
  })

  if (result.canceled || result.filePaths.length === 0) {
    return { success: false, canceled: true }
  }

  return { success: true, path: result.filePaths[0] }
})

// Storage usage calculation
interface StorageUsage {
  projects: number
  dependencies: number
  buildCache: number
  logs: number
  total: number
  diskTotal: number
  diskFree: number
}

async function getDirectorySize(dirPath: string): Promise<number> {
  try {
    if (!fs.existsSync(dirPath)) return 0

    // Use native du command for fast directory size calculation
    if (process.platform === 'win32') {
      // Windows: use PowerShell
      const { stdout } = await execAsync(
        `powershell -command "(Get-ChildItem -Path '${dirPath}' -Recurse -Force -ErrorAction SilentlyContinue | Measure-Object -Property Length -Sum).Sum"`,
        { timeout: 30000 }
      )
      const size = parseInt(stdout.trim(), 10)
      return isNaN(size) ? 0 : size
    } else {
      // macOS/Linux: use du command (-s for summary, -k for KB)
      const { stdout } = await execAsync(
        `du -sk "${dirPath}" 2>/dev/null || echo "0"`,
        { timeout: 30000 }
      )
      const sizeKB = parseInt(stdout.split('\t')[0], 10)
      return isNaN(sizeKB) ? 0 : sizeKB * 1024 // Convert KB to bytes
    }
  } catch {
    return 0
  }
}

async function getDiskSpace(dirPath: string): Promise<{ total: number; free: number }> {
  try {
    if (process.platform === 'win32') {
      // Windows: use PowerShell to get drive info
      const driveLetter = path.parse(dirPath).root || 'C:\\'
      const { stdout } = await execAsync(
        `powershell -command "Get-PSDrive -Name '${driveLetter[0]}' | Select-Object Used,Free | ConvertTo-Json"`,
        { timeout: 10000 }
      )
      const info = JSON.parse(stdout)
      return {
        total: (info.Used || 0) + (info.Free || 0),
        free: info.Free || 0,
      }
    } else {
      // macOS/Linux: use df command
      const { stdout } = await execAsync(
        `df -k "${dirPath}" 2>/dev/null | tail -1`,
        { timeout: 10000 }
      )
      const parts = stdout.trim().split(/\s+/)
      // df output: Filesystem 1K-blocks Used Available Use% Mounted
      const totalKB = parseInt(parts[1], 10)
      const availableKB = parseInt(parts[3], 10)
      return {
        total: isNaN(totalKB) ? 0 : totalKB * 1024,
        free: isNaN(availableKB) ? 0 : availableKB * 1024,
      }
    }
  } catch {
    return { total: 0, free: 0 }
  }
}

ipcMain.handle('storage:getUsage', async (): Promise<StorageUsage> => {
  const settings = loadSettings()
  const projectsDir = settings.projectsDirectory
  const userDataDir = app.getPath('userData')
  const logsDir = app.getPath('logs')

  // Calculate sizes in parallel
  const [projectsSize, logsSize] = await Promise.all([
    getDirectorySize(projectsDir),
    getDirectorySize(logsDir),
  ])

  // For dependencies, we need to scan node_modules folders within projects
  let dependenciesSize = 0
  let buildCacheSize = 0

  if (fs.existsSync(projectsDir)) {
    try {
      const projects = fs.readdirSync(projectsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())

      const sizes = await Promise.all(
        projects.map(async (project) => {
          const projectPath = path.join(projectsDir, project.name)
          const nodeModulesPath = path.join(projectPath, 'node_modules')
          const distPath = path.join(projectPath, 'dist')
          const buildPath = path.join(projectPath, 'build')
          const nextCachePath = path.join(projectPath, '.next')

          const [nodeModules, dist, build, nextCache] = await Promise.all([
            getDirectorySize(nodeModulesPath),
            getDirectorySize(distPath),
            getDirectorySize(buildPath),
            getDirectorySize(nextCachePath),
          ])

          return {
            dependencies: nodeModules,
            buildCache: dist + build + nextCache,
          }
        })
      )

      for (const size of sizes) {
        dependenciesSize += size.dependencies
        buildCacheSize += size.buildCache
      }
    } catch (err) {
      console.error('Failed to scan project directories:', err)
    }
  }

  // Also check for app-level cache (separate from project build cache)
  const appCachePath = path.join(userDataDir, 'Cache')
  const appCache = await getDirectorySize(appCachePath)

  // Get disk space for the projects directory
  const diskSpace = await getDiskSpace(projectsDir)

  // Calculate actual project files (ensure non-negative)
  const projectFilesSize = Math.max(0, projectsSize - dependenciesSize - buildCacheSize)

  // Total build cache includes both project build artifacts and app cache
  const totalBuildCache = buildCacheSize + appCache

  return {
    projects: projectFilesSize,
    dependencies: dependenciesSize,
    buildCache: totalBuildCache,
    logs: logsSize,
    total: projectFilesSize + dependenciesSize + totalBuildCache + logsSize,
    diskTotal: diskSpace.total,
    diskFree: diskSpace.free,
  }
})

// List local projects with their sizes
interface LocalProject {
  name: string
  path: string
  size: number
  lastModified: number
}

ipcMain.handle('storage:listProjects', async (): Promise<LocalProject[]> => {
  const settings = loadSettings()
  const projectsDir = settings.projectsDirectory

  if (!fs.existsSync(projectsDir)) {
    return []
  }

  try {
    const entries = fs.readdirSync(projectsDir, { withFileTypes: true })
      .filter(d => d.isDirectory() && !d.name.startsWith('.'))

    const projects = await Promise.all(
      entries.map(async (entry) => {
        const projectPath = path.join(projectsDir, entry.name)
        const size = await getDirectorySize(projectPath)

        // Get last modified time
        let lastModified = Date.now()
        try {
          const stats = fs.statSync(projectPath)
          lastModified = stats.mtimeMs
        } catch {
          // Ignore stat errors
        }

        return {
          name: entry.name,
          path: projectPath,
          size,
          lastModified,
        }
      })
    )

    // Sort by last modified (most recent first)
    return projects.sort((a, b) => b.lastModified - a.lastModified)
  } catch (err) {
    console.error('Failed to list projects:', err)
    return []
  }
})

// Project folder management
interface CreateProjectFolderResult {
  success: boolean
  localPath?: string
  error?: string
}

interface CloneRepositoryResult {
  success: boolean
  localPath?: string
  normalizedRepoUrl?: string
  error?: string
}

interface CopyDirectorySnapshotResult {
  success: boolean
  copiedTo?: string
  error?: string
}

function buildGitAuthorizationHeader(provider: string, accessToken?: string): string | null {
  if (!accessToken?.trim()) return null

  const username = provider === 'gitlab' ? 'oauth2' : 'x-access-token'
  const encoded = Buffer.from(`${username}:${accessToken.trim()}`, 'utf8').toString('base64')
  return `AUTHORIZATION: Basic ${encoded}`
}

function normalizeRepositoryUrl(repoUrl: string, provider: string): string | null {
  const trimmed = repoUrl.trim().replace(/\/+$/, '')
  if (!trimmed) return null

  // Allow SSH / git transport URLs as-is.
  if (
    trimmed.startsWith('git@') ||
    trimmed.startsWith('ssh://') ||
    trimmed.startsWith('git://')
  ) {
    return trimmed
  }

  // Allow fully-qualified HTTP(S) URLs as-is.
  if (/^https?:\/\//i.test(trimmed)) {
    return trimmed
  }

  const shorthandMatch = trimmed.match(/^([\w.-]+)\/([\w.-]+)$/)
  if (!shorthandMatch) return null

  const owner = shorthandMatch[1]
  const repo = shorthandMatch[2].replace(/\.git$/i, '')
  const host = provider === 'gitlab' ? 'gitlab.com' : 'github.com'
  return `https://${host}/${owner}/${repo}.git`
}

function runGitCommand(
  args: string[],
  cwd: string
): Promise<{ success: true } | { success: false; error: string }> {
  return runGitRuntimeCommand(args, { cwd }).then((result) => {
    if (result.success) {
      return { success: true }
    }
    return {
      success: false,
      error:
        result.error ||
        result.stderr.trim() ||
        result.stdout.trim() ||
        `git exited with code ${result.exitCode ?? 'unknown'}`,
    }
  })
}

ipcMain.handle(
  'project:createFolder',
  async (
    _event,
    { slug, initGit = true }: { slug: string; initGit?: boolean }
  ): Promise<CreateProjectFolderResult> => {
    const settings = loadSettings()
    const projectsDir = settings.projectsDirectory
    const projectPath = path.join(projectsDir, slug)

    try {
      // Ensure projects directory exists
      if (!fs.existsSync(projectsDir)) {
        fs.mkdirSync(projectsDir, { recursive: true })
      }

      // Check if project folder already exists
      if (fs.existsSync(projectPath)) {
        return {
          success: false,
          error: `Project folder already exists: ${projectPath}`,
        }
      }

      // Create project folder
      fs.mkdirSync(projectPath, { recursive: true })
      console.log(`[Project] Created folder: ${projectPath}`)

      // Initialize git repository if requested
      if (initGit) {
        try {
          const initResult = await runGitCommand(['init'], projectPath)
          if (!initResult.success) {
            throw new Error(initResult.error)
          }
          console.log(`[Project] Initialized git repo: ${projectPath}`)

          // Create initial .gitignore
          const gitignoreContent = `# Dependencies
node_modules/
.pnpm-store/

# Build outputs
dist/
build/
.next/
out/

# Environment
.env
.env.local
.env.*.local

# IDE
.idea/
.vscode/
*.swp
*.swo

# OS
.DS_Store
Thumbs.db

# Logs
*.log
npm-debug.log*

# Cache
.cache/
.turbo/
`
          fs.writeFileSync(path.join(projectPath, '.gitignore'), gitignoreContent)
          console.log(`[Project] Created .gitignore`)
        } catch (gitErr) {
          console.warn(`[Project] Git init failed:`, gitErr)
          return {
            success: false,
            error: gitErr instanceof Error ? gitErr.message : 'Git init failed',
          }
        }
      }

      return {
        success: true,
        localPath: projectPath,
      }
    } catch (err) {
      console.error('[Project] Failed to create folder:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to create project folder',
      }
    }
  }
)

// Clone a repository into the project directory for repo imports.
ipcMain.handle(
  'project:cloneRepository',
  async (
    _event,
    {
      slug,
      repoUrl,
      provider,
      branch,
      accessToken,
    }: {
      slug: string
      repoUrl: string
      provider: string
      branch?: string
      accessToken?: string
    }
  ): Promise<CloneRepositoryResult> => {
    const settings = loadSettings()
    const projectsDir = settings.projectsDirectory
    const targetPath = path.join(projectsDir, slug)
    const normalizedRepoUrl = normalizeRepositoryUrl(repoUrl, provider)

    if (!normalizedRepoUrl) {
      return {
        success: false,
        error: 'Invalid repository URL. Use a full URL or owner/repo format.',
      }
    }

    try {
      if (!fs.existsSync(projectsDir)) {
        fs.mkdirSync(projectsDir, { recursive: true })
      }

      if (fs.existsSync(targetPath)) {
        const existingEntries = fs.readdirSync(targetPath, { withFileTypes: true })
        if (existingEntries.length > 0) {
          return {
            success: false,
            error: `Destination already exists and is not empty: ${targetPath}`,
          }
        }
        fs.rmSync(targetPath, { recursive: true, force: true })
      }

      const cloneArgs: string[] = []
      const authHeader = buildGitAuthorizationHeader(provider, accessToken)

      if (authHeader && /^https?:\/\//i.test(normalizedRepoUrl)) {
        cloneArgs.push('-c', `http.extraheader=${authHeader}`)
      }

      cloneArgs.push('clone', '--single-branch', '--depth', '1')
      if (branch && branch.trim()) {
        cloneArgs.push('--branch', branch.trim())
      }
      cloneArgs.push(normalizedRepoUrl, targetPath)

      const cloneResult = await runGitCommand(cloneArgs, projectsDir)
      if (!cloneResult.success) {
        return {
          success: false,
          error: cloneResult.error,
        }
      }

      return {
        success: true,
        localPath: targetPath,
        normalizedRepoUrl,
      }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to clone repository',
      }
    }
  }
)

// Get local path for a project by slug (returns path if exists, null otherwise)
ipcMain.handle(
  'project:getLocalPath',
  (_event, { slug }: { slug: string }): string | null => {
    const settings = loadSettings()
    const projectPath = path.join(settings.projectsDirectory, slug)
    return fs.existsSync(projectPath) ? projectPath : null
  }
)

// Check if a local project folder exists
ipcMain.handle(
  'project:exists',
  (_event, { slug }: { slug: string }): boolean => {
    const settings = loadSettings()
    const projectPath = path.join(settings.projectsDirectory, slug)
    return fs.existsSync(projectPath)
  }
)

// Check if any absolute project path exists (used for stale localPath recovery)
ipcMain.handle(
  'project:pathExists',
  (_event, { projectPath }: { projectPath: string }): boolean => {
    if (!projectPath || typeof projectPath !== 'string') return false
    try {
      return fs.existsSync(projectPath)
    } catch {
      return false
    }
  }
)

// Write a file to project folder
ipcMain.handle(
  'project:writeFile',
  async (
    _event,
    {
      projectPath,
      filePath,
      content,
      encoding = 'utf8',
    }: {
      projectPath: string
      filePath: string // relative path, e.g., "config/config.json"
      content: string
      encoding?: 'utf8' | 'base64'
    }
  ): Promise<{
    success: boolean
    fullPath?: string
    sizeBytes?: number
    error?: string
  }> => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath)
      const dir = path.dirname(fullPath)

      // Ensure directory exists
      if (!fs.existsSync(dir)) {
        fs.mkdirSync(dir, { recursive: true })
      }

      // Prevent the project watcher from treating this as an "external" change.
      markInternalFsChange(fullPath)
      if (encoding === 'base64') {
        fs.writeFileSync(fullPath, Buffer.from(content, 'base64'))
      } else {
        fs.writeFileSync(fullPath, content, 'utf-8')
      }
      const stats = fs.statSync(fullPath)
      console.log(`[Project] Wrote file: ${fullPath}`)

      // Notify Yjs of the file change for collaborative editing
      if (encoding !== 'base64') {
        notifyFileChanged(fullPath, content, { origin: 'agent' })
      }
      notifyFileMetaChanged({
        filePath: fullPath,
        origin: 'agent',
        isBinary: encoding === 'base64',
        sizeBytes: stats.size,
        content: encoding === 'base64' ? undefined : content,
      })

      return {
        success: true,
        fullPath,
        sizeBytes: stats.size,
      }
    } catch (error) {
      console.error('[Project] Failed to write file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Read a file from project folder
ipcMain.handle(
  'project:readFile',
  async (
    _event,
    { projectPath, filePath }: { projectPath: string; filePath: string }
  ): Promise<{
    success: boolean
    content?: string
    sizeBytes?: number
    error?: string
  }> => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath)

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'File not found' }
      }

      const content = fs.readFileSync(fullPath, 'utf-8')
      const stats = fs.statSync(fullPath)

      return {
        success: true,
        content,
        sizeBytes: stats.size,
      }
    } catch (error) {
      console.error('[Project] Failed to read file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Read a file from project folder (base64, binary-safe)
ipcMain.handle(
  'project:readFileBase64',
  async (
    _event,
    { projectPath, filePath }: { projectPath: string; filePath: string }
  ): Promise<{
    success: boolean
    base64?: string
    sizeBytes?: number
    error?: string
  }> => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, filePath)

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'File not found' }
      }

      const buffer = fs.readFileSync(fullPath)
      const stats = fs.statSync(fullPath)

      return {
        success: true,
        base64: buffer.toString('base64'),
        sizeBytes: stats.size,
      }
    } catch (error) {
      console.error('[Project] Failed to read file (base64):', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// List all files in project folder (recursive)
ipcMain.handle(
  'project:listFiles',
  async (
    _event,
    { projectPath }: { projectPath: string }
  ): Promise<{
    success: boolean
    files?: { path: string; sizeBytes: number }[]
    error?: string
  }> => {
    try {
      const files: { path: string; sizeBytes: number }[] = []
      const skippedDirectories = new Set([
        'node_modules',
        '.git',
        '.next',
        '.nuxt',
        '.output',
        '.svelte-kit',
        '.vercel',
        'dist',
        'build',
        'out',
        'coverage',
        '.turbo',
        '.cache',
        '.parcel-cache',
        '.pnpm-store',
        '.yarn',
        '__pycache__',
        'tmp',
        'temp',
        'logs',
        'vendor',
        'target',
      ])
      const skippedFileSuffixes = [
        '.log',
        '.tmp',
        '.temp',
        '.swp',
        '.swo',
        '.pid',
        '/prisma/dev.db',
        '/prisma/dev.db-wal',
        '/prisma/dev.db-shm',
      ]
      const maxFiles = 20000

      function walkDir(dir: string, relativePath = '') {
        if (!fs.existsSync(dir) || files.length >= maxFiles) return

        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (files.length >= maxFiles) break
          if (entry.isSymbolicLink()) continue

          const relPath = path.join(relativePath, entry.name)
          const fullPath = path.join(dir, entry.name)
          const nameLower = entry.name.toLowerCase()
          const normalizedPathLower = relPath.replace(/\\/g, '/').toLowerCase()

          if (entry.isDirectory()) {
            if (!skippedDirectories.has(nameLower)) {
              walkDir(fullPath, relPath)
            }
          } else {
            if (skippedFileSuffixes.some((suffix) => normalizedPathLower.endsWith(suffix))) {
              continue
            }
            const stats = fs.statSync(fullPath)
            files.push({ path: relPath, sizeBytes: stats.size })
          }
        }
      }

      walkDir(projectPath)
      return { success: true, files }
    } catch (error) {
      console.error('[Project] Failed to list files:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Rename/move a file or directory within project folder
ipcMain.handle(
  'project:renameFile',
  async (
    _event,
    {
      projectPath,
      oldPath,
      newPath,
    }: {
      projectPath: string
      oldPath: string
      newPath: string
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fullOldPath = resolvePathWithinDirectory(projectPath, oldPath)
      const fullNewPath = resolvePathWithinDirectory(projectPath, newPath)

      if (!fs.existsSync(fullOldPath)) {
        return { success: false, error: 'Source file not found' }
      }

      // Create parent directory of new path if it doesn't exist
      const newDir = path.dirname(fullNewPath)
      if (!fs.existsSync(newDir)) {
        fs.mkdirSync(newDir, { recursive: true })
      }

      fs.renameSync(fullOldPath, fullNewPath)
      console.log(`[Project] Renamed: ${oldPath} -> ${newPath}`)

      return { success: true }
    } catch (error) {
      console.error('[Project] Failed to rename file:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Delete a file or directory within project folder
ipcMain.handle(
  'project:deletePath',
  async (
    _event,
    {
      projectPath,
      targetPath,
    }: {
      projectPath: string
      targetPath: string
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fullPath = resolvePathWithinDirectory(projectPath, targetPath)

      if (!fs.existsSync(fullPath)) {
        return { success: false, error: 'Target not found' }
      }

      const stats = fs.statSync(fullPath)
      if (stats.isDirectory()) {
        fs.rmSync(fullPath, { recursive: true, force: true })
      } else {
        fs.unlinkSync(fullPath)
      }

      console.log(`[Project] Deleted: ${targetPath}`)
      return { success: true }
    } catch (error) {
      console.error('[Project] Failed to delete path:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Copy a file or directory within project folder
ipcMain.handle(
  'project:copyPath',
  async (
    _event,
    {
      projectPath,
      sourcePath,
      destinationPath,
    }: {
      projectPath: string
      sourcePath: string
      destinationPath: string
    }
  ): Promise<{ success: boolean; error?: string }> => {
    try {
      const fullSource = resolvePathWithinDirectory(projectPath, sourcePath)
      const fullDestination = resolvePathWithinDirectory(projectPath, destinationPath)

      if (!fs.existsSync(fullSource)) {
        return { success: false, error: 'Source not found' }
      }
      if (fs.existsSync(fullDestination)) {
        return { success: false, error: 'Destination already exists' }
      }

      const destinationDir = path.dirname(fullDestination)
      if (!fs.existsSync(destinationDir)) {
        fs.mkdirSync(destinationDir, { recursive: true })
      }

      const stats = fs.statSync(fullSource)
      if (stats.isDirectory()) {
        fs.cpSync(fullSource, fullDestination, { recursive: true })
      } else {
        fs.copyFileSync(fullSource, fullDestination)
      }

      console.log(`[Project] Copied: ${sourcePath} -> ${destinationPath}`)
      return { success: true }
    } catch (error) {
      console.error('[Project] Failed to copy path:', error)
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      }
    }
  }
)

// Copy project source files from one absolute directory to another.
// Used when a user chooses "use new directory" for an existing project path.
ipcMain.handle(
  'project:copyDirectorySnapshot',
  async (
    _event,
    { sourcePath, targetPath }: { sourcePath: string; targetPath: string }
  ): Promise<CopyDirectorySnapshotResult> => {
    try {
      if (!sourcePath || !targetPath) {
        return { success: false, error: 'Source and target paths are required' }
      }

      const normalizedSource = path.resolve(sourcePath)
      const normalizedTarget = path.resolve(targetPath)

      if (!fs.existsSync(normalizedSource) || !fs.statSync(normalizedSource).isDirectory()) {
        return { success: false, error: 'Source project directory does not exist' }
      }

      if (normalizedSource === normalizedTarget) {
        return { success: true, copiedTo: normalizedTarget }
      }

      const sourceWithSep = `${normalizedSource}${path.sep}`
      const targetWithSep = `${normalizedTarget}${path.sep}`
      if (normalizedTarget.startsWith(sourceWithSep) || normalizedSource.startsWith(targetWithSep)) {
        return { success: false, error: 'Source and target directories cannot be nested' }
      }

      if (!fs.existsSync(normalizedTarget)) {
        await fs.promises.mkdir(normalizedTarget, { recursive: true })
      }

      const excludedDirectories = new Set([
        'node_modules',
        '.next',
        '.nuxt',
        '.output',
        '.svelte-kit',
        'dist',
        'build',
        'out',
        'coverage',
        '.turbo',
        '.cache',
        '.parcel-cache',
        '.pnpm-store',
        '.yarn',
        '__pycache__',
        'tmp',
        'temp',
        'logs',
      ])
      const excludedFileSuffixes = ['.log', '.tmp', '.temp', '.swp', '.swo', '.pid']

      await fs.promises.cp(normalizedSource, normalizedTarget, {
        recursive: true,
        force: true,
        errorOnExist: false,
        filter: (src) => {
          const relative = path.relative(normalizedSource, src)
          if (!relative || relative === '') return true

          const normalizedRelative = relative.replace(/\\/g, '/').toLowerCase()
          const entryName = path.basename(src).toLowerCase()

          if (excludedDirectories.has(entryName)) return false
          if (excludedFileSuffixes.some((suffix) => normalizedRelative.endsWith(suffix))) return false
          if (
            normalizedRelative.endsWith('/prisma/dev.db') ||
            normalizedRelative.endsWith('/prisma/dev.db-wal') ||
            normalizedRelative.endsWith('/prisma/dev.db-shm')
          ) {
            return false
          }
          return true
        },
      })

      return { success: true, copiedTo: normalizedTarget }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to copy project files',
      }
    }
  }
)

// Watch/unwatch a project folder for external filesystem edits.
ipcMain.handle(
  'project:watchStart',
  (_event, { projectPath }: { projectPath: string }): { success: boolean; error?: string } => {
    return startProjectWatcher(projectPath)
  }
)

ipcMain.handle(
  'project:watchStop',
  (_event, { projectPath }: { projectPath: string }): { success: boolean; error?: string } => {
    return stopProjectWatcher(projectPath)
  }
)

// Read directory contents (one level)
interface FileEntry {
  name: string
  path: string
  type: 'file' | 'directory'
  size?: number
  modifiedAt?: string
}

ipcMain.handle(
  'fs:readDir',
  async (_event, dirPath: string): Promise<FileEntry[]> => {
    try {
      if (!fs.existsSync(dirPath)) {
        return []
      }

      const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      const result: FileEntry[] = []

      for (const entry of entries) {
        const fullPath = path.join(dirPath, entry.name)
        const isDirectory = entry.isDirectory()

        try {
          const stats = fs.statSync(fullPath)
          result.push({
            name: entry.name,
            path: fullPath,
            type: isDirectory ? 'directory' : 'file',
            size: isDirectory ? undefined : stats.size,
            modifiedAt: stats.mtime.toISOString(),
          })
        } catch {
          // Skip files we can't stat
        }
      }

      return result
    } catch (error) {
      console.error('[FS] Failed to read directory:', error)
      return []
    }
  }
)

// Read file content
ipcMain.handle(
  'fs:readFile',
  async (_event, filePath: string): Promise<string | null> => {
    try {
      if (!fs.existsSync(filePath)) {
        return null
      }
      return fs.readFileSync(filePath, 'utf-8')
    } catch (error) {
      console.error('[FS] Failed to read file:', error)
      return null
    }
  }
)

// ============================================
// Sync IPC Handlers (for file synchronization)
// ============================================

// Hash a single file using SHA-256
ipcMain.handle(
  'sync:hashFile',
  async (
    _event,
    { filePath }: { filePath: string }
  ): Promise<{ hash: string; size: number }> => {
    const content = fs.readFileSync(filePath)
    const hash = sha256Hex(content)

    return { hash, size: content.length }
  }
)

// Get local manifest (all files with hashes)
ipcMain.handle(
  'sync:getLocalManifest',
  async (
    _event,
    {
      projectPath,
      excludePatterns,
    }: {
      projectPath: string
      excludePatterns?: string[]
    }
  ): Promise<{
    manifest: Array<{ path: string; hash: string; size: number; mtime: number }>
    totalFiles: number
  }> => {
    const inFlight = localManifestRequests.get(projectPath)
    if (inFlight) {
      return inFlight
    }

    const manifestTask = (async (): Promise<{
      manifest: Array<{ path: string; hash: string; size: number; mtime: number }>
      totalFiles: number
    }> => {
      const cached = loadManifestCache(projectPath)
      const dirtyPaths = consumeManifestDirtyPaths(projectPath)
      const hasLegacyHashes = cached
        ? Object.values(cached.entries).some((entry) => entry.hash.length !== 64)
        : false

      if (cached && !hasLegacyHashes && dirtyPaths.length > 0 && dirtyPaths.length <= 1000) {
        const updatedEntries = { ...cached.entries }

        for (const relPath of dirtyPaths) {
          const fullPath = path.join(projectPath, relPath)
          if (!fs.existsSync(fullPath)) {
            delete updatedEntries[relPath]
            continue
          }

          try {
            const stats = fs.statSync(fullPath)
            if (!stats.isFile()) {
              delete updatedEntries[relPath]
              continue
            }
            const content = fs.readFileSync(fullPath)
            const hash = sha256Hex(content)
            updatedEntries[relPath] = {
              path: relPath,
              hash,
              size: stats.size,
              mtime: stats.mtimeMs,
            }
          } catch {
            delete updatedEntries[relPath]
          }
        }

        saveManifestCache(projectPath, updatedEntries, cached.dirMtimes)
        const manifest = Object.values(updatedEntries)
        return { manifest, totalFiles: manifest.length }
      }

      let workerResult:
        | {
            manifest: Array<{ path: string; hash: string; size: number; mtime: number }>
            totalFiles: number
            dirMtimes: Record<string, number>
          }
        | null = null

      try {
        workerResult = await getManifestFromWorkerIncremental(
          projectPath,
          excludePatterns,
          cached?.entries,
          cached?.dirMtimes
        )
      } catch (error) {
        console.warn('[Sync] Worker incremental manifest failed:', error)
        try {
          workerResult = await getManifestFromWorker(projectPath, excludePatterns)
        } catch (err) {
          console.warn('[Sync] Worker manifest failed, falling back to main thread:', err)
        }
      }

      if (workerResult) {
        const entries: Record<string, { path: string; hash: string; size: number; mtime: number }> = {}
        for (const entry of workerResult.manifest) {
          entries[entry.path] = entry
        }
        saveManifestCache(projectPath, entries, workerResult.dirMtimes)
        return { manifest: workerResult.manifest, totalFiles: workerResult.totalFiles }
      }

      const defaultExcludes = [
      'node_modules',
      '.git',
      '.next',
      '.nuxt',
      '.output',
      '.svelte-kit',
      '.vercel',
      'dist',
      'build',
      'out',
      'coverage',
      '.turbo',
      '.cache',
      '.parcel-cache',
      '.pnpm-store',
      '.yarn',
      '__pycache__',
      'tmp',
      'temp',
      'logs',
      'vendor',
      'target',
    ]
      const excludes = new Set([...defaultExcludes, ...(excludePatterns || [])].map((name) => name.toLowerCase()))
      const skippedFileSuffixes = [
      '.log',
      '.tmp',
      '.temp',
      '.swp',
      '.swo',
      '.pid',
      '/prisma/dev.db',
      '/prisma/dev.db-wal',
      '/prisma/dev.db-shm',
    ]
      const previousByPath = cached?.entries ? new Map(Object.entries(cached.entries)) : null

      const manifest: Array<{ path: string; hash: string; size: number; mtime: number }> = []

      function walkDir(dir: string, relativePath = '') {
        if (!fs.existsSync(dir)) return

        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isSymbolicLink()) continue

          // Skip excluded directories/files
          if (excludes.has(entry.name.toLowerCase())) continue
          // Skip hidden files except .env.example
          if (entry.name.startsWith('.') && entry.name !== '.env.example') continue

          const relPath = path.join(relativePath, entry.name)
          const fullPath = path.join(dir, entry.name)

          if (entry.isDirectory()) {
            walkDir(fullPath, relPath)
          } else if (entry.isFile()) {
            try {
              const stats = fs.statSync(fullPath)
              const normalizedPath = relPath.replace(/\\/g, '/')
              const normalizedPathLower = normalizedPath.toLowerCase()
              if (skippedFileSuffixes.some((suffix) => normalizedPathLower.endsWith(suffix))) {
                continue
              }
              const previous = previousByPath?.get(normalizedPath)

              if (
                previous &&
                previous.hash.length === 64 &&
                previous.mtime === stats.mtimeMs &&
                previous.size === stats.size
              ) {
                manifest.push({
                  path: normalizedPath,
                  hash: previous.hash,
                  size: stats.size,
                  mtime: stats.mtimeMs,
                })
                continue
              }

              const content = fs.readFileSync(fullPath)
              const hash = sha256Hex(content)

              manifest.push({
                path: normalizedPath,
                hash,
                size: stats.size,
                mtime: stats.mtimeMs,
              })
            } catch (err) {
              console.warn(`[Sync] Could not read file: ${fullPath}`, err)
            }
          }
        }
      }

      if (fs.existsSync(projectPath)) {
        walkDir(projectPath)
      }

      console.log(`[Sync] Generated manifest with ${manifest.length} files for ${projectPath}`)
      const entries: Record<string, { path: string; hash: string; size: number; mtime: number }> = {}
      for (const entry of manifest) {
        entries[entry.path] = entry
      }
      saveManifestCache(projectPath, entries, cached?.dirMtimes)
      return { manifest, totalFiles: manifest.length }
    })()

    localManifestRequests.set(projectPath, manifestTask)
    try {
      return await manifestTask
    } finally {
      if (localManifestRequests.get(projectPath) === manifestTask) {
        localManifestRequests.delete(projectPath)
      }
    }
  }
)

// Write multiple files atomically
ipcMain.handle(
  'sync:writeFiles',
  async (
    _event,
    {
      projectPath,
      files,
      opMeta,
    }: {
      projectPath: string
      files: Array<{ path: string; content: string; encoding?: 'utf8' | 'base64' }>
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'monaco' | 'agent' | 'watcher' | 'remote'
      }
    }
  ): Promise<{
    results: Array<{ path: string; success: boolean; error?: string }>
    successCount: number
  }> => {
    const results: Array<{ path: string; success: boolean; error?: string }> = []
    const opsToEnqueue: SyncOpRecord[] = []
    const opProjectId = opMeta?.projectId ? String(opMeta.projectId) : null
    const opActorId = opMeta?.actorId?.trim() ? opMeta.actorId.trim() : 'system'
    const opActorType = opMeta?.actorType ?? 'system'
    const opSource = opMeta?.source ?? 'remote'

    for (const file of files) {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, file.path)
        const dir = path.dirname(fullPath)

        if (!fs.existsSync(dir)) {
          fs.mkdirSync(dir, { recursive: true })
        }

        // Prevent the project watcher from treating this as an "external" change.
        markInternalFsChange(fullPath)
        const bytes =
          file.encoding === 'base64'
            ? Buffer.from(file.content, 'base64')
            : Buffer.from(file.content, 'utf-8')
        if (file.encoding === 'base64') {
          fs.writeFileSync(fullPath, bytes)
        } else {
          fs.writeFileSync(fullPath, file.content, 'utf-8')
        }
        const stats = fs.statSync(fullPath)
        results.push({ path: file.path, success: true })
        console.log(`[Sync] Wrote file: ${file.path}`)

        if (opProjectId) {
          const normalizedPath = normalizeSyncPath(file.path)
          const timestamp = Date.now()
          const newHash = sha256Hex(bytes)
          opsToEnqueue.push({
            opId: randomUUID(),
            idempotencyKey: `${opProjectId}:${opSource}:upsert:${normalizedPath}:${newHash}`,
            projectId: opProjectId,
            actorId: opActorId,
            actorType: opActorType,
            source: opSource,
            kind: 'upsert',
            path: normalizedPath,
            newHash,
            isBinary: file.encoding === 'base64',
            size: stats.size,
            timestamp,
          })
        }

        // Notify Yjs of the file change for collaborative editing
        if (file.encoding !== 'base64') {
          notifyFileChanged(fullPath, file.content, { origin: 'sync' })
        }
        notifyFileMetaChanged({
          filePath: fullPath,
          origin: 'sync',
          isBinary: file.encoding === 'base64',
          sizeBytes: stats.size,
          content: file.encoding === 'base64' ? undefined : file.content,
        })
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : 'Unknown error'
        results.push({ path: file.path, success: false, error: errorMsg })
        console.error(`[Sync] Failed to write file: ${file.path}`, err)
      }
    }

    if (opProjectId && opsToEnqueue.length > 0) {
      enqueueSyncOps(opProjectId, opsToEnqueue)
    }

    return { results, successCount: results.filter((r) => r.success).length }
  }
)

// Delete multiple files
ipcMain.handle(
  'sync:deleteFiles',
  async (
    _event,
    {
      projectPath,
      paths,
      opMeta,
    }: {
      projectPath: string
      paths: string[]
      opMeta?: {
        projectId: string
        actorId?: string
        actorType?: 'user' | 'agent' | 'system'
        source?: 'monaco' | 'agent' | 'watcher' | 'remote'
      }
    }
  ): Promise<{
    results: Array<{ path: string; success: boolean }>
  }> => {
    const results: Array<{ path: string; success: boolean }> = []
    const opsToEnqueue: SyncOpRecord[] = []
    const opProjectId = opMeta?.projectId ? String(opMeta.projectId) : null
    const opActorId = opMeta?.actorId?.trim() ? opMeta.actorId.trim() : 'system'
    const opActorType = opMeta?.actorType ?? 'system'
    const opSource = opMeta?.source ?? 'remote'

    for (const relPath of paths) {
      try {
        const fullPath = resolvePathWithinDirectory(projectPath, relPath)
        if (fs.existsSync(fullPath)) {
          // Prevent the project watcher from treating this as an "external" change.
          markInternalFsChange(fullPath)
          fs.unlinkSync(fullPath)
          console.log(`[Sync] Deleted file: ${relPath}`)
        }
        results.push({ path: relPath, success: true })

        if (opProjectId) {
          const normalizedPath = normalizeSyncPath(relPath)
          const timestamp = Date.now()
          opsToEnqueue.push({
            opId: randomUUID(),
            idempotencyKey: `${opProjectId}:${opSource}:delete:${normalizedPath}`,
            projectId: opProjectId,
            actorId: opActorId,
            actorType: opActorType,
            source: opSource,
            kind: 'delete',
            path: normalizedPath,
            isBinary: false,
            size: 0,
            timestamp,
          })
        }

        // Notify Yjs so the in-memory doc stays in sync with disk.
        notifyFileDeleted(fullPath, { origin: 'sync' })
      } catch (err) {
        console.error(`[Sync] Failed to delete file: ${relPath}`, err)
        results.push({ path: relPath, success: false })
      }
    }

    if (opProjectId && opsToEnqueue.length > 0) {
      enqueueSyncOps(opProjectId, opsToEnqueue)
    }

    return { results }
  }
)

// Git runtime diagnostics for sync/merge.
ipcMain.handle(
  'sync:getGitRuntimeHealth',
  async (_event, { force = false }: { force?: boolean }) => {
    return getGitRuntimeHealth(Boolean(force))
  }
)

// Merge preview with Git's merge-file engine.
ipcMain.handle(
  'sync:mergePreview',
  async (
    _event,
    input: {
      baseContent: string
      localContent: string
      cloudContent: string
      strategy?: 'zdiff3' | 'diff3'
      labels?: {
        local?: string
        base?: string
        cloud?: string
      }
    }
  ) => {
    return mergeTextWithGit(input)
  }
)

ipcMain.handle(
  'sync:mergeTreePreview',
  async (
    _event,
    input: {
      baseFiles: Array<{ path: string; content: string }>
      localFiles: Array<{ path: string; content: string }>
      cloudFiles: Array<{ path: string; content: string }>
      maxPreviewFiles?: number
      maxPreviewBytes?: number
    }
  ) => {
    return mergeTreeWithGit(input)
  }
)

function getConflictResolutionPath(): string {
  return path.join(app.getPath('userData'), 'sync-conflict-resolutions.json')
}

ipcMain.handle(
  'sync:resolveConflict',
  async (
    _event,
    { fingerprint, resolvedContent }: { fingerprint: string; resolvedContent: string }
  ): Promise<{ success: boolean; error?: string }> => {
    if (!fingerprint || typeof resolvedContent !== 'string') {
      return { success: false, error: 'Invalid conflict resolution payload' }
    }
    try {
      const filePath = getConflictResolutionPath()
      const existing = fs.existsSync(filePath)
        ? JSON.parse(fs.readFileSync(filePath, 'utf-8')) as Record<string, {
            resolvedContent: string
            updatedAt: number
          }>
        : {}
      existing[fingerprint] = {
        resolvedContent,
        updatedAt: Date.now(),
      }
      fs.writeFileSync(filePath, JSON.stringify(existing, null, 2), 'utf-8')
      mergeCacheSaveResolvedConflict({
        fingerprint,
        resolvedContent,
        createdAt: Date.now(),
        lastUsedAt: Date.now(),
        hitCount: 0,
      })
      return { success: true }
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Failed to persist conflict resolution',
      }
    }
  }
)

ipcMain.handle(
  'sync:mergeCacheGet',
  async (_event, { key }: { key: string }): Promise<MergeCacheRecordPayload | null> => {
    return mergeCacheGet(String(key))
  }
)

ipcMain.handle(
  'sync:mergeCacheSet',
  async (_event, { record }: { record: MergeCacheRecordPayload }): Promise<{ success: boolean }> => {
    return { success: mergeCacheSet(record) }
  }
)

ipcMain.handle(
  'sync:mergeCacheDelete',
  async (_event, { key }: { key: string }): Promise<{ success: boolean }> => {
    return { success: mergeCacheDelete(String(key)) }
  }
)

ipcMain.handle(
  'sync:mergeCacheGetResolved',
  async (_event, { fingerprint }: { fingerprint: string }): Promise<ConflictResolutionPayload | null> => {
    return mergeCacheGetResolvedConflict(String(fingerprint))
  }
)

ipcMain.handle(
  'sync:mergeCacheSaveResolved',
  async (_event, { record }: { record: ConflictResolutionPayload }): Promise<{ success: boolean }> => {
    return { success: mergeCacheSaveResolvedConflict(record) }
  }
)

ipcMain.handle(
  'sync:mergeCachePrune',
  async (
    _event,
    { threshold, maxEntries }: { threshold: number; maxEntries?: number }
  ): Promise<{ removed: number }> => {
    return mergeCachePrune(Number(threshold) || 0, maxEntries)
  }
)

ipcMain.handle(
  'sync:enqueueOps',
  async (
    _event,
    { projectId, ops }: { projectId: string; ops: SyncOpRecord[] }
  ): Promise<{
    accepted: number
    acceptedOpIds: string[]
    rejected: number
    replicaState: {
      projectId: string
      replicaHead: number
      pendingOps: number
      lastAckedAt: number | null
      ackedOps: number
      pathHeads: Record<string, string>
      lastStateVector: number
      lastPersistedAt: number | null
    }
  }> => {
    return enqueueSyncOps(String(projectId), Array.isArray(ops) ? ops : [])
  }
)

ipcMain.handle(
  'sync:ackOps',
  async (
    _event,
    { projectId, opIds }: { projectId: string; opIds: string[] }
  ): Promise<{
    acked: number
    replicaState: {
      projectId: string
      replicaHead: number
      pendingOps: number
      lastAckedAt: number | null
      ackedOps: number
      pathHeads: Record<string, string>
      lastStateVector: number
      lastPersistedAt: number | null
    }
  }> => {
    return acknowledgeSyncOps(String(projectId), Array.isArray(opIds) ? opIds : [])
  }
)

ipcMain.handle(
  'sync:getReplicaState',
  async (
    _event,
    { projectId }: { projectId: string }
  ): Promise<{
    projectId: string
    replicaHead: number
    pendingOps: number
    lastAckedAt: number | null
    ackedOps: number
    pathHeads: Record<string, string>
    lastStateVector: number
    lastPersistedAt: number | null
  }> => {
    const normalizedProjectId = String(projectId)
    const replica = getReplicaStateRecord(normalizedProjectId)
    replica.pendingOps = (queuedOpsByProject.get(normalizedProjectId) ?? []).length
    replica.lastStateVector = replica.replicaHead - replica.pendingOps
    replicaStateByProject.set(normalizedProjectId, replica)
    return snapshotReplicaState(normalizedProjectId, replica)
  }
)

ipcMain.handle(
  'sync:getHistory',
  async (
    _event,
    { projectId }: { projectId: string }
  ): Promise<SyncHistoryPayload> => {
    return getSyncHistory(String(projectId))
  }
)

ipcMain.handle(
  'sync:setHistory',
  async (
    _event,
    {
      projectId,
      lastSyncAt,
      cloudPaths,
    }: {
      projectId: string
      lastSyncAt: number
      cloudPaths: string[]
    }
  ): Promise<SyncHistoryPayload> => {
    return setSyncHistory(String(projectId), {
      lastSyncAt: Number(lastSyncAt) || Date.now(),
      cloudPaths: Array.isArray(cloudPaths) ? cloudPaths : [],
    })
  }
)

// ============================================
// Dev Server IPC Handlers
// ============================================

// Start a dev server for a project using PTY for proper terminal emulation
ipcMain.handle(
  'devServer:start',
  async (
    _event,
    {
      projectPath,
      command,
      port,
      cols = 80,
      rows = 24,
    }: {
      projectPath: string
      command: string
      port: number
      cols?: number
      rows?: number
    }
  ): Promise<{ success: boolean; pid?: number; error?: string }> => {
    // Check if server is already running for this project
    if (devServerProcesses.has(projectPath)) {
      return { success: false, error: 'Dev server already running for this project' }
    }

    try {
      console.log(`[DevServer] Starting PTY: ${command} in ${projectPath} (${cols}x${rows})`)

      // Determine shell based on platform
      const shell = process.platform === 'win32' ? 'powershell.exe' : process.env.SHELL || '/bin/bash'

      // Spawn the process using node-pty for proper terminal emulation
      const ptyProcess = pty.spawn(shell, ['-c', command], {
        name: 'xterm-256color',
        cols,
        rows,
        cwd: projectPath,
        env: {
          ...process.env,
          PORT: String(port),
          FORCE_COLOR: '1',
          TERM: 'xterm-256color',
        } as Record<string, string>,
      })

      devServerProcesses.set(projectPath, ptyProcess)

      // Stream output to renderer (PTY combines stdout and stderr)
      ptyProcess.onData((data: string) => {
        // Don't log every output line to reduce console spam
        win?.webContents.send('devServer:output', { projectPath, output: data, stream: 'stdout' })
      })

      // Handle process exit
      ptyProcess.onExit(({ exitCode }) => {
        console.log(`[DevServer] PTY exited with code ${exitCode}`)
        devServerProcesses.delete(projectPath)
        win?.webContents.send('devServer:exit', { projectPath, code: exitCode })
      })

      return { success: true, pid: ptyProcess.pid }
    } catch (err) {
      console.error('[DevServer] Failed to start PTY:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to start dev server',
      }
    }
  }
)

// Stop a dev server for a project
ipcMain.handle(
  'devServer:stop',
  async (
    _event,
    { projectPath }: { projectPath: string }
  ): Promise<{ success: boolean; error?: string }> => {
    const ptyProcess = devServerProcesses.get(projectPath)
    if (!ptyProcess) {
      return { success: true } // Already stopped
    }

    try {
      console.log(`[DevServer] Stopping PTY for ${projectPath}`)

      // Kill the PTY process (node-pty handles killing the process tree)
      ptyProcess.kill()

      devServerProcesses.delete(projectPath)
      return { success: true }
    } catch (err) {
      console.error('[DevServer] Failed to stop PTY:', err)
      return {
        success: false,
        error: err instanceof Error ? err.message : 'Failed to stop dev server',
      }
    }
  }
)

// Resize a running PTY
ipcMain.handle(
  'devServer:resize',
  (
    _event,
    { projectPath, cols, rows }: { projectPath: string; cols: number; rows: number }
  ): { success: boolean } => {
    const ptyProcess = devServerProcesses.get(projectPath)
    if (!ptyProcess) {
      return { success: false }
    }

    try {
      ptyProcess.resize(cols, rows)
      return { success: true }
    } catch (err) {
      console.error('[DevServer] Failed to resize PTY:', err)
      return { success: false }
    }
  }
)

// Check if a dev server is running for a project
ipcMain.handle(
  'devServer:isRunning',
  (_event, { projectPath }: { projectPath: string }): boolean => {
    return devServerProcesses.has(projectPath)
  }
)

// ============================================
// Terminal IPC Handlers (VS Code-style multi-terminal)
// ============================================

// Legacy Terminal IPC Handlers Removed (Moved to TerminalService)

// ============================================
// Context Menu for Terminal Selection
// ============================================

export interface ContextMenuAction {
  id: string
  label: string
  accelerator?: string
}

ipcMain.handle(
  'contextMenu:showTerminalSelection',
  async (
    _event,
    { selectedText, x, y }: { selectedText: string; x: number; y: number }
  ): Promise<{ action: string | null }> => {
    return new Promise((resolve) => {
      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'Copy',
          accelerator: 'CmdOrCtrl+C',
          click: () => {
            clipboard.writeText(selectedText)
            resolve({ action: 'copy' })
          },
        },
        { type: 'separator' },
        {
          label: 'Ask AI about this',
          click: () => {
            resolve({ action: 'askAI' })
          },
        },
        {
          label: 'Explain this error',
          click: () => {
            resolve({ action: 'explainError' })
          },
        },
        { type: 'separator' },
        {
          label: 'Search Google',
          click: () => {
            const query = encodeURIComponent(selectedText)
            shell.openExternal(`https://www.google.com/search?q=${query}`)
            resolve({ action: 'searchGoogle' })
          },
        },
        {
          label: 'Search Stack Overflow',
          click: () => {
            const query = encodeURIComponent(selectedText)
            shell.openExternal(`https://stackoverflow.com/search?q=${query}`)
            resolve({ action: 'searchStackOverflow' })
          },
        },
      ]

      const menu = Menu.buildFromTemplate(template)

      menu.popup({
        window: win || undefined,
        x,
        y,
        callback: () => {
          // Menu closed without selection
          resolve({ action: null })
        },
      })
    })
  }
)

ipcMain.handle(
  'contextMenu:showFileTreeMenu',
  async (
    event,
    {
      targetPath,
      isDirectory,
      x,
      y,
    }: { targetPath: string; isDirectory: boolean; x: number; y: number }
  ): Promise<{ action: string | null }> => {
    return new Promise((resolve) => {
      let resolved = false
      const window = BrowserWindow.fromWebContents(event.sender) ?? win
      const revealLabel =
        process.platform === 'darwin'
          ? 'Reveal in Finder'
          : process.platform === 'win32'
            ? 'Show in Explorer'
            : 'Show in File Manager'

      const template: Electron.MenuItemConstructorOptions[] = [
        {
          label: 'New File',
          click: () => {
            resolved = true
            resolve({ action: 'new-file' })
          },
        },
        {
          label: 'New Folder',
          click: () => {
            resolved = true
            resolve({ action: 'new-folder' })
          },
        },
        {
          label: 'Rename',
          click: () => {
            resolved = true
            resolve({ action: 'rename' })
          },
        },
        {
          label: 'Duplicate',
          click: () => {
            resolved = true
            resolve({ action: 'duplicate' })
          },
        },
        {
          label: 'Delete',
          click: () => {
            resolved = true
            resolve({ action: 'delete' })
          },
        },
        { type: 'separator' },
        {
          label: revealLabel,
          click: () => {
            shell.showItemInFolder(targetPath)
            resolved = true
            resolve({ action: 'reveal' })
          },
        },
        {
          label: 'Copy Path',
          click: () => {
            clipboard.writeText(targetPath)
            resolved = true
            resolve({ action: 'copy-path' })
          },
        },
        {
          label: 'Copy Relative Path',
          click: () => {
            resolved = true
            resolve({ action: 'copy-relative-path' })
          },
        },
        { type: 'separator' },
        {
          label: isDirectory ? 'Copy Folder Name' : 'Copy File Name',
          click: () => {
            clipboard.writeText(path.basename(targetPath))
            resolved = true
            resolve({ action: 'copy-name' })
          },
        },
      ]

      const menu = Menu.buildFromTemplate(template)

      menu.popup({
        window: window || undefined,
        x,
        y,
        callback: () => {
          if (!resolved) {
            resolve({ action: null })
          }
        },
      })
    })
  }
)

app.on('window-all-closed', () => {
  // Kill all running dev servers when app closes
  for (const [projectPath, ptyProcess] of devServerProcesses) {
    console.log(`[DevServer] Killing PTY for ${projectPath}`)
    try {
      ptyProcess.kill()
    } catch {
      // Ignore errors when killing on shutdown
    }
  }
  devServerProcesses.clear()

  // Kill all terminal instances when app closes
  TerminalService.getInstance().killAll()

  if (process.platform !== 'darwin') {
    app.quit()
    win = null
  }
})

app.on('before-quit', () => {
  stopUpdateChecks()
})

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow()
  }
})

app.whenReady().then(async () => {
  performanceService.recordMainMetric('app.when_ready', performance.now() - mainStart)
  loadSyncState()
  const gitHealth = await getGitRuntimeHealth(true)
  if (!gitHealth.preflightOk) {
    console.error('[GitRuntime] Preflight failed:', gitHealth.error ?? 'Unknown error')
  } else {
    console.log(
      `[GitRuntime] Ready (${gitHealth.source}): ${gitHealth.gitVersion} @ ${gitHealth.executablePath ?? 'unknown'}`
    )
  }

  registerAutoUpdater()
  createWindow()
  startUpdateChecks()
})
