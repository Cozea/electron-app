import { ipcMain, type WebContents } from 'electron'

import type {
  TerminalActivityEvent,
  TerminalActivityTrackingMode,
  TerminalAttachViewResult,
  TerminalCreateOptions,
  TerminalExitEvent,
  TerminalInfo,
  TerminalOutputEvent,
  TerminalSnapshot,
} from '../../../../shared/electronApiTypes'
import { createIpcOutputBatcher } from '../lib/ipcOutputBatcher'
import { TerminalProvenanceService } from './TerminalProvenanceService'
import type {
  WorkbenchRuntimeEventMessage,
  WorkbenchRuntimeTerminalActivityPayload,
  WorkbenchRuntimeTerminalCreateResult,
  WorkbenchRuntimeTerminalExitPayload,
  WorkbenchRuntimeTerminalOutputPayload,
  WorkbenchRuntimeTerminalProvenancePayload,
} from '../workbench-runtime/protocol'
import type { TerminalRuntimeCreateOptions } from '../workbench-runtime/terminalHost'
import { WorkbenchRuntimeClient } from './WorkbenchRuntimeClient'

/**
 * The runtime child always emits a payload that matches its event name, but the
 * wire type {@link WorkbenchRuntimeEventMessage} declares `payload` as a flat
 * union with no correlation to `event`, so a `switch (message.event)` cannot
 * narrow the payload. This correlated view pairs each event with its concrete
 * payload so the dispatch below is type-safe without per-call casts.
 */
type RuntimeEventByName =
  | { event: 'terminal.output'; payload: WorkbenchRuntimeTerminalOutputPayload }
  | { event: 'terminal.activity'; payload: WorkbenchRuntimeTerminalActivityPayload }
  | { event: 'terminal.exit'; payload: WorkbenchRuntimeTerminalExitPayload }
  | { event: 'terminal.provenance'; payload: WorkbenchRuntimeTerminalProvenancePayload }

interface TerminalObserver {
  onOutput?: (event: TerminalOutputEvent & { workspaceId: string }) => void
  onExit?: (event: TerminalExitEvent & { workspaceId: string }) => void
  onActivity?: (event: TerminalActivityEvent & { workspaceId: string }) => void
}

interface TerminalOutputBatch {
  terminalId: string
  events: TerminalOutputEvent[]
}

const MAX_TERMINAL_OUTPUT_LENGTH = 120_000
const MAX_TERMINAL_OUTPUT_LINES = 5000
const MAX_TERMINAL_REPLAY_EVENTS = 500
const TERMINAL_TRUNCATION_MESSAGE = '\n...output truncated...\n'

function truncateTerminalOutput(output: string): string {
  let nextOutput = output
  if (nextOutput.length > MAX_TERMINAL_OUTPUT_LENGTH) {
    const tailLength = Math.max(0, MAX_TERMINAL_OUTPUT_LENGTH - TERMINAL_TRUNCATION_MESSAGE.length)
    nextOutput = `${TERMINAL_TRUNCATION_MESSAGE}${nextOutput.slice(-tailLength)}`
  }

  const lines = nextOutput.split('\n')
  if (lines.length <= MAX_TERMINAL_OUTPUT_LINES) {
    return nextOutput
  }

  return `${TERMINAL_TRUNCATION_MESSAGE}${lines.slice(-MAX_TERMINAL_OUTPUT_LINES).join('\n')}`
}

function appendTerminalOutput(current: string, chunk: string): string {
  return truncateTerminalOutput(current + chunk)
}

export class TerminalService {
  private static instance: TerminalService

  private readonly runtimeClient = WorkbenchRuntimeClient.getInstance()
  private readonly terminalProvenanceService = TerminalProvenanceService.getInstance()
  private readonly terminalObservers = new Map<string, Set<TerminalObserver>>()
  private readonly outputTargets = new Set<WebContents>()
  private readonly terminalSnapshots = new Map<string, TerminalSnapshot>()
  private readonly terminalInfos = new Map<string, TerminalInfo>()
  private readonly workspaceTerminals = new Map<string, string[]>()
  private readonly terminalWorkspaceIds = new Map<string, string>()
  private readonly activeTerminalIds = new Set<string>()
  private readonly terminalOutputEvents = new Map<string, TerminalOutputEvent[]>()
  private readonly outputBatcher = createIpcOutputBatcher<TerminalOutputBatch>({
    channel: 'terminal:output',
    keyOf: (payload) => payload.terminalId,
    merge: (current, next) => ({
      terminalId: current.terminalId,
      events: [...current.events, ...next.events],
    }),
  })

