import { app } from 'electron'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

import type {
  WorkbenchSessionLifecycle,
  WorkbenchSessionSnapshot,
} from '../../../../shared/electronApiTypes'
import type { NativePreviewSessionLocator } from '../../../../shared/nativePreviewTypes'
import { DevServerService } from './DevServerService'
import { TerminalService } from './TerminalService'
import { NativePreviewManager } from './nativePreview/NativePreviewManager'

interface PersistedWorkbenchSessionRecord {
  projectId: string
  laneId: string
  workspaceId: string | null
  lifecycle: Exclude<WorkbenchSessionLifecycle, 'closed'>
  pinned: boolean
  openedAt: number
  lastFocusedAt: number
  lastBackgroundedAt: number | null
}

interface PersistedWorkbenchSessionState {
  version: 1
  sessions: Record<string, PersistedWorkbenchSessionRecord>
}

interface LiveWorkbenchSessionRecord {
  projectId: string
  laneId: string
  workspaceId: string | null
  lifecycle: WorkbenchSessionLifecycle
  pinned: boolean
  openedAt: number
  lastFocusedAt: number
  lastBackgroundedAt: number | null
  terminalBindings: Record<string, string>
  nativePreviewLocator: NativePreviewSessionLocator | null
}

interface WorkbenchSessionManagerServices {
  nativePreviewManager: NativePreviewManager
  browserSurfaces: {
    hasSurfaceForWorkbenchSession: (sessionKey: string) => boolean
    releaseSurfacesForWorkbenchSession: (sessionKey: string) => Promise<void>
  }
}

type BackgroundLifecycle = Exclude<WorkbenchSessionLifecycle, 'active' | 'closed'>

const REGISTRY_FILE_NAME = 'workbench-session-registry.json'
const MAX_BACKGROUND_WARM_SESSIONS = 2
const SESSION_POLICY_SWEEP_INTERVAL_MS = 30_000
const BACKGROUND_WARM_IDLE_MS = 2 * 60 * 1000
const BACKGROUND_WARM_ACTIVE_PREVIEW_IDLE_MS = 10 * 60 * 1000
const LOW_MEMORY_FREE_THRESHOLD_KB = 1_500_000
const LOW_MEMORY_FREE_RATIO = 0.12
const MEMORY_PRESSURE_CHECK_TTL_MS = 2_000

