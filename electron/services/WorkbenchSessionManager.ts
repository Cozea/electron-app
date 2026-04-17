import { app } from 'electron'
import { createHash } from 'node:crypto'
import { EventEmitter } from 'node:events'
import fs from 'node:fs'
import path from 'node:path'

import type {
  WorkbenchSessionLifecycle,
  WorkbenchSessionSnapshot,
} from '../../shared/electronApiTypes'
import type { NativePreviewSessionLocator } from '../../shared/nativePreviewTypes'
import { DevServerService } from './DevServerService'
import { TerminalService } from './TerminalService'
import { WorkbenchBrowserService } from './WorkbenchBrowserService'
import { NativePreviewManager } from './nativePreview/NativePreviewManager'

interface PersistedWorkbenchSessionRecord {
  projectId: string
  laneId: string
  projectPath: string | null
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
  projectPath: string | null
  lifecycle: WorkbenchSessionLifecycle
  pinned: boolean
  openedAt: number
  lastFocusedAt: number
  lastBackgroundedAt: number | null
  terminalBindings: Record<string, string>
  browserBindings: Record<string, string>
  nativePreviewLocator: NativePreviewSessionLocator | null
}

interface WorkbenchSessionManagerServices {
  browserService: WorkbenchBrowserService
  nativePreviewManager: NativePreviewManager
}

type BackgroundLifecycle = Exclude<WorkbenchSessionLifecycle, 'active' | 'closed'>

const REGISTRY_FILE_NAME = 'workbench-session-registry.json'
const MAX_BACKGROUND_WARM_SESSIONS = 2
const SESSION_POLICY_SWEEP_INTERVAL_MS = 30_000
const BACKGROUND_WARM_IDLE_MS = 2 * 60 * 1000
const BACKGROUND_WARM_ACTIVE_PREVIEW_IDLE_MS = 10 * 60 * 1000
const FROZEN_EPHEMERAL_BROWSER_IDLE_MS = 60 * 1000
const LOW_MEMORY_FREE_THRESHOLD_KB = 1_500_000
const LOW_MEMORY_FREE_RATIO = 0.12

function normalizeProjectPath(projectPath?: string | null): string | null {
  const trimmed = projectPath?.trim()
  if (!trimmed) {
    return null
  }

  const normalized = path.normalize(trimmed).replace(/[\\/]+$/, '')
  if (!normalized) {
    return null
  }

  return process.platform === 'win32' ? normalized.toLowerCase() : normalized
}

function buildWorkspacePathSegment(projectPath?: string | null): string {
  const normalizedPath = normalizeProjectPath(projectPath)
  if (!normalizedPath) {
    return 'unbound'
  }

  const basename = path.basename(normalizedPath).replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '')
  const slug = basename.length > 0 ? basename.slice(0, 48) : 'root'
  const digest = createHash('sha1').update(normalizedPath).digest('hex').slice(0, 12)
  return `${slug}-${digest}`
}