  private constructor() {
    this.runtimeClient.subscribe({
      onEvent: (message) => {
        this.handleRuntimeEvent(message)
      },
      onExit: () => {
        this.handleRuntimeProcessExit()
      },
    })
  }

  static getInstance(): TerminalService {
    if (!TerminalService.instance) {
      TerminalService.instance = new TerminalService()
    }
    return TerminalService.instance
  }

  private addWorkspaceTerminal(workspaceId: string, terminalId: string): void {
    const ids = this.workspaceTerminals.get(workspaceId) ?? []
    if (!ids.includes(terminalId)) {
      ids.push(terminalId)
      this.workspaceTerminals.set(workspaceId, ids)
    }
  }

  private removeWorkspaceTerminal(workspaceId: string, terminalId: string): void {
    const ids = this.workspaceTerminals.get(workspaceId) || []
    const remaining = ids.filter((id) => id !== terminalId)
    if (remaining.length > 0) {
      this.workspaceTerminals.set(workspaceId, remaining)
    } else {
      this.workspaceTerminals.delete(workspaceId)
    }
  }

  /**
   * Drop every per-terminal cache for a destroyed terminal. Exited terminals
   * intentionally retain their snapshot/output for re-attach, so this runs on
   * explicit kill/teardown — not on plain exit — to bound memory over long
   * sessions (snapshot + up to MAX_TERMINAL_REPLAY_EVENTS per terminal).
   */
  private evictTerminalCaches(terminalId: string): void {
    const workspaceId = this.getWorkspaceIdForTerminal(terminalId)
    if (workspaceId) {
      this.removeWorkspaceTerminal(workspaceId, terminalId)
    }
    this.terminalSnapshots.delete(terminalId)
    this.terminalInfos.delete(terminalId)
    this.terminalOutputEvents.delete(terminalId)
    this.terminalWorkspaceIds.delete(terminalId)
    this.activeTerminalIds.delete(terminalId)
    this.terminalObservers.delete(terminalId)
  }

  /**
   * Register a renderer WebContents as a target for terminal output/exit/
   * activity broadcasts. Public so the workspaceId-aware IPC overrides in
   * registerTerminalWorkspaceHandlers can hook the same target the built-in
   * handlers do, without reaching into private state.
   */
  registerOutputTarget(sender: WebContents): void {
    if (sender.isDestroyed()) return
    if (this.outputTargets.has(sender)) return

    this.outputTargets.add(sender)
    sender.once('destroyed', () => {
      this.outputTargets.delete(sender)
    })
  }

  private broadcastOutput(event: TerminalOutputEvent): void {
    for (const target of Array.from(this.outputTargets)) {
      if (target.isDestroyed()) {
        this.outputTargets.delete(target)
        continue
      }
      this.outputBatcher.enqueue(target, {
        terminalId: event.terminalId,
        events: [event],
      })
    }
  }

  private flushOutputTargets(): void {
    for (const target of Array.from(this.outputTargets)) {
      if (target.isDestroyed()) {
        this.outputTargets.delete(target)
        continue
      }
      this.outputBatcher.flush(target)
    }
  }

  private broadcastExit(event: TerminalExitEvent): void {
    this.flushOutputTargets()
    for (const target of Array.from(this.outputTargets)) {
      if (target.isDestroyed()) {
        this.outputTargets.delete(target)
        continue
      }
      target.send('terminal:exit', event)
    }
  }

  private broadcastActivity(event: TerminalActivityEvent): void {
    for (const target of Array.from(this.outputTargets)) {
      if (target.isDestroyed()) {
        this.outputTargets.delete(target)
        continue
      }
      target.send('terminal:activity', event)
    }
  }

  private emitObserverOutput(terminalId: string, event: TerminalOutputEvent & { workspaceId: string }): void {
    const observers = this.terminalObservers.get(terminalId)
    if (!observers) return
    for (const observer of Array.from(observers)) {
      observer.onOutput?.(event)
    }
  }