function normalizeWorkspaceId(workspaceId?: string | null): string | null {
  const trimmed = workspaceId?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function buildSessionKey(projectId: string, laneId: string, workspaceId?: string | null): string {
  return `${projectId.trim()}::${laneId.trim() || 'collab'}::${normalizeWorkspaceId(workspaceId) ?? 'unbound'}`
}

function getRegistryPath(): string {
  return path.join(app.getPath('userData'), REGISTRY_FILE_NAME)
}

function readRegistryState(): PersistedWorkbenchSessionState {
  const registryPath = getRegistryPath()

  try {
    if (!fs.existsSync(registryPath)) {
      return { version: 1, sessions: {} }
    }

    const raw = fs.readFileSync(registryPath, 'utf8')
    const parsed = JSON.parse(raw) as Partial<PersistedWorkbenchSessionState> | null
    const sessions =
      parsed?.sessions && typeof parsed.sessions === 'object'
        ? parsed.sessions
        : {}

    return {
      version: 1,
      sessions: sessions as Record<string, PersistedWorkbenchSessionRecord>,
    }
  } catch {
    return { version: 1, sessions: {} }
  }
}

function writeRegistryState(state: PersistedWorkbenchSessionState): void {
  const registryPath = getRegistryPath()
  fs.mkdirSync(path.dirname(registryPath), { recursive: true })
  fs.writeFileSync(registryPath, JSON.stringify(state, null, 2))
}

function resolveOwnedWorkspaceId(args: {
  projectId: string
  workspaceId?: string | null
  warn?: (event: string, details: Record<string, unknown>) => void
}): string | null | undefined {
  if (args.workspaceId === undefined) {
    return undefined
  }
  return args.workspaceId ? args.workspaceId.trim() : null
}

function sanitizeSessionInput<T extends {
  projectId: string
  laneId: string
  workspaceId?: string | null
}>(
  input: T,
  warn?: (event: string, details: Record<string, unknown>) => void,
): T {
  return {
    ...input,
    workspaceId: resolveOwnedWorkspaceId({
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      warn,
    }),
  }
}

function findSessionKeysByProjectLane(
  sessions: Iterable<[string, { projectId: string; laneId: string }]>,
  input: { projectId: string; laneId: string },
): string[] {
  const normalizedProjectId = input.projectId.trim()
  const normalizedLaneId = input.laneId.trim() || 'collab'
  return Array.from(sessions)
    .filter(([, record]) => record.projectId === normalizedProjectId && record.laneId === normalizedLaneId)
    .map(([sessionKey]) => sessionKey)
}

function repairPersistedSessionState(state: PersistedWorkbenchSessionState): boolean {
  let changed = false
  const repairedSessions: Record<string, PersistedWorkbenchSessionRecord> = {}

  for (const [sessionKey, record] of Object.entries(state.sessions)) {
    const ownedWorkspaceId = resolveOwnedWorkspaceId({
      projectId: record.projectId,
      workspaceId: record.workspaceId,
    })

    const repairedRecord: PersistedWorkbenchSessionRecord = {
      ...record,
      workspaceId: ownedWorkspaceId ?? null,
    }
    const repairedSessionKey = buildSessionKey(
      repairedRecord.projectId,
      repairedRecord.laneId,
      repairedRecord.workspaceId,
    )
    const existingRecord = repairedSessions[repairedSessionKey]

    if (
      !existingRecord ||
      Math.max(repairedRecord.lastFocusedAt, repairedRecord.openedAt) >=
        Math.max(existingRecord.lastFocusedAt, existingRecord.openedAt)
    ) {
      repairedSessions[repairedSessionKey] = repairedRecord
    }

    if (
      repairedSessionKey !== sessionKey ||
      repairedRecord.workspaceId !== record.workspaceId ||
      existingRecord
    ) {
      changed = true
    }
  }

  if (Object.keys(repairedSessions).length !== Object.keys(state.sessions).length) {
    changed = true
  }

  state.sessions = repairedSessions
  return changed
}

export const __workbenchSessionTestUtils = {
  buildSessionKey,
  findSessionKeysByProjectLane,
  repairPersistedSessionState,
  resolveOwnedWorkspaceId,
}

function toPersistedRecord(record: LiveWorkbenchSessionRecord): PersistedWorkbenchSessionRecord {
  return {
    projectId: record.projectId,
    laneId: record.laneId,
    workspaceId: record.workspaceId,
    lifecycle:
      record.lifecycle === 'active' ||
      record.lifecycle === 'backgroundWarm' ||
      record.lifecycle === 'backgroundFrozen'
        ? record.lifecycle
        : 'backgroundFrozen',
    pinned: record.pinned,
    openedAt: record.openedAt,
    lastFocusedAt: record.lastFocusedAt,
    lastBackgroundedAt: record.lastBackgroundedAt,
  }
}

export class WorkbenchSessionManager extends EventEmitter<{
  stateChanged: [session: WorkbenchSessionSnapshot]
}> {
  private static instance: WorkbenchSessionManager | null = null

  static getInstance(services?: WorkbenchSessionManagerServices): WorkbenchSessionManager {
    if (!WorkbenchSessionManager.instance) {
      if (!services) {
        throw new Error('WorkbenchSessionManager services are required during first initialization.')
      }
      WorkbenchSessionManager.instance = new WorkbenchSessionManager(services)
    }
    return WorkbenchSessionManager.instance
  }

  private readonly terminalService = TerminalService.getInstance()
  private readonly devServerService = DevServerService.getInstance()
  private readonly nativePreviewManager: NativePreviewManager
  private readonly browserSurfaces: WorkbenchSessionManagerServices['browserSurfaces']
  private readonly sessions = new Map<string, LiveWorkbenchSessionRecord>()
  private readonly policySweepTimer: NodeJS.Timeout
  private policySweepInFlight = false
  private lastMemoryPressureCheckAt = 0
  private lastKnownMemoryPressure = false
  private readonly lastEmittedComparable = new Map<string, string>()
  private readonly pendingStateEmits = new Map<string, WorkbenchSessionSnapshot>()
  private stateEmitFlushScheduled = false

  private logLifecycleTransition(
    sessionKey: string,
    previousLifecycle: WorkbenchSessionLifecycle,
    nextLifecycle: WorkbenchSessionLifecycle,
    reason: string,
  ): void {
    void sessionKey
    void reason
    if (previousLifecycle === nextLifecycle) {
      return
    }
  }

  private warnOwnershipMismatch(event: string, details: Record<string, unknown>): void {
    console.warn("[WorkbenchSessionManager] Ownership mismatch", {
      event,
      ...details,
    })
  }

  private sanitizeSessionInput<T extends {
    projectId: string
    laneId: string
    workspaceId?: string | null
  }>(input: T): T {
    return sanitizeSessionInput(input, this.warnOwnershipMismatch.bind(this))
  }

  private constructor(services: WorkbenchSessionManagerServices) {
    super()
    this.nativePreviewManager = services.nativePreviewManager
    this.browserSurfaces = services.browserSurfaces

    const persisted = readRegistryState()
    const repairedPersistedSessions = repairPersistedSessionState(persisted)
    if (repairedPersistedSessions) {
      writeRegistryState(persisted)
    }

    for (const [, record] of Object.entries(persisted.sessions)) {
      const derivedSessionKey = buildSessionKey(record.projectId, record.laneId, record.workspaceId)
      const nextRecord: LiveWorkbenchSessionRecord = {
        ...record,
        workspaceId: normalizeWorkspaceId(record.workspaceId),
        lifecycle:
          record.lifecycle === 'active' ? 'backgroundWarm' : record.lifecycle,
        terminalBindings: {},
        nativePreviewLocator: null,
      }
      const existing = this.sessions.get(derivedSessionKey)
      if (
        !existing ||
        Math.max(nextRecord.lastFocusedAt, nextRecord.openedAt) >= Math.max(existing.lastFocusedAt, existing.openedAt)
      ) {
        this.sessions.set(derivedSessionKey, nextRecord)
      }
    }

    this.policySweepTimer = setInterval(() => {
      void this.runPolicySweep()
    }, SESSION_POLICY_SWEEP_INTERVAL_MS)
    this.policySweepTimer.unref?.()

    app.once('before-quit', () => {
      clearInterval(this.policySweepTimer)
    })
  }

  private persist(): void {
    const sessions = Object.fromEntries(
      Array.from(this.sessions.entries())
        .filter(([, record]) => record.lifecycle !== 'closed')
        .map(([sessionKey, record]) => [sessionKey, toPersistedRecord(record)]),
    )

    const state = {
      version: 1,
      sessions,
    } satisfies PersistedWorkbenchSessionState

    writeRegistryState(state)
  }

  private createRecord(input: {
    projectId: string
    laneId: string
    workspaceId?: string | null
  }): LiveWorkbenchSessionRecord {
    const now = Date.now()
    return {
      projectId: input.projectId.trim(),
      laneId: input.laneId.trim() || 'collab',
      workspaceId: normalizeWorkspaceId(input.workspaceId),
      lifecycle: 'backgroundWarm',
      pinned: false,
      openedAt: now,
      lastFocusedAt: now,
      lastBackgroundedAt: now,
      terminalBindings: {},
      nativePreviewLocator: null,
    }
  }

  private normalizeWorkspaceId(workspaceId?: string | null): string | null {
    return normalizeWorkspaceId(workspaceId)
  }

  private findLatestSessionKey(input: {
    projectId: string
    laneId: string
  }): string | null {
    const projectId = input.projectId.trim()
    const laneId = input.laneId.trim() || 'collab'

    const candidate = Array.from(this.sessions.entries())
      .filter(([, record]) => record.projectId === projectId && record.laneId === laneId)
      .sort((left, right) => {
        const leftRecord = left[1]
        const rightRecord = right[1]
        return Math.max(rightRecord.lastFocusedAt, rightRecord.openedAt) - Math.max(leftRecord.lastFocusedAt, leftRecord.openedAt)
      })[0]

    return candidate?.[0] ?? null
  }

  private resolveSessionKey(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
  }): string | null {
    const sanitizedInput = this.sanitizeSessionInput(input)
    const explicitSessionKey = sanitizedInput.sessionKey?.trim()
    if (explicitSessionKey) {
      return this.sessions.has(explicitSessionKey) ? explicitSessionKey : null
    }

    if (sanitizedInput.workspaceId !== undefined) {
      const exactSessionKey = buildSessionKey(
        sanitizedInput.projectId,
        sanitizedInput.laneId,
        sanitizedInput.workspaceId,
      )
      if (this.sessions.has(exactSessionKey)) {
        return exactSessionKey
      }
    }

    return this.findLatestSessionKey({
      projectId: sanitizedInput.projectId,
      laneId: sanitizedInput.laneId,
    })
  }

  private async reconcileSessionWorkspaceId(
    sessionKey: string,
    record: LiveWorkbenchSessionRecord,
    nextWorkspaceId?: string | null,
  ): Promise<void> {
    if (nextWorkspaceId === undefined) {
      return
    }

    const normalizedNextWorkspaceId = this.normalizeWorkspaceId(nextWorkspaceId)
    if (record.workspaceId === normalizedNextWorkspaceId) {
      return
    }

    // A live workspace should never be soft-reassigned to another local root.
    // If the caller wants a different root, they must address a different session key.
    if (record.workspaceId && normalizedNextWorkspaceId && record.workspaceId !== normalizedNextWorkspaceId) {
      this.warnOwnershipMismatch("rebind_rejected", {
        sessionKey,
        projectId: record.projectId,
        laneId: record.laneId,
        currentWorkspaceId: record.workspaceId,
        requestedWorkspaceId: normalizedNextWorkspaceId,
      })
      return
    }

    if (record.workspaceId && normalizedNextWorkspaceId === null) {
      this.warnOwnershipMismatch("unbind_rejected", {
        sessionKey,
        projectId: record.projectId,
        laneId: record.laneId,
        currentWorkspaceId: record.workspaceId,
      })
      return
    }

    record.workspaceId = normalizedNextWorkspaceId
    this.emitState(sessionKey, record)
  }

  private getBackgroundAge(record: LiveWorkbenchSessionRecord, now = Date.now()): number {
    const baseline = record.lastBackgroundedAt ?? record.lastFocusedAt ?? record.openedAt
    return Math.max(0, now - baseline)
  }

  private hasRunningDevServer(record: LiveWorkbenchSessionRecord): boolean {
    if (!record.workspaceId) {
      return false
    }

    return this.devServerService.getState(record.workspaceId, record.laneId).running
  }

  private hasRunningNativePreview(record: LiveWorkbenchSessionRecord): boolean {
    if (!record.nativePreviewLocator) {
      return false
    }

    return Boolean(this.nativePreviewManager.getSessionState(record.nativePreviewLocator))
  }

  private hasRetainedPreviewRuntime(record: LiveWorkbenchSessionRecord): boolean {
    const sessionKey = buildSessionKey(record.projectId, record.laneId, record.workspaceId)
    return (
      this.hasRunningDevServer(record) ||
      this.hasRunningNativePreview(record) ||
      this.browserSurfaces.hasSurfaceForWorkbenchSession(sessionKey)
    )
  }

  private isUnderMemoryPressure(): boolean {
    const now = Date.now()
    if (now - this.lastMemoryPressureCheckAt < MEMORY_PRESSURE_CHECK_TTL_MS) {
      return this.lastKnownMemoryPressure
    }

    const electronProcess = process as NodeJS.Process & {
      getSystemMemoryInfo?: () => { free: number; total: number }
    }

    const getSystemMemoryInfo = electronProcess.getSystemMemoryInfo
    if (typeof getSystemMemoryInfo !== 'function') {
      this.lastMemoryPressureCheckAt = now
      this.lastKnownMemoryPressure = false
      return false
    }

    try {
      const info = getSystemMemoryInfo()
      if (!info || !Number.isFinite(info.free) || !Number.isFinite(info.total) || info.total <= 0) {
        this.lastKnownMemoryPressure = false
      } else {
        this.lastKnownMemoryPressure =
          info.free <= LOW_MEMORY_FREE_THRESHOLD_KB || info.free / info.total <= LOW_MEMORY_FREE_RATIO
      }
      this.lastMemoryPressureCheckAt = now
      return this.lastKnownMemoryPressure
    } catch {
      this.lastMemoryPressureCheckAt = now
      return this.lastKnownMemoryPressure
    }
  }

  private async runPolicySweep(): Promise<void> {
    if (this.policySweepInFlight) {
      return
    }

    this.policySweepInFlight = true

    try {
      const now = Date.now()
      const underMemoryPressure = this.isUnderMemoryPressure()
      let mutated = false

      for (const [sessionKey, record] of this.sessions.entries()) {
        if (record.lifecycle === 'active' || record.lifecycle === 'closed') {
          continue
        }

        const backgroundAge = this.getBackgroundAge(record, now)
        const hasRetainedPreviewRuntime = this.hasRetainedPreviewRuntime(record)
        const warmIdleLimit = hasRetainedPreviewRuntime
          ? BACKGROUND_WARM_ACTIVE_PREVIEW_IDLE_MS
          : BACKGROUND_WARM_IDLE_MS

        if (
          record.lifecycle === 'backgroundWarm' &&
          !record.pinned &&
          (backgroundAge >= warmIdleLimit || (underMemoryPressure && !hasRetainedPreviewRuntime))
        ) {
          const previousLifecycle = record.lifecycle
          record.lifecycle = 'backgroundFrozen'
          record.lastBackgroundedAt = record.lastBackgroundedAt ?? now
          this.logLifecycleTransition(
            sessionKey,
            previousLifecycle,
            record.lifecycle,
            underMemoryPressure ? 'policy:memory-pressure' : 'policy:idle-timeout',
          )
          this.emitState(sessionKey, record)
          await this.browserSurfaces.releaseSurfacesForWorkbenchSession(sessionKey)
          mutated = true
        }

        if (record.lifecycle !== 'backgroundFrozen') {
          continue
        }

      }

      if (mutated) {
        this.persist()
      }
    } finally {
      this.policySweepInFlight = false
    }
  }

  private getOrCreateSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
  }): { sessionKey: string; record: LiveWorkbenchSessionRecord } {
    const sanitizedInput = this.sanitizeSessionInput(input)
    const providedSessionKey = sanitizedInput.sessionKey?.trim()
    if (providedSessionKey) {
      const existingByExplicitKey = this.sessions.get(providedSessionKey)
      if (existingByExplicitKey) {
        return { sessionKey: providedSessionKey, record: existingByExplicitKey }
      }
    }

    const sessionKey = buildSessionKey(
      sanitizedInput.projectId,
      sanitizedInput.laneId,
      sanitizedInput.workspaceId,
    )
    const existing = this.sessions.get(sessionKey)
    if (existing) {
      return { sessionKey, record: existing }
    }

    const created = this.createRecord(sanitizedInput)
    this.sessions.set(sessionKey, created)
    return { sessionKey, record: created }
  }

  private buildSnapshot(
    sessionKey: string,
    record: LiveWorkbenchSessionRecord,
  ): WorkbenchSessionSnapshot {
    const devServer = record.workspaceId
      ? this.devServerService.getState(record.workspaceId, record.laneId)
      : { running: false, port: null, runId: null }
    const hasNativePreviewSession = record.nativePreviewLocator
      ? Boolean(this.nativePreviewManager.getSessionState(record.nativePreviewLocator))
      : false

    return {
      sessionKey,
      projectId: record.projectId,
      laneId: record.laneId,
      workspaceId: record.workspaceId,
      lifecycle: record.lifecycle,
      pinned: record.pinned,
      openedAt: record.openedAt,
      lastFocusedAt: record.lastFocusedAt,
      lastBackgroundedAt: record.lastBackgroundedAt,
      terminalBindings: { ...record.terminalBindings },
      devServer,
      hasBrowserSurface: this.browserSurfaces.hasSurfaceForWorkbenchSession(sessionKey),
      hasNativePreviewSession,
    }
  }

  /**
   * Comparison payload for broadcast dedupe. The activity timestamps are
   * excluded on purpose: they change on every ensure/activate/focus, and
   * broadcasting them re-rendered every renderer subscriber per mutation
   * (16 broadcasts per navigation before this guard). The renderer-side
   * dedupe in useWorkbenchSessionLifecycle uses the same exclusion list.
   */
  private comparableSnapshot(snapshot: WorkbenchSessionSnapshot): string {
    const { openedAt: _openedAt, lastFocusedAt: _lastFocusedAt, lastBackgroundedAt: _lastBackgroundedAt, ...meaningful } = snapshot
    return JSON.stringify(meaningful)
  }

  private emitState(sessionKey: string, record: LiveWorkbenchSessionRecord): WorkbenchSessionSnapshot {
    const snapshot = this.buildSnapshot(sessionKey, record)
    // Callers rely on the synchronous snapshot (IPC handler responses); only
    // the broadcast is coalesced. Bursts of mutations within a tick collapse
    // to at most one emit per session, and content-identical states are
    // suppressed entirely.
    //
    // 'closed' is a terminal transition the renderer must observe to tear down
    // its tile. buildSessionKey is deterministic, so a close-then-re-ensure of
    // the same key within one tick would otherwise overwrite the pending
    // 'closed' snapshot with a fresh 'backgroundWarm' one and silently drop the
    // close broadcast. Flush the pending close synchronously before it is
    // replaced by a non-closed snapshot so the transition is never lost.
    const previousPending = this.pendingStateEmits.get(sessionKey)
    if (
      previousPending &&
      previousPending.lifecycle === 'closed' &&
      snapshot.lifecycle !== 'closed'
    ) {
      this.pendingStateEmits.delete(sessionKey)
      this.lastEmittedComparable.delete(sessionKey)
      this.emit('stateChanged', previousPending)
    }
    this.pendingStateEmits.set(sessionKey, snapshot)
    if (!this.stateEmitFlushScheduled) {
      this.stateEmitFlushScheduled = true
      setImmediate(() => {
        this.stateEmitFlushScheduled = false
        const pending = Array.from(this.pendingStateEmits.values())
        this.pendingStateEmits.clear()
        for (const pendingSnapshot of pending) {
          const comparable = this.comparableSnapshot(pendingSnapshot)
          if (this.lastEmittedComparable.get(pendingSnapshot.sessionKey) === comparable) {
            continue
          }
          if (pendingSnapshot.lifecycle === 'closed') {
            this.lastEmittedComparable.delete(pendingSnapshot.sessionKey)
          } else {
            this.lastEmittedComparable.set(pendingSnapshot.sessionKey, comparable)
          }
          this.emit('stateChanged', pendingSnapshot)
        }
      })
    }
    return snapshot
  }

  private rebalanceBackgroundSessions(activeSessionKey: string | null): void {
    const candidates = Array.from(this.sessions.entries())
      .filter(([sessionKey, record]) => sessionKey !== activeSessionKey && record.lifecycle !== 'closed')
      .sort((left, right) => {
        const leftRecord = left[1]
        const rightRecord = right[1]
        if (leftRecord.pinned !== rightRecord.pinned) {
          return leftRecord.pinned ? -1 : 1
        }
        const leftHasRetainedPreviewRuntime = this.hasRetainedPreviewRuntime(leftRecord)
        const rightHasRetainedPreviewRuntime = this.hasRetainedPreviewRuntime(rightRecord)
        if (leftHasRetainedPreviewRuntime !== rightHasRetainedPreviewRuntime) {
          return leftHasRetainedPreviewRuntime ? -1 : 1
        }
        return rightRecord.lastFocusedAt - leftRecord.lastFocusedAt
      })

    let warmCount = 0
    for (const [sessionKey, record] of candidates) {
      const nextLifecycle: BackgroundLifecycle =
        warmCount < MAX_BACKGROUND_WARM_SESSIONS ? 'backgroundWarm' : 'backgroundFrozen'
      warmCount += 1

      if (record.lifecycle !== nextLifecycle) {
        const previousLifecycle = record.lifecycle
        record.lifecycle = nextLifecycle
        record.lastBackgroundedAt = Date.now()
        this.logLifecycleTransition(
          sessionKey,
          previousLifecycle,
          nextLifecycle,
          nextLifecycle === 'backgroundWarm' ? 'rebalance:retain-warm' : 'rebalance:freeze-over-cap',
        )
        this.emitState(sessionKey, record)
        if (nextLifecycle === 'backgroundFrozen') {
          void this.browserSurfaces.releaseSurfacesForWorkbenchSession(sessionKey)
        }
      }
    }
  }

  async ensureSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
  }): Promise<WorkbenchSessionSnapshot> {
    const sanitizedInput = this.sanitizeSessionInput(input)
    const { sessionKey, record } = this.getOrCreateSession(sanitizedInput)
    await this.reconcileSessionWorkspaceId(sessionKey, record, sanitizedInput.workspaceId)
    this.persist()
    const snapshot = this.emitState(sessionKey, record)
    void this.runPolicySweep()
    return snapshot
  }

  async activateSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
  }): Promise<WorkbenchSessionSnapshot> {
    const sanitizedInput = this.sanitizeSessionInput(input)
    const now = Date.now()
    const { sessionKey, record } = this.getOrCreateSession(sanitizedInput)
    await this.reconcileSessionWorkspaceId(sessionKey, record, sanitizedInput.workspaceId)
    const previousLifecycle = record.lifecycle
    record.lifecycle = 'active'
    record.lastFocusedAt = now
    this.logLifecycleTransition(sessionKey, previousLifecycle, record.lifecycle, 'activate-session')

    const snapshot = this.emitState(sessionKey, record)
    this.rebalanceBackgroundSessions(sessionKey)
    this.persist()
    void this.runPolicySweep()
    return snapshot
  }

  backgroundSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    mode?: BackgroundLifecycle
  }): WorkbenchSessionSnapshot | null {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) return null
    const record = this.sessions.get(sessionKey)
    if (!record) return null

    const nextLifecycle = input.mode ?? 'backgroundWarm'
    if (record.lifecycle !== nextLifecycle) {
      const previousLifecycle = record.lifecycle
      record.lifecycle = nextLifecycle
      record.lastBackgroundedAt = Date.now()
      this.logLifecycleTransition(sessionKey, previousLifecycle, nextLifecycle, 'background-session')
    }

    const snapshot = this.emitState(sessionKey, record)
    if (nextLifecycle === 'backgroundFrozen') {
      void this.browserSurfaces.releaseSurfacesForWorkbenchSession(sessionKey)
    }
    this.rebalanceBackgroundSessions(null)
    this.persist()
    void this.runPolicySweep()
    return snapshot
  }

  private resolveSessionKeysForClose(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
  }): string[] {
    const explicitSessionKey = input.sessionKey?.trim()
    if (explicitSessionKey) {
      return this.sessions.has(explicitSessionKey) ? [explicitSessionKey] : []
    }

    if (input.workspaceId !== undefined) {
      const sessionKey = this.resolveSessionKey(input)
      return sessionKey ? [sessionKey] : []
    }

    return findSessionKeysByProjectLane(this.sessions.entries(), input)
  }

  private async closeSessionByKey(sessionKey: string): Promise<void> {
    const record = this.sessions.get(sessionKey)
    if (!record) {
      return
    }

    for (const terminalId of Object.values(record.terminalBindings)) {
      this.terminalService.killTerminal(terminalId)
    }
    record.terminalBindings = {}

    if (record.workspaceId) {
      await this.devServerService.stop(record.workspaceId, record.laneId).catch(() => ({ success: false }))
    }

    if (record.nativePreviewLocator) {
      await this.nativePreviewManager.stopSession(record.nativePreviewLocator).catch(() => ({ success: false }))
      record.nativePreviewLocator = null
    }

    await this.browserSurfaces.releaseSurfacesForWorkbenchSession(sessionKey)

    const previousLifecycle = record.lifecycle
    record.lifecycle = 'closed'
    record.lastBackgroundedAt = Date.now()
    this.logLifecycleTransition(sessionKey, previousLifecycle, 'closed', 'close-session')
    this.emitState(sessionKey, record)
    this.sessions.delete(sessionKey)
  }

  async closeSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
  }): Promise<boolean> {
    const sessionKeys = this.resolveSessionKeysForClose(input)
    if (sessionKeys.length === 0) {
      return true
    }

    for (const sessionKey of sessionKeys) {
      await this.closeSessionByKey(sessionKey)
    }

    this.persist()
    return true
  }

  refreshBrowserSurfaceState(sessionKey: string): void {
    const record = this.sessions.get(sessionKey)
    if (record) this.emitState(sessionKey, record)
  }

  getSession(input: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null }): WorkbenchSessionSnapshot | null {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) {
      return null
    }
    const record = this.sessions.get(sessionKey)
    return record ? this.buildSnapshot(sessionKey, record) : null
  }

  listSessions(): WorkbenchSessionSnapshot[] {
    return Array.from(this.sessions.entries()).map(([sessionKey, record]) =>
      this.buildSnapshot(sessionKey, record),
    )
  }

  setPinned(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    pinned: boolean
  }): WorkbenchSessionSnapshot | null {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) return null
    const record = this.sessions.get(sessionKey)
    if (!record) return null

    record.pinned = input.pinned
    const snapshot = this.emitState(sessionKey, record)
    this.rebalanceBackgroundSessions(record.lifecycle === 'active' ? sessionKey : null)
    this.persist()
    void this.runPolicySweep()
    return snapshot
  }

  getTerminalBinding(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    tileId: string
  }): string | null {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) return null
    const record = this.sessions.get(sessionKey)
    if (!record) return null

    const terminalId = record.terminalBindings[input.tileId]
    if (!terminalId) {
      return null
    }

    const snapshot = this.terminalService.getTerminalSnapshot(terminalId)
    if (!snapshot || !this.terminalService.hasTerminal(terminalId) && snapshot.running) {
      this.warnOwnershipMismatch("terminal_binding_stale", {
        sessionKey,
        tileId: input.tileId,
        terminalId,
        snapshotExists: Boolean(snapshot),
        terminalExists: this.terminalService.hasTerminal(terminalId),
      })
      delete record.terminalBindings[input.tileId]
      this.persist()
      this.emitState(sessionKey, record)
      return null
    }

    if (record.workspaceId && snapshot.workspaceId !== record.workspaceId) {
      this.warnOwnershipMismatch("terminal_path_mismatch", {
        sessionKey,
        tileId: input.tileId,
        terminalId,
        expectedWorkspaceId: record.workspaceId,
        actualWorkspaceId: snapshot.workspaceId,
      })
      delete record.terminalBindings[input.tileId]
      this.persist()
      this.emitState(sessionKey, record)
      return null
    }

    return terminalId
  }

  async bindTerminal(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    tileId: string
    terminalId: string
    workspaceId?: string | null
  }): Promise<WorkbenchSessionSnapshot> {
    const sanitizedInput = this.sanitizeSessionInput(input)
    const { sessionKey, record } = this.getOrCreateSession(sanitizedInput)
    await this.reconcileSessionWorkspaceId(sessionKey, record, sanitizedInput.workspaceId)
    const snapshot = this.terminalService.getTerminalSnapshot(input.terminalId)
    if (record.workspaceId && snapshot?.workspaceId && snapshot.workspaceId !== record.workspaceId) {
      this.warnOwnershipMismatch("bind_terminal_rejected", {
        sessionKey,
        tileId: input.tileId,
        terminalId: input.terminalId,
        expectedWorkspaceId: record.workspaceId,
        actualWorkspaceId: snapshot.workspaceId,
      })
      return this.emitState(sessionKey, record)
    }
    record.terminalBindings[input.tileId] = input.terminalId
    this.persist()
    return this.emitState(sessionKey, record)
  }

  releaseTerminal(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    tileId: string
    close?: boolean
  }): { success: boolean; terminalId?: string } {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) {
      return { success: true }
    }
    const record = this.sessions.get(sessionKey)
    if (!record) {
      return { success: true }
    }

    const terminalId = record.terminalBindings[input.tileId]
    if (!terminalId) {
      return { success: true }
    }

    delete record.terminalBindings[input.tileId]
    if (input.close) {
      this.terminalService.killTerminal(terminalId)
    }
    this.persist()
    this.emitState(sessionKey, record)
    return { success: true, terminalId }
  }

  async setNativePreviewSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    locator: NativePreviewSessionLocator | null
    stopPrevious?: boolean
  }): Promise<WorkbenchSessionSnapshot | null> {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) {
      return null
    }
    const record = this.sessions.get(sessionKey)
    if (!record) {
      return null
    }

    const previousLocator = record.nativePreviewLocator
    const previousKey = previousLocator
      ? `${previousLocator.platform}:${previousLocator.deviceId}:${previousLocator.workspaceId}`
      : null
    const nextKey = input.locator
      ? `${input.locator.platform}:${input.locator.deviceId}:${input.locator.workspaceId}`
      : null

    if (input.stopPrevious && previousLocator && previousKey !== nextKey) {
      await this.nativePreviewManager.stopSession(previousLocator).catch(() => ({ success: false }))
    }

    record.nativePreviewLocator = input.locator
    this.persist()
    return this.emitState(sessionKey, record)
  }
}