function buildSessionKey(projectId: string, laneId: string, projectPath?: string | null): string {
  return `${projectId.trim()}::${laneId.trim() || 'collab'}::${buildWorkspacePathSegment(projectPath)}`
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

function dedupePersistedSessionPaths(state: PersistedWorkbenchSessionState): boolean {
  const latestOwnerByPath = new Map<string, { sessionKey: string; score: number; projectId: string }>()
  let changed = false

  for (const [sessionKey, record] of Object.entries(state.sessions)) {
    const normalizedPath = normalizeProjectPath(record.projectPath)
    if (!normalizedPath) {
      continue
    }

    const score = Math.max(record.lastFocusedAt, record.openedAt)
    const existingOwner = latestOwnerByPath.get(normalizedPath)
    if (!existingOwner || score >= existingOwner.score) {
      latestOwnerByPath.set(normalizedPath, {
        sessionKey,
        score,
        projectId: record.projectId,
      })
    }
  }

  for (const [sessionKey, record] of Object.entries(state.sessions)) {
    const normalizedPath = normalizeProjectPath(record.projectPath)
    if (!normalizedPath) {
      continue
    }

    const owner = latestOwnerByPath.get(normalizedPath)
    if (!owner || owner.sessionKey === sessionKey || owner.projectId === record.projectId) {
      continue
    }

    state.sessions[sessionKey] = {
      ...record,
      projectPath: null,
    }
    changed = true
  }

  return changed
}

function toPersistedRecord(record: LiveWorkbenchSessionRecord): PersistedWorkbenchSessionRecord {
  return {
    projectId: record.projectId,
    laneId: record.laneId,
    projectPath: record.projectPath,
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
  private readonly browserService: WorkbenchBrowserService
  private readonly nativePreviewManager: NativePreviewManager
  private readonly sessions = new Map<string, LiveWorkbenchSessionRecord>()
  private readonly policySweepTimer: NodeJS.Timeout
  private policySweepInFlight = false

  private logLifecycleTransition(
    sessionKey: string,
    previousLifecycle: WorkbenchSessionLifecycle,
    nextLifecycle: WorkbenchSessionLifecycle,
    reason: string,
  ): void {
    if (previousLifecycle === nextLifecycle) {
      return
    }

    const record = this.sessions.get(sessionKey)
    console.info("[WorkbenchSessionManager] Lifecycle transition", {
      sessionKey,
      projectId: record?.projectId ?? null,
      laneId: record?.laneId ?? null,
      projectPath: record?.projectPath ?? null,
      from: previousLifecycle,
      to: nextLifecycle,
      reason,
    })
  }

  private warnOwnershipMismatch(event: string, details: Record<string, unknown>): void {
    console.warn("[WorkbenchSessionManager] Ownership mismatch", {
      event,
      ...details,
    })
  }

  private constructor(services: WorkbenchSessionManagerServices) {
    super()
    this.browserService = services.browserService
    this.nativePreviewManager = services.nativePreviewManager

    const persisted = readRegistryState()
    if (dedupePersistedSessionPaths(persisted)) {
      writeRegistryState(persisted)
    }

    for (const [, record] of Object.entries(persisted.sessions)) {
      const derivedSessionKey = buildSessionKey(record.projectId, record.laneId, record.projectPath)
      const nextRecord: LiveWorkbenchSessionRecord = {
        ...record,
        projectPath: normalizeProjectPath(record.projectPath),
        lifecycle:
          record.lifecycle === 'active' ? 'backgroundWarm' : record.lifecycle,
        terminalBindings: {},
        browserBindings: {},
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

    dedupePersistedSessionPaths(state)
    writeRegistryState(state)
  }

  private createRecord(input: {
    projectId: string
    laneId: string
    projectPath?: string | null
  }): LiveWorkbenchSessionRecord {
    const now = Date.now()
    return {
      projectId: input.projectId.trim(),
      laneId: input.laneId.trim() || 'collab',
      projectPath: normalizeProjectPath(input.projectPath),
      lifecycle: 'backgroundWarm',
      pinned: false,
      openedAt: now,
      lastFocusedAt: now,
      lastBackgroundedAt: now,
      terminalBindings: {},
      browserBindings: {},
      nativePreviewLocator: null,
    }
  }

  private normalizeProjectPath(projectPath?: string | null): string | null {
    return normalizeProjectPath(projectPath)
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
    projectPath?: string | null
  }): string | null {
    const explicitSessionKey = input.sessionKey?.trim()
    if (explicitSessionKey) {
      return this.sessions.has(explicitSessionKey) ? explicitSessionKey : null
    }

    if (input.projectPath !== undefined) {
      const exactSessionKey = buildSessionKey(input.projectId, input.laneId, input.projectPath)
      if (this.sessions.has(exactSessionKey)) {
        return exactSessionKey
      }
    }

    return this.findLatestSessionKey({
      projectId: input.projectId,
      laneId: input.laneId,
    })
  }

  private async reconcileSessionProjectPath(
    sessionKey: string,
    record: LiveWorkbenchSessionRecord,
    nextProjectPath?: string | null,
  ): Promise<void> {
    if (nextProjectPath === undefined) {
      return
    }

    const normalizedNextProjectPath = this.normalizeProjectPath(nextProjectPath)
    if (record.projectPath === normalizedNextProjectPath) {
      return
    }

    // A live workspace should never be soft-reassigned to another local root.
    // If the caller wants a different root, they must address a different session key.
    if (record.projectPath && normalizedNextProjectPath && record.projectPath !== normalizedNextProjectPath) {
      this.warnOwnershipMismatch("rebind_rejected", {
        sessionKey,
        projectId: record.projectId,
        laneId: record.laneId,
        currentProjectPath: record.projectPath,
        requestedProjectPath: normalizedNextProjectPath,
      })
      return
    }

    if (record.projectPath && normalizedNextProjectPath === null) {
      this.warnOwnershipMismatch("unbind_rejected", {
        sessionKey,
        projectId: record.projectId,
        laneId: record.laneId,
        currentProjectPath: record.projectPath,
      })
      return
    }

    record.projectPath = normalizedNextProjectPath
    this.emitState(sessionKey, record)
  }

  private getBackgroundAge(record: LiveWorkbenchSessionRecord, now = Date.now()): number {
    const baseline = record.lastBackgroundedAt ?? record.lastFocusedAt ?? record.openedAt
    return Math.max(0, now - baseline)
  }

  private hasRunningDevServer(record: LiveWorkbenchSessionRecord): boolean {
    if (!record.projectPath) {
      return false
    }

    return this.devServerService.getState(record.projectPath).running
  }

  private hasRunningNativePreview(record: LiveWorkbenchSessionRecord): boolean {
    if (!record.nativePreviewLocator) {
      return false
    }

    return Boolean(this.nativePreviewManager.getSessionState(record.nativePreviewLocator))
  }

  private hasRetainedPreviewRuntime(record: LiveWorkbenchSessionRecord): boolean {
    return this.hasRunningDevServer(record) || this.hasRunningNativePreview(record)
  }

  private isUnderMemoryPressure(): boolean {
    const electronProcess = process as NodeJS.Process & {
      getSystemMemoryInfo?: () => { free: number; total: number }
    }

    const info = electronProcess.getSystemMemoryInfo?.()
    if (!info || !Number.isFinite(info.free) || !Number.isFinite(info.total) || info.total <= 0) {
      return false
    }

    return info.free <= LOW_MEMORY_FREE_THRESHOLD_KB || info.free / info.total <= LOW_MEMORY_FREE_RATIO
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
          mutated = true
        }

        if (record.lifecycle !== 'backgroundFrozen') {
          continue
        }

        let sessionChanged = false
        const shouldTrimEphemeralBrowsers =
          underMemoryPressure || (!record.pinned && backgroundAge >= FROZEN_EPHEMERAL_BROWSER_IDLE_MS)

        if (shouldTrimEphemeralBrowsers && Object.keys(record.browserBindings).length > 0) {
          for (const [tileId, browserTileId] of Object.entries(record.browserBindings)) {
            const browserState = this.browserService.getState(browserTileId)
            if (browserState?.storageScope !== 'ephemeral') {
              continue
            }

            this.browserService.destroyTile(browserTileId)
            delete record.browserBindings[tileId]
            sessionChanged = true
          }
        }

        if (sessionChanged) {
          this.emitState(sessionKey, record)
          mutated = true
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
    projectPath?: string | null
  }): { sessionKey: string; record: LiveWorkbenchSessionRecord } {
    const providedSessionKey = input.sessionKey?.trim()
    if (providedSessionKey) {
      const existingByExplicitKey = this.sessions.get(providedSessionKey)
      if (existingByExplicitKey) {
        return { sessionKey: providedSessionKey, record: existingByExplicitKey }
      }
    }

    const sessionKey = buildSessionKey(input.projectId, input.laneId, input.projectPath)
    const existing = this.sessions.get(sessionKey)
    if (existing) {
      return { sessionKey, record: existing }
    }

    const created = this.createRecord(input)
    this.sessions.set(sessionKey, created)
    return { sessionKey, record: created }
  }

  private buildSnapshot(
    sessionKey: string,
    record: LiveWorkbenchSessionRecord,
  ): WorkbenchSessionSnapshot {
    const devServer = record.projectPath
      ? this.devServerService.getState(record.projectPath)
      : { running: false, port: null, runId: null }
    const hasBrowserSurface = Object.keys(record.browserBindings).length > 0
    const hasNativePreviewSession = record.nativePreviewLocator
      ? Boolean(this.nativePreviewManager.getSessionState(record.nativePreviewLocator))
      : false

    return {
      sessionKey,
      projectId: record.projectId,
      laneId: record.laneId,
      projectPath: record.projectPath,
      lifecycle: record.lifecycle,
      pinned: record.pinned,
      openedAt: record.openedAt,
      lastFocusedAt: record.lastFocusedAt,
      lastBackgroundedAt: record.lastBackgroundedAt,
      terminalBindings: { ...record.terminalBindings },
      devServer,
      hasBrowserSurface,
      hasNativePreviewSession,
    }
  }

  private emitState(sessionKey: string, record: LiveWorkbenchSessionRecord): WorkbenchSessionSnapshot {
    const snapshot = this.buildSnapshot(sessionKey, record)
    this.emit('stateChanged', snapshot)
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
      }
    }
  }

  async ensureSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    projectPath?: string | null
  }): Promise<WorkbenchSessionSnapshot> {
    const { sessionKey, record } = this.getOrCreateSession(input)
    await this.reconcileSessionProjectPath(sessionKey, record, input.projectPath)
    this.persist()
    const snapshot = this.emitState(sessionKey, record)
    void this.runPolicySweep()
    return snapshot
  }

  async activateSession(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    projectPath?: string | null
  }): Promise<WorkbenchSessionSnapshot> {
    const now = Date.now()
    const { sessionKey, record } = this.getOrCreateSession(input)
    await this.reconcileSessionProjectPath(sessionKey, record, input.projectPath)
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
    this.rebalanceBackgroundSessions(null)
    this.persist()
    void this.runPolicySweep()
    return snapshot
  }

  async closeSession(input: { sessionKey?: string | null; projectId: string; laneId: string }): Promise<boolean> {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) {
      return true
    }
    const record = this.sessions.get(sessionKey)
    if (!record) {
      return true
    }

    for (const terminalId of Object.values(record.terminalBindings)) {
      this.terminalService.killTerminal(terminalId)
    }
    record.terminalBindings = {}

    for (const browserTileId of Object.values(record.browserBindings)) {
      this.browserService.destroyTile(browserTileId)
    }
    record.browserBindings = {}

    if (record.projectPath) {
      await this.devServerService.stop(record.projectPath).catch(() => ({ success: false }))
    }

    if (record.nativePreviewLocator) {
      await this.nativePreviewManager.stopSession(record.nativePreviewLocator).catch(() => ({ success: false }))
      record.nativePreviewLocator = null
    }

    const previousLifecycle = record.lifecycle
    record.lifecycle = 'closed'
    record.lastBackgroundedAt = Date.now()
    this.logLifecycleTransition(sessionKey, previousLifecycle, 'closed', 'close-session')
    this.emitState(sessionKey, record)
    this.sessions.delete(sessionKey)
    this.persist()
    return true
  }

  getSession(input: { sessionKey?: string | null; projectId: string; laneId: string; projectPath?: string | null }): WorkbenchSessionSnapshot | null {
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

    if (record.projectPath && snapshot.projectPath !== record.projectPath) {
      this.warnOwnershipMismatch("terminal_path_mismatch", {
        sessionKey,
        tileId: input.tileId,
        terminalId,
        expectedProjectPath: record.projectPath,
        actualProjectPath: snapshot.projectPath,
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
    projectPath?: string | null
  }): Promise<WorkbenchSessionSnapshot> {
    const { sessionKey, record } = this.getOrCreateSession(input)
    await this.reconcileSessionProjectPath(sessionKey, record, input.projectPath)
    const snapshot = this.terminalService.getTerminalSnapshot(input.terminalId)
    if (record.projectPath && snapshot?.projectPath && snapshot.projectPath !== record.projectPath) {
      this.warnOwnershipMismatch("bind_terminal_rejected", {
        sessionKey,
        tileId: input.tileId,
        terminalId: input.terminalId,
        expectedProjectPath: record.projectPath,
        actualProjectPath: snapshot.projectPath,
      })
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

  getBrowserBinding(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    tileId: string
  }): string | null {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) {
      return null
    }
    const record = this.sessions.get(sessionKey)
    if (!record) {
      return null
    }

    const browserTileId = record.browserBindings[input.tileId]
    if (!browserTileId) {
      return null
    }

    if (!this.browserService.getState(browserTileId)) {
      this.warnOwnershipMismatch("browser_binding_stale", {
        sessionKey,
        tileId: input.tileId,
        browserTileId,
      })
      delete record.browserBindings[input.tileId]
      this.persist()
      this.emitState(sessionKey, record)
      return null
    }

    return browserTileId
  }

  bindBrowser(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    tileId: string
    browserTileId: string
    projectPath?: string | null
  }): WorkbenchSessionSnapshot {
    const { sessionKey, record } = this.getOrCreateSession(input)
    record.browserBindings[input.tileId] = input.browserTileId
    this.persist()
    return this.emitState(sessionKey, record)
  }

  releaseBrowser(input: {
    sessionKey?: string | null
    projectId: string
    laneId: string
    tileId: string
    destroy?: boolean
  }): { success: boolean; browserTileId?: string } {
    const sessionKey = this.resolveSessionKey(input)
    if (!sessionKey) {
      return { success: true }
    }
    const record = this.sessions.get(sessionKey)
    if (!record) {
      return { success: true }
    }

    const browserTileId = record.browserBindings[input.tileId]
    if (!browserTileId) {
      return { success: true }
    }

    delete record.browserBindings[input.tileId]
    if (input.destroy) {
      this.browserService.destroyTile(browserTileId)
    }
    this.persist()
    this.emitState(sessionKey, record)
    return { success: true, browserTileId }
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
      ? `${previousLocator.platform}:${previousLocator.deviceId}:${previousLocator.projectPath}`
      : null
    const nextKey = input.locator
      ? `${input.locator.platform}:${input.locator.deviceId}:${input.locator.projectPath}`
      : null

    if (input.stopPrevious && previousLocator && previousKey !== nextKey) {
      await this.nativePreviewManager.stopSession(previousLocator).catch(() => ({ success: false }))
    }

    record.nativePreviewLocator = input.locator
    this.persist()
    return this.emitState(sessionKey, record)
  }
}