  private emitObserverExit(terminalId: string, event: TerminalExitEvent & { workspaceId: string }): void {
    const observers = this.terminalObservers.get(terminalId)
    if (!observers) return
    for (const observer of Array.from(observers)) {
      observer.onExit?.(event)
    }
  }

  private emitObserverActivity(terminalId: string, event: TerminalActivityEvent & { workspaceId: string }): void {
    const observers = this.terminalObservers.get(terminalId)
    if (!observers) return
    for (const observer of Array.from(observers)) {
      observer.onActivity?.(event)
    }
  }

  private getWorkspaceIdForTerminal(terminalId: string): string {
    return this.terminalWorkspaceIds.get(terminalId) ?? this.terminalSnapshots.get(terminalId)?.workspaceId ?? ''
  }

  private normalizeSnapshot(snapshot: TerminalSnapshot): TerminalSnapshot {
    return {
      ...snapshot,
      outputSequence: snapshot.outputSequence ?? 0,
      updatedAt: snapshot.updatedAt ?? snapshot.endedAt ?? snapshot.startedAt,
    }
  }

  private syncCacheFromSnapshot(snapshot: TerminalSnapshot, info?: TerminalInfo | null): void {
    const normalizedSnapshot = this.normalizeSnapshot(snapshot)
    this.terminalSnapshots.set(normalizedSnapshot.id, normalizedSnapshot)
    this.terminalWorkspaceIds.set(normalizedSnapshot.id, normalizedSnapshot.workspaceId)
    if (info) {
      this.terminalInfos.set(normalizedSnapshot.id, info)
    }

    if (normalizedSnapshot.running) {
      this.activeTerminalIds.add(normalizedSnapshot.id)
      this.addWorkspaceTerminal(normalizedSnapshot.workspaceId, normalizedSnapshot.id)
      return
    }

    this.activeTerminalIds.delete(normalizedSnapshot.id)
    this.removeWorkspaceTerminal(normalizedSnapshot.workspaceId, normalizedSnapshot.id)
  }

  private recordOutputEvent(event: TerminalOutputEvent): void {
    const events = this.terminalOutputEvents.get(event.terminalId) ?? []
    events.push(event)
    if (events.length > MAX_TERMINAL_REPLAY_EVENTS) {
      events.splice(0, events.length - MAX_TERMINAL_REPLAY_EVENTS)
    }
    this.terminalOutputEvents.set(event.terminalId, events)
  }

  private handleRuntimeOutput(event: TerminalOutputEvent): void {
    this.recordOutputEvent(event)

    const cachedSnapshot = this.terminalSnapshots.get(event.terminalId)
    if (cachedSnapshot) {
      const historyData = event.historyData ?? ''
      this.terminalSnapshots.set(event.terminalId, {
        ...cachedSnapshot,
        stdout: historyData ? appendTerminalOutput(cachedSnapshot.stdout, historyData) : cachedSnapshot.stdout,
        outputSequence: Math.max(cachedSnapshot.outputSequence ?? 0, event.sequence),
        updatedAt: event.createdAt,
      })
    }

    const workspaceId = this.getWorkspaceIdForTerminal(event.terminalId)
    this.broadcastOutput(event)
    this.emitObserverOutput(event.terminalId, {
      ...event,
      workspaceId,
    })
  }

  private handleRuntimeActivity(event: TerminalActivityEvent): void {
    this.terminalProvenanceService.updateActivity({
      terminalId: event.terminalId,
      hasRunningSubprocess: event.hasRunningSubprocess,
      runId: event.runId,
    })
    const workspaceId = this.getWorkspaceIdForTerminal(event.terminalId)
    this.broadcastActivity(event)
    this.emitObserverActivity(event.terminalId, {
      ...event,
      workspaceId,
    })
  }

  private handleRuntimeTerminalExit(event: WorkbenchRuntimeTerminalExitPayload): void {
    const cachedSnapshot = this.terminalSnapshots.get(event.terminalId)
    const nextSnapshot =
      event.snapshot ??
      (cachedSnapshot
        ? {
            ...cachedSnapshot,
            exitCode: event.exitCode ?? null,
            running: false,
            endedAt: Date.now(),
          }
        : null)

    if (nextSnapshot) {
      this.syncCacheFromSnapshot(nextSnapshot, event.info)
    } else {
      this.activeTerminalIds.delete(event.terminalId)
    }

    const workspaceId = nextSnapshot?.workspaceId ?? this.getWorkspaceIdForTerminal(event.terminalId)
    const publicEvent: TerminalExitEvent = {
      terminalId: event.terminalId,
      exitCode: event.exitCode ?? null,
      runId: event.runId,
    }

    this.broadcastExit(publicEvent)
    this.emitObserverExit(event.terminalId, {
      ...publicEvent,
      workspaceId,
    })
    this.terminalProvenanceService.closeTerminal(event.terminalId)
  }

