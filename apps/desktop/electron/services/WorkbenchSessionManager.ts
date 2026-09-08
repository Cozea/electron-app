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
import { getDesktopStatePersistenceService } from './DesktopStatePersistenceService'

interface PersistedWorkbenchSessionRecord {
  projectId: string
  laneId: string
  workspaceId: string | null
  workspaceRevision?: number
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
  workspaceRevision: number
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
const FINAL_REGISTRY_FLUSH_TIMEOUT_MS = 3_000

function normalizeWorkspaceId(workspaceId?: string | null): string | null {
  const trimmed = workspaceId?.trim()
  return trimmed && trimmed.length > 0 ? trimmed : null
}

function normalizeWorkspaceRevision(workspaceRevision?: number): number {
  if (workspaceRevision === undefined) return 1
  if (!Number.isSafeInteger(workspaceRevision) || workspaceRevision < 1) {
    throw new Error('Invalid workspace revision')
  }
  return workspaceRevision
}

function repairWorkspaceRevision(workspaceRevision?: number): number {
  return Number.isSafeInteger(workspaceRevision) && Number(workspaceRevision) >= 1
    ? Number(workspaceRevision)
    : 1
}

function buildSessionKey(
  projectId: string,
  laneId: string,
  workspaceId?: string | null,
  workspaceRevision?: number,
): string {
  return `${projectId.trim()}::${laneId.trim() || 'collab'}::${normalizeWorkspaceId(workspaceId) ?? 'unbound'}::v${normalizeWorkspaceRevision(workspaceRevision)}`
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
  workspaceRevision?: number
}>(
  input: T,
  warn?: (event: string, details: Record<string, unknown>) => void,
): T {
  return {
    ...input,
    workspaceRevision:
      input.workspaceRevision === undefined
        ? undefined
        : normalizeWorkspaceRevision(input.workspaceRevision),
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

function findCurrentSessionRevision(
  sessions: Iterable<[string, LiveWorkbenchSessionRecord]>,
  input: { projectId: string; laneId: string; workspaceId?: string | null },
): number | undefined {
  const projectId = input.projectId.trim()
  const laneId = input.laneId.trim() || 'collab'
  const workspaceId = normalizeWorkspaceId(input.workspaceId)
  const current = Array.from(sessions)
    .map(([, record]) => record)
    .filter((record) =>
      record.projectId === projectId &&
      record.laneId === laneId &&
      (input.workspaceId === undefined || record.workspaceId === workspaceId),
    )
    .sort((left, right) =>
      right.workspaceRevision - left.workspaceRevision ||
      Math.max(right.lastFocusedAt, right.openedAt) - Math.max(left.lastFocusedAt, left.openedAt),
    )[0]
  return current?.workspaceRevision
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
      workspaceRevision: repairWorkspaceRevision(record.workspaceRevision),
    }
    const repairedSessionKey = buildSessionKey(
      repairedRecord.projectId,
      repairedRecord.laneId,
      repairedRecord.workspaceId,
      repairedRecord.workspaceRevision,
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
      repairedRecord.workspaceRevision !== record.workspaceRevision ||
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
  findCurrentSessionRevision,
  findSessionKeysByProjectLane,
  repairPersistedSessionState,
  resolveOwnedWorkspaceId,
}

function toPersistedRecord(record: LiveWorkbenchSessionRecord): PersistedWorkbenchSessionRecord {
  return {
    projectId: record.projectId,
    laneId: record.laneId,
    workspaceId: record.workspaceId,
    workspaceRevision: record.workspaceRevision,
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
  private readonly presentationLeases = new Map<string, Set<string>>()
  private readonly registryHydration: Promise<void>
  private registryHydrated = false
  private readonly preHydrationMutatedSessionKeys = new Set<string>()
  private readonly preHydrationDeletedSessionKeys = new Set<string>()
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
    workspaceRevision?: number
  }>(input: T): T {
    return sanitizeSessionInput(input, this.warnOwnershipMismatch.bind(this))
  }

  private constructor(services: WorkbenchSessionManagerServices) {
    super()
    this.nativePreviewManager = services.nativePreviewManager
    this.browserSurfaces = services.browserSurfaces

    const persisted = readRegistryState()
    repairPersistedSessionState(persisted)

    for (const [, record] of Object.entries(persisted.sessions)) {
      const workspaceRevision = repairWorkspaceRevision(record.workspaceRevision)
      const derivedSessionKey = buildSessionKey(
        record.projectId,
        record.laneId,
        record.workspaceId,
        workspaceRevision,
      )
      const nextRecord: LiveWorkbenchSessionRecord = {
        ...record,
        workspaceId: normalizeWorkspaceId(record.workspaceId),
        workspaceRevision,
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
    this.registryHydration = this.hydrateRegistry(persisted)

    this.policySweepTimer = setInterval(() => {
      void this.runPolicySweep()
    }, SESSION_POLICY_SWEEP_INTERVAL_MS)
    this.policySweepTimer.unref?.()

    app.once('before-quit', (event) => {
      event.preventDefault()
      clearInterval(this.policySweepTimer)
      let deadlineTimer: NodeJS.Timeout | null = null
      const deadline = new Promise<void>((resolve) => {
        deadlineTimer = setTimeout(resolve, FINAL_REGISTRY_FLUSH_TIMEOUT_MS)
        deadlineTimer.unref?.()
      })
      void Promise.race([
        this.registryHydration.then(() => this.flushRegistry()),
        deadline,
      ])
        .catch((error) => {
          console.warn('[WorkbenchSessionManager] Final registry flush failed:', error)
        })
        .finally(() => {
          if (deadlineTimer) clearTimeout(deadlineTimer)
          app.quit()
        })
    })
  }

  private isRegistryDirty = false
  private registryFlushTimer: NodeJS.Timeout | null = null
  private registryFlushInFlight: Promise<void> | null = null
  private registryChangeSequence = 0

  private persist(sessionKeys?: string | readonly string[]): void {
    if (!this.registryHydrated) {
      const keys = sessionKeys === undefined
        ? Array.from(this.sessions.keys())
        : (typeof sessionKeys === 'string' ? [sessionKeys] : sessionKeys)
      for (const sessionKey of keys) {
        if (this.sessions.has(sessionKey)) {
          this.preHydrationMutatedSessionKeys.add(sessionKey)
          this.preHydrationDeletedSessionKeys.delete(sessionKey)
        } else {
          this.preHydrationDeletedSessionKeys.add(sessionKey)
          this.preHydrationMutatedSessionKeys.delete(sessionKey)
        }
      }
    }
    this.markRegistryDirty()
  }

  public markRegistryDirty(): void {
    this.isRegistryDirty = true
    this.registryChangeSequence += 1
    this.scheduleRegistryFlush()
  }

  private scheduleRegistryFlush(): void {
    if (this.registryFlushTimer || this.registryFlushInFlight) return
    this.registryFlushTimer = setTimeout(() => {
      this.registryFlushTimer = null
      void this.flushRegistry().catch((error) => {
        console.warn('[WorkbenchSessionManager] Failed to persist session registry:', error)
      })
    }, 500)
  }

  private replaceSessionsFromPersisted(state: PersistedWorkbenchSessionState): void {
    const merged = new Map<string, LiveWorkbenchSessionRecord>()
    for (const sessionKey of this.preHydrationMutatedSessionKeys) {
      const live = this.sessions.get(sessionKey)
      if (live) merged.set(sessionKey, live)
    }
    for (const record of Object.values(state.sessions)) {
      const workspaceRevision = repairWorkspaceRevision(record.workspaceRevision)
      const sessionKey = buildSessionKey(
        record.projectId,
        record.laneId,
        record.workspaceId,
        workspaceRevision,
      )
      if (this.preHydrationDeletedSessionKeys.has(sessionKey)) continue
      const live = this.sessions.get(sessionKey)
      if (this.preHydrationMutatedSessionKeys.has(sessionKey) && live) continue
      merged.set(sessionKey, {
        ...record,
        workspaceId: normalizeWorkspaceId(record.workspaceId),
        workspaceRevision,
        lifecycle: record.lifecycle === 'active' ? 'backgroundWarm' : record.lifecycle,
        terminalBindings: {},
        nativePreviewLocator: null,
      })
    }
    this.sessions.clear()
    for (const [sessionKey, record] of merged) this.sessions.set(sessionKey, record)
  }

  private async hydrateRegistry(legacy: PersistedWorkbenchSessionState): Promise<void> {
    try {
      const loaded = await getDesktopStatePersistenceService().load(
        'sessionRegistry', ['registry'], false,
      )
      const stored = loaded.records[0]?.data as PersistedWorkbenchSessionState | undefined
      if (stored?.version === 1 && stored.sessions && typeof stored.sessions === 'object') {
        repairPersistedSessionState(stored)
        this.replaceSessionsFromPersisted(stored)
      } else if (Object.keys(legacy.sessions).length > 0) {
        this.markRegistryDirty()
        await this.flushRegistry()
      }
    } catch (error) {
      console.warn('[WorkbenchSessionManager] Failed to hydrate session registry:', error)
    } finally {
      this.registryHydrated = true
      this.preHydrationMutatedSessionKeys.clear()
      this.preHydrationDeletedSessionKeys.clear()
    }
  }

  public async flushRegistry(): Promise<void> {
    if (this.registryFlushTimer) {
      clearTimeout(this.registryFlushTimer)
      this.registryFlushTimer = null
    }
    if (this.registryFlushInFlight) {
      await this.registryFlushInFlight
      if (this.isRegistryDirty) await this.flushRegistry()
      return
    }
    if (!this.isRegistryDirty) return
    const targetSequence = this.registryChangeSequence

    const sessions = Object.fromEntries(
      Array.from(this.sessions.entries())
        .filter(([, record]) => record.lifecycle !== 'closed')
        .map(([sessionKey, record]) => [sessionKey, toPersistedRecord(record)]),
    )

    const state = {
      version: 1,
      sessions,
    } satisfies PersistedWorkbenchSessionState

    const operation = getDesktopStatePersistenceService().commit([{
      schemaVersion: 1,
      namespace: 'sessionRegistry',
      key: 'registry',
      recordRevision: 1,
      updatedAt: Date.now(),
      data: state,
    }], false).then(() => undefined)
    this.registryFlushInFlight = operation
    try {
      await operation
      if (this.registryChangeSequence === targetSequence) this.isRegistryDirty = false
    } catch (error) {
      this.isRegistryDirty = true
      throw error
    } finally {
      if (this.registryFlushInFlight === operation) this.registryFlushInFlight = null
      if (this.isRegistryDirty) this.scheduleRegistryFlush()
    }
  }

  private createRecord(input: {
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
  }): LiveWorkbenchSessionRecord {
    const now = Date.now()
    return {
      projectId: input.projectId.trim(),
      laneId: input.laneId.trim() || 'collab',
      workspaceId: normalizeWorkspaceId(input.workspaceId),
      workspaceRevision: normalizeWorkspaceRevision(input.workspaceRevision),
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
    workspaceRevision?: number
  }): string | null {
    const sanitizedInput = this.sanitizeSessionInput(input)
    const explicitSessionKey = sanitizedInput.sessionKey?.trim()
    if (explicitSessionKey) {
      const record = this.sessions.get(explicitSessionKey)
      return record && this.recordMatchesInput(record, sanitizedInput) ? explicitSessionKey : null
    }

    if (sanitizedInput.workspaceId !== undefined) {
      const exactSessionKey = buildSessionKey(
        sanitizedInput.projectId,
        sanitizedInput.laneId,
        sanitizedInput.workspaceId,
        sanitizedInput.workspaceRevision,
      )
      return this.sessions.has(exactSessionKey) ? exactSessionKey : null
    }

    return this.findLatestSessionKey({
      projectId: sanitizedInput.projectId,
      laneId: sanitizedInput.laneId,
    })
  }

  private recordMatchesInput(
    record: LiveWorkbenchSessionRecord,
    input: { projectId: string; laneId: string; workspaceId?: string | null; workspaceRevision?: number },
  ): boolean {
    if (record.projectId !== input.projectId.trim()) return false
    if (record.laneId !== (input.laneId.trim() || 'collab')) return false
    if (input.workspaceId !== undefined && record.workspaceId !== normalizeWorkspaceId(input.workspaceId)) return false
    return input.workspaceRevision === undefined || record.workspaceRevision === input.workspaceRevision
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
    const sessionKey = buildSessionKey(
      record.projectId,
      record.laneId,
      record.workspaceId,
      record.workspaceRevision,
    )
    return (
      this.hasRunningDevServer(record) ||
      this.hasRunningNativePreview(record) ||
      this.browserSurfaces.hasSurfaceForWorkbenchSession(sessionKey)
    )
  }

  private hasPresentationLease(sessionKey: string): boolean {
    for (const leasedSessionKeys of this.presentationLeases.values()) {
      if (leasedSessionKeys.has(sessionKey)) return true
    }
    return false
  }

  setPresentationLeases(ownerId: string, sessionKeys: Iterable<string>): void {
    const next = new Set(
      Array.from(sessionKeys).filter((sessionKey) => this.sessions.has(sessionKey)),
    )
    if (next.size === 0) this.presentationLeases.delete(ownerId)
    else this.presentationLeases.set(ownerId, next)
    this.rebalanceBackgroundSessions(this.findActiveSessionKey())
  }

  releasePresentationLeases(ownerId: string): void {
    if (!this.presentationLeases.delete(ownerId)) return
    this.rebalanceBackgroundSessions(this.findActiveSessionKey())
  }

  private findActiveSessionKey(): string | null {
    for (const [sessionKey, record] of this.sessions) {
      if (record.lifecycle === 'active') return sessionKey
    }
    return null
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
          !this.hasPresentationLease(sessionKey) &&
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
    workspaceRevision?: number
  }): { sessionKey: string; record: LiveWorkbenchSessionRecord } {
    const sanitizedInput = this.sanitizeSessionInput(input)
    const providedSessionKey = sanitizedInput.sessionKey?.trim()
    if (providedSessionKey) {
      const existingByExplicitKey = this.sessions.get(providedSessionKey)
      if (existingByExplicitKey && this.recordMatchesInput(existingByExplicitKey, sanitizedInput)) {
        return { sessionKey: providedSessionKey, record: existingByExplicitKey }
      }
    }

    const sessionKey = buildSessionKey(
      sanitizedInput.projectId,
      sanitizedInput.laneId,
      sanitizedInput.workspaceId,
      sanitizedInput.workspaceRevision,
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
      workspaceRevision: record.workspaceRevision,
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
        const leftLeased = this.hasPresentationLease(left[0])
        const rightLeased = this.hasPresentationLease(right[0])
        if (leftLeased !== rightLeased) return leftLeased ? -1 : 1
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
      const presentationLeased = this.hasPresentationLease(sessionKey)
      const nextLifecycle: BackgroundLifecycle =
        presentationLeased || warmCount < MAX_BACKGROUND_WARM_SESSIONS
          ? 'backgroundWarm'
          : 'backgroundFrozen'
      if (!presentationLeased) warmCount += 1

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
    workspaceRevision?: number
  }): Promise<WorkbenchSessionSnapshot> {
    await this.registryHydration
    const sanitizedInput = this.sanitizeSessionInput(input)
    const { sessionKey, record } = this.getOrCreateSession(sanitizedInput)
    await this.reconcileSessionWorkspaceId(sessionKey, record, sanitizedInput.workspaceId)
    this.persist(sessionKey)
    const snapshot = this.emitState(sessionKey, record)
    void this.runPolicySweep()
    return snapshot
  }

  async activateSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
  }): Promise<WorkbenchSessionSnapshot> {
    const snapshot = await this.activateSessionGuarded(input, () => true)
    if (!snapshot) throw new Error('Workbench session activation was cancelled')
    return snapshot
  }

  async activateSessionGuarded(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
  }, mayActivate: () => boolean | Promise<boolean>): Promise<WorkbenchSessionSnapshot | null> {
    await this.registryHydration
    const sanitizedInput = this.sanitizeSessionInput(input)
    const { sessionKey, record } = this.getOrCreateSession(sanitizedInput)
    await this.reconcileSessionWorkspaceId(sessionKey, record, sanitizedInput.workspaceId)
    if (!(await mayActivate())) return null
    const now = Date.now()
    const previousLifecycle = record.lifecycle
    record.lifecycle = 'active'
    record.lastFocusedAt = now
    this.logLifecycleTransition(sessionKey, previousLifecycle, record.lifecycle, 'activate-session')

    const snapshot = this.emitState(sessionKey, record)
    this.rebalanceBackgroundSessions(sessionKey)
    this.persist(sessionKey)
    void this.runPolicySweep()
    return snapshot
  }

  backgroundSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
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
    this.persist(sessionKey)
    void this.runPolicySweep()
    return snapshot
  }