  private handleRuntimeTerminalProvenance(event: WorkbenchRuntimeTerminalProvenancePayload): void {
    this.terminalProvenanceService.registerTerminal({
      terminalId: event.terminalId,
      projectRootPath: event.projectRootPath,
      gitCwd: event.gitCwd,
      title: event.title,
      terminalKind: event.terminalKind,
      runId: event.runId,
      sessionKey: event.sessionKey,
      laneId: event.laneId,
      workspaceId: event.workspaceId,
    })
    this.terminalProvenanceService.recordCommand({
      terminalId: event.terminalId,
      title: event.title,
      commandId: event.commandId,
      commandText: event.commandText,
      runId: event.runId,
      timestamp: event.timestamp,
    })
  }

  private handleRuntimeEvent(message: WorkbenchRuntimeEventMessage): void {
    // `event` is the authoritative discriminant; pair it with its concrete
    // payload so each handler receives a precisely-typed value.
    const runtimeEvent = message as RuntimeEventByName
    switch (runtimeEvent.event) {
      case 'terminal.output':
        this.handleRuntimeOutput(runtimeEvent.payload)
        return
      case 'terminal.activity':
        this.handleRuntimeActivity(runtimeEvent.payload)
        return
      case 'terminal.exit':
        this.handleRuntimeTerminalExit(runtimeEvent.payload)
        return
      case 'terminal.provenance':
        this.handleRuntimeTerminalProvenance(runtimeEvent.payload)
        return
      default:
        return
    }
  }

  private handleRuntimeProcessExit(): void {
    const activeSnapshots = Array.from(this.activeTerminalIds)
      .map((terminalId) => this.terminalSnapshots.get(terminalId))
      .filter((snapshot): snapshot is TerminalSnapshot => Boolean(snapshot))

    this.activeTerminalIds.clear()
    this.workspaceTerminals.clear()

    for (const snapshot of activeSnapshots) {
      this.terminalProvenanceService.closeTerminal(snapshot.id)
      const endedAt = Date.now()
      const nextSnapshot: TerminalSnapshot = {
        ...snapshot,
        running: false,
        exitCode: snapshot.exitCode ?? -1,
        endedAt,
        updatedAt: endedAt,
      }
      this.terminalSnapshots.set(snapshot.id, nextSnapshot)
      this.broadcastExit({
        terminalId: snapshot.id,
        exitCode: nextSnapshot.exitCode,
        runId: snapshot.runId,
      })
      this.emitObserverExit(snapshot.id, {
        terminalId: snapshot.id,
        exitCode: nextSnapshot.exitCode,
        runId: snapshot.runId,
        workspaceId: snapshot.workspaceId,
      })
    }
  }

  subscribe(terminalId: string, observer: TerminalObserver): () => void {
    const trimmedId = terminalId.trim()
    if (!trimmedId) {
      return () => {}
    }

    const observers = this.terminalObservers.get(trimmedId) ?? new Set<TerminalObserver>()
    observers.add(observer)
    this.terminalObservers.set(trimmedId, observers)

    return () => {
      const nextObservers = this.terminalObservers.get(trimmedId)
      if (!nextObservers) return
      nextObservers.delete(observer)
      if (nextObservers.size === 0) {
        this.terminalObservers.delete(trimmedId)
      }
    }
  }

  setActivityTracking(terminalId: string, mode: TerminalActivityTrackingMode | null | undefined): boolean {
    const exists = this.activeTerminalIds.has(terminalId)
    if (!exists) {
      return false
    }

    void this.runtimeClient.request<{ success: boolean }>('terminal.setActivityTracking', {
      terminalId,
      mode,
    }).catch(() => {})
    return true
  }

  async createTerminal(options: TerminalCreateOptions): Promise<WorkbenchRuntimeTerminalCreateResult> {
    return await this.createResolvedTerminal(options)
  }