  private resolveSessionKeysForClose(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
  }): string[] {
    const explicitSessionKey = input.sessionKey?.trim()
    if (explicitSessionKey) {
      const resolved = this.resolveSessionKey(input)
      return resolved ? [resolved] : []
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
    for (const [ownerId, leasedSessionKeys] of this.presentationLeases) {
      leasedSessionKeys.delete(sessionKey)
      if (leasedSessionKeys.size === 0) this.presentationLeases.delete(ownerId)
    }
  }

  async closeSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
  }): Promise<boolean> {
    const sessionKeys = this.resolveSessionKeysForClose(input)
    if (sessionKeys.length === 0) {
      return true
    }

    for (const sessionKey of sessionKeys) {
      await this.closeSessionByKey(sessionKey)
    }

    this.persist(sessionKeys)
    return true
  }

  async closeSupersededBindingSessions(input: {
    projectId: string
    laneId: string
    workspaceId: string
    workspaceRevision: number
  }): Promise<string[]> {
    const projectId = input.projectId.trim()
    const laneId = input.laneId.trim() || 'collab'
    const workspaceId = normalizeWorkspaceId(input.workspaceId)
    const workspaceRevision = normalizeWorkspaceRevision(input.workspaceRevision)
    if (!workspaceId) return []

    const staleKeys = Array.from(this.sessions.entries())
      .filter(([, record]) =>
        record.projectId === projectId &&
        record.laneId === laneId &&
        record.workspaceId === workspaceId &&
        record.workspaceRevision !== workspaceRevision,
      )
      .map(([sessionKey]) => sessionKey)
    for (const sessionKey of staleKeys) await this.closeSessionByKey(sessionKey)
    if (staleKeys.length > 0) this.persist(staleKeys)
    return staleKeys
  }

  refreshBrowserSurfaceState(sessionKey: string): void {
    const record = this.sessions.get(sessionKey)
    if (record) this.emitState(sessionKey, record)
  }

  getSession(input: { sessionKey?: string | null; projectId: string; laneId: string; workspaceId?: string | null; workspaceRevision?: number }): WorkbenchSessionSnapshot | null {
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
    workspaceId?: string | null
    workspaceRevision?: number
    pinned: boolean
  }): WorkbenchSessionSnapshot | null {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) return null
    const record = this.sessions.get(sessionKey)
    if (!record) return null

    record.pinned = input.pinned
    const snapshot = this.emitState(sessionKey, record)
    this.rebalanceBackgroundSessions(record.lifecycle === 'active' ? sessionKey : null)
    this.persist(sessionKey)
    void this.runPolicySweep()
    return snapshot
  }

  getTerminalBinding(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
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
      this.persist(sessionKey)
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
      this.persist(sessionKey)
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
    workspaceRevision?: number
  }): Promise<WorkbenchSessionSnapshot> {
    const sanitizedInput = this.sanitizeSessionInput(input)
    const resolvedInput = sanitizedInput.workspaceRevision === undefined
      ? {
          ...sanitizedInput,
          workspaceRevision: findCurrentSessionRevision(this.sessions, sanitizedInput),
        }
      : sanitizedInput
    const { sessionKey, record } = this.getOrCreateSession(resolvedInput)
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
    this.persist(sessionKey)
    return this.emitState(sessionKey, record)
  }

  releaseTerminal(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
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
    this.persist(sessionKey)
    this.emitState(sessionKey, record)
    return { success: true, terminalId }
  }

  async setNativePreviewSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    workspaceId?: string | null
    workspaceRevision?: number
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
    this.persist(sessionKey)
    return this.emitState(sessionKey, record)
  }
}