  async createResolvedTerminal(
    options: TerminalRuntimeCreateOptions,
  ): Promise<WorkbenchRuntimeTerminalCreateResult> {
    const result = await this.runtimeClient.request<WorkbenchRuntimeTerminalCreateResult>('terminal.create', options)
    if (result.success && result.snapshot) {
      this.syncCacheFromSnapshot(result.snapshot, result.info)
      const resolvedOptions = options as TerminalCreateOptions & {
        projectRootPath?: unknown
        cwd?: unknown
        gitCwd?: unknown
      }
      const projectRootPath =
        typeof resolvedOptions.projectRootPath === 'string'
          ? resolvedOptions.projectRootPath
          : typeof resolvedOptions.cwd === 'string'
            ? resolvedOptions.cwd
            : null
      if (projectRootPath) {
        this.terminalProvenanceService.registerTerminal({
          terminalId: result.snapshot.id,
          projectRootPath,
          gitCwd: typeof resolvedOptions.gitCwd === 'string' ? resolvedOptions.gitCwd : projectRootPath,
          title: result.info?.title ?? result.snapshot.id,
          terminalKind: options.terminalKind ?? 'shell',
          runId: options.runId,
          sessionKey: options.sessionKey,
          laneId: options.laneId,
          workspaceId: result.snapshot.workspaceId,
        })
      }
    }
    return result
  }

  async attachView(terminalId: string, cols: number, rows: number): Promise<TerminalAttachViewResult> {
    const baselineSnapshot = this.getTerminalSnapshot(terminalId)
    if (baselineSnapshot?.running === false || !this.hasTerminal(terminalId)) {
      return {
        success: false,
        snapshot: baselineSnapshot ?? null,
        replayEvents: baselineSnapshot
          ? this.getOutputEventsSince(terminalId, baselineSnapshot.outputSequence)
          : [],
      }
    }

    const runtimeResult = await this.runtimeClient.request<{ success: boolean }>('terminal.attachView', {
      terminalId,
      cols,
      rows,
    })
    const snapshot = await this.runtimeClient.request<TerminalSnapshot | null>('terminal.getSnapshot', {
      terminalId,
    })

    if (snapshot) {
      this.syncCacheFromSnapshot(snapshot, this.terminalInfos.get(snapshot.id))
    }

    const hydratedSnapshot = snapshot ?? this.getTerminalSnapshot(terminalId) ?? baselineSnapshot ?? null
    return {
      success: runtimeResult.success,
      snapshot: hydratedSnapshot,
      replayEvents: hydratedSnapshot
        ? this.getOutputEventsSince(terminalId, hydratedSnapshot.outputSequence)
        : [],
    }
  }

  async detachView(terminalId: string): Promise<{ success: boolean }> {
    return await this.runtimeClient.request<{ success: boolean }>('terminal.detachView', {
      terminalId,
    })
  }

  getTerminalSnapshot(terminalId: string): TerminalSnapshot | null {
    return this.terminalSnapshots.get(terminalId) ?? null
  }

  getOutputEventsSince(terminalId: string, afterSequence: number): TerminalOutputEvent[] {
    const events = this.terminalOutputEvents.get(terminalId) ?? []
    return events.filter((event) => event.sequence > afterSequence)
  }

  async sendInput(terminalId: string, data: string): Promise<boolean> {
    return await this.runtimeClient.request<boolean>('terminal.input', { terminalId, data })
  }

  getInfo(terminalId: string): TerminalInfo | null {
    return this.terminalInfos.get(terminalId) ?? null
  }

  hasTerminal(terminalId: string): boolean {
    return this.activeTerminalIds.has(terminalId)
  }

  listTerminalIds(workspaceId: string): string[] {
    return this.workspaceTerminals.get(workspaceId) || []
  }

  killTerminal(terminalId: string): boolean {
    const wasActive = this.activeTerminalIds.has(terminalId)
    if (wasActive) {
      void this.runtimeClient.request<{ success: boolean }>('terminal.kill', { terminalId }).catch(() => {})
    }
    // Free caches whether the terminal was still running or already exited —
    // killing/closing a tile is the teardown signal that retention is over.
    this.evictTerminalCaches(terminalId)
    return wasActive
  }

  registerIpcHandlers(): void {
    ipcMain.handle('terminal:create', async (event, options: TerminalCreateOptions) => {
      this.registerOutputTarget(event.sender)
      const result = await this.createTerminal(options)
      return {
        success: result.success,
        terminalId: result.terminalId,
        error: result.error,
        snapshot: result.snapshot ?? null,
        info: result.info ?? null,
      }
    })

    ipcMain.handle('terminal:attachView', async (event, options: { terminalId: string; cols: number; rows: number }) => {
      this.registerOutputTarget(event.sender)
      return await this.attachView(options.terminalId, options.cols, options.rows)
    })

    ipcMain.handle('terminal:detachView', async (_event, options: { terminalId: string }) => {
      return await this.detachView(options.terminalId)
    })

    ipcMain.handle('terminal:input', async (event, options: { terminalId: string; data: string }) => {
      this.registerOutputTarget(event.sender)
      return await this.sendInput(options.terminalId, options.data)
    })

    ipcMain.handle('terminal:resize', async (event, options: { terminalId: string; cols: number; rows: number }) => {
      this.registerOutputTarget(event.sender)
      return await this.runtimeClient.request<{ success: boolean }>('terminal.resize', options)
    })

    ipcMain.handle('terminal:kill', async (event, options: { terminalId: string }) => {
      this.registerOutputTarget(event.sender)
      return { success: this.killTerminal(options.terminalId) }
    })

    ipcMain.handle('terminal:getProfiles', async (event) => {
      this.registerOutputTarget(event.sender)
      return await this.runtimeClient.request('terminal.getProfiles', {})
    })

    ipcMain.handle('terminal:list', (event, options: { workspaceId: string }) => {
      this.registerOutputTarget(event.sender)
      return this.listTerminalIds(options.workspaceId)
    })

    ipcMain.handle('terminal:getInfo', async (event, options: { terminalId: string }) => {
      this.registerOutputTarget(event.sender)
      const cachedInfo = this.getInfo(options.terminalId)
      if (cachedInfo) {
        return cachedInfo
      }

      const info = await this.runtimeClient.request<TerminalInfo | null>('terminal.getInfo', options)
      if (info) {
        this.terminalInfos.set(info.id, info)
      }
      return info
    })

    ipcMain.handle('terminal:getSnapshot', async (event, options: { terminalId: string }) => {
      this.registerOutputTarget(event.sender)
      const snapshot = await this.runtimeClient.request<TerminalSnapshot | null>('terminal.getSnapshot', options)
      if (snapshot) {
        this.syncCacheFromSnapshot(snapshot, this.terminalInfos.get(snapshot.id))
        return snapshot
      }
      return this.getTerminalSnapshot(options.terminalId)
    })

    ipcMain.handle('terminal:getOutputEventsSince', (event, options: { terminalId: string; afterSequence: number }) => {
      this.registerOutputTarget(event.sender)
      return this.getOutputEventsSince(options.terminalId, options.afterSequence)
    })
  }

  killAllForWorkspace(workspaceId: string): void {
    const terminalIds = this.listTerminalIds(workspaceId)
    for (const terminalId of terminalIds) {
      this.killTerminal(terminalId)
    }
  }

  async stopAllForWorkspace(workspaceId: string): Promise<void> {
    // Retain ownership until the runtime acknowledges termination so a failed
    // stop remains retryable instead of forgetting a living process.
    const ownedTerminals = this.listTerminalIds(workspaceId).slice()
    for (const terminalId of ownedTerminals) {
      const result = await this.runtimeClient.request<{ success: boolean }>('terminal.kill', { terminalId })
      if (!result.success && this.activeTerminalIds.has(terminalId)) throw new Error('A shared workspace terminal could not be stopped')
      this.evictTerminalCaches(terminalId)
    }
  }

  killAll(): void {
    void this.runtimeClient.request<{ success: boolean }>('terminal.killAll', {}).catch(() => {})
    // Clear every per-terminal cache, not just the two that were cleared
    // before — snapshots/infos/output buffers/workspace ids/observers all
    // leaked across a full teardown otherwise.
    this.activeTerminalIds.clear()
    this.workspaceTerminals.clear()
    this.terminalSnapshots.clear()
    this.terminalInfos.clear()
    this.terminalOutputEvents.clear()
    this.terminalWorkspaceIds.clear()
    this.terminalObservers.clear()
    this.runtimeClient.dispose()
  }
}
