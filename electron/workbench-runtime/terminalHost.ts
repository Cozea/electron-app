import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { spawnSync } from 'node:child_process'

import * as pty from '@cozea/pty'

import type {
  TerminalActivityTrackingMode,
  TerminalCreateOptions,
  TerminalInfo,
  TerminalOutputEvent,
  TerminalProfile,
  TerminalSnapshot,
} from '../../shared/electronApiTypes'
import { createRuntimeEnv } from '../runtime/runtimeEnv'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { getRuntimePathPrefixes } from '../runtime/runtimeResolver'
import type {
  WorkbenchRuntimeEventMessage,
  WorkbenchRuntimeTerminalCreateResult,
  WorkbenchRuntimeTerminalExitPayload,
} from './protocol'

function shellBasename(shellPath: string): string {
  const name = shellPath.split('/').pop()
  return (name && name.length > 0 ? name : shellPath).toLowerCase()
}

function getLoginShellArgs(shellPath: string): string[] | undefined {
  const base = shellBasename(shellPath)
  if (base === 'zsh') {
    return ['-l', '-o', 'nopromptsp']
  }
  if (base === 'bash' || base === 'fish') {
    return ['-l']
  }
  return undefined
}

interface ManagedTerminal {
  id: string
  workspaceId: string
  projectRootPath: string
  gitCwd: string
  runId?: string
  sessionKey?: string
  laneId?: string
  terminalKind: string
  activityTracking: TerminalActivityTrackingMode
  ptyProcess: pty.NativePty
  cols: number
  rows: number
  profile: TerminalProfile
  title: string
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  output: string
  outputSequence: number
  updatedAt: number
  pendingOutputControlSequence: string
  pendingOutputChunks: string[]
  outputDrainScheduled: boolean
  cancelled?: boolean
  timedOut?: boolean
  lastInput?: string
  pendingInputBuffer: string
  lastCommandId?: string
  lastCommandAt?: number
  attachedViewCount: number
  resizeHistorySuppressionUntil?: number
  hasRunningSubprocess?: boolean
  activityPollTimer?: NodeJS.Timeout
}

const MAX_TERMINAL_OUTPUT_LENGTH = 120_000
const MAX_TERMINAL_OUTPUT_LINES = 5000
const TERMINAL_TRUNCATION_MESSAGE = '\n...output truncated...\n'
const TERMINAL_HISTORY_TTL_MS = 30 * 60 * 1000
const TERMINAL_HISTORY_MAX_ENTRIES = 500
const windowsExecutableCache = new Map<string, boolean>()
const DEFAULT_ACTIVITY_TRACKING: TerminalActivityTrackingMode = 'off'
const DEFAULT_TERMINAL_COLS = 120
const DEFAULT_TERMINAL_ROWS = 32
const MIN_TERMINAL_COLS = 2
const MIN_TERMINAL_ROWS = 1
const RESIZE_HISTORY_SUPPRESSION_MS = 500

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

function normalizeTerminalDimension(value: number, minimum: number): number {
  if (!Number.isFinite(value)) {
    return minimum
  }
  return Math.max(minimum, Math.floor(value))
}

export function resolveTerminalResize(
  current: { cols: number; rows: number },
  next: { cols: number; rows: number },
): { cols: number; rows: number } | null {
  const cols = normalizeTerminalDimension(next.cols, MIN_TERMINAL_COLS)
  const rows = normalizeTerminalDimension(next.rows, MIN_TERMINAL_ROWS)

  if (current.cols === cols && current.rows === rows) {
    return null
  }

  return { cols, rows }
}

export function shouldSuppressResizeHistoryChunk(data: string): boolean {
  if (!data) {
    return false
  }

  // Shells often repaint the prompt after SIGWINCH without committing a new line.
  // The live xterm should see that repaint, but snapshots should not grow a fake
  // prompt line every time the renderer remounts and resizes the PTY.
  return !data.includes('\n')
}

function toPtyEnv(env: NodeJS.ProcessEnv, extra?: Record<string, string>): Record<string, string> {
  const merged: NodeJS.ProcessEnv = {
    ...env,
  }
  if (extra) {
    Object.assign(merged, extra)
  }
  const normalized: Record<string, string> = {}
  for (const [key, value] of Object.entries(merged)) {
    if (typeof value === 'string') {
      normalized[key] = value
    }
  }
  return normalized
}

function isCapableTerm(term: string | undefined): boolean {
  if (!term) return false
  const normalized = term.toLowerCase()
  return normalized !== 'dumb' && normalized !== 'unknown'
}

function defaultTermEnvForPty(resolvedTerm: string | undefined): Record<string, string> {
  const term = isCapableTerm(resolvedTerm) && resolvedTerm ? resolvedTerm : 'xterm-256color'
  return {
    TERM: term,
    COLORTERM: 'truecolor',
    CLICOLOR: '1',
  }
}

function colorCapabilityEnvForPty(env: NodeJS.ProcessEnv): Record<string, string> {
  if (env.NO_COLOR !== undefined) {
    return {}
  }

  return {
    FORCE_COLOR: env.FORCE_COLOR ?? '1',
  }
}

function isCsiFinalByte(codePoint: number): boolean {
  return codePoint >= 0x40 && codePoint <= 0x7e
}

function shouldStripCsiSequence(body: string, finalByte: string): boolean {
  if (finalByte === 'n') return true
  if (finalByte === 'R' && /^[0-9;?]*$/.test(body)) return true
  if (finalByte === 'c' && /^[>0-9;?]*$/.test(body)) return true
  return false
}

function shouldStripOscSequence(content: string): boolean {
  return /^(10|11|12);(?:\?|rgb:)/.test(content)
}

function stripStringTerminator(value: string): string {
  if (value.endsWith('\u001b\\')) {
    return value.slice(0, -2)
  }
  const lastCharacter = value.at(-1)
  if (lastCharacter === '\u0007' || lastCharacter === '\u009c') {
    return value.slice(0, -1)
  }
  return value
}

function findStringTerminatorIndex(input: string, start: number): number | null {
  for (let index = start; index < input.length; index += 1) {
    const codePoint = input.charCodeAt(index)
    if (codePoint === 0x07 || codePoint === 0x9c) {
      return index + 1
    }
    if (codePoint === 0x1b && input.charCodeAt(index + 1) === 0x5c) {
      return index + 2
    }
  }
  return null
}

function isEscapeIntermediateByte(codePoint: number): boolean {
  return codePoint >= 0x20 && codePoint <= 0x2f
}

function isEscapeFinalByte(codePoint: number): boolean {
  return codePoint >= 0x30 && codePoint <= 0x7e
}

function findEscapeSequenceEndIndex(input: string, start: number): number | null {
  let cursor = start
  while (cursor < input.length && isEscapeIntermediateByte(input.charCodeAt(cursor))) {
    cursor += 1
  }
  if (cursor >= input.length) {
    return null
  }
  return isEscapeFinalByte(input.charCodeAt(cursor)) ? cursor + 1 : start + 1
}

export function sanitizeTerminalHistoryChunk(
  pendingControlSequence: string,
  data: string,
): { visibleText: string; pendingControlSequence: string } {
  const input = `${pendingControlSequence}${data}`
  let visibleText = ''
  let index = 0

  const append = (value: string) => {
    visibleText += value
  }

  while (index < input.length) {
    const codePoint = input.charCodeAt(index)

    if (codePoint === 0x1b) {
      const nextCodePoint = input.charCodeAt(index + 1)
      if (Number.isNaN(nextCodePoint)) {
        return { visibleText, pendingControlSequence: input.slice(index) }
      }

      if (nextCodePoint === 0x5b) {
        let cursor = index + 2
        while (cursor < input.length) {
          if (isCsiFinalByte(input.charCodeAt(cursor))) {
            const sequence = input.slice(index, cursor + 1)
            const body = input.slice(index + 2, cursor)
            if (!shouldStripCsiSequence(body, input[cursor] ?? '')) {
              append(sequence)
            }
            index = cursor + 1
            break
          }
          cursor += 1
        }
        if (cursor >= input.length) {
          return { visibleText, pendingControlSequence: input.slice(index) }
        }
        continue
      }

      if (
        nextCodePoint === 0x5d ||
        nextCodePoint === 0x50 ||
        nextCodePoint === 0x5e ||
        nextCodePoint === 0x5f
      ) {
        const terminatorIndex = findStringTerminatorIndex(input, index + 2)
        if (terminatorIndex === null) {
          return { visibleText, pendingControlSequence: input.slice(index) }
        }
        const sequence = input.slice(index, terminatorIndex)
        const content = stripStringTerminator(input.slice(index + 2, terminatorIndex))
        if (nextCodePoint !== 0x5d || !shouldStripOscSequence(content)) {
          append(sequence)
        }
        index = terminatorIndex
        continue
      }

      const escapeSequenceEndIndex = findEscapeSequenceEndIndex(input, index + 1)
      if (escapeSequenceEndIndex === null) {
        return { visibleText, pendingControlSequence: input.slice(index) }
      }
      append(input.slice(index, escapeSequenceEndIndex))
      index = escapeSequenceEndIndex
      continue
    }

    append(input[index] ?? '')
    index += 1
  }

  return { visibleText, pendingControlSequence: '' }
}

function isWindowsExecutableAvailable(executable: string): boolean {
  if (process.platform !== 'win32') return false
  const cached = windowsExecutableCache.get(executable)
  if (cached !== undefined) return cached

  try {
    const result = spawnSync('where', [executable], { stdio: 'ignore' })
    const available = result.status === 0
    windowsExecutableCache.set(executable, available)
    return available
  } catch {
    const available = executable !== 'pwsh.exe'
    windowsExecutableCache.set(executable, available)
    return available
  }
}

function checkPosixSubprocessActivity(terminalPid: number): boolean {
  try {
    const pgrepResult = spawnSync('pgrep', ['-P', String(terminalPid)], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
    })

    if (pgrepResult.status === 0) {
      return (pgrepResult.stdout ?? '').trim().length > 0
    }

    if (pgrepResult.status === 1) {
      return false
    }
  } catch {
    // Fall through to the `ps` fallback.
  }

  try {
    const psResult = spawnSync('ps', ['-eo', 'ppid='], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
      timeout: 1000,
      maxBuffer: 262_144,
    })

    if (psResult.status !== 0) {
      return false
    }

    for (const line of (psResult.stdout ?? '').split(/\r?\n/g)) {
      if (Number(line.trim()) === terminalPid) {
        return true
      }
    }
  } catch {
    return false
  }

  return false
}

function checkWindowsSubprocessActivity(terminalPid: number): boolean {
  try {
    const result = spawnSync(
      'powershell.exe',
      [
        '-NoProfile',
        '-NonInteractive',
        '-Command',
        `$children = Get-CimInstance Win32_Process -Filter "ParentProcessId = ${terminalPid}" -ErrorAction SilentlyContinue; if ($children) { exit 0 } exit 1`,
      ],
      {
        stdio: 'ignore',
        timeout: 1500,
      },
    )

    return result.status === 0
  } catch {
    return false
  }
}

function checkTerminalSubprocessActivity(terminalPid: number): boolean {
  if (!Number.isInteger(terminalPid) || terminalPid <= 0) {
    return false
  }

  if (process.platform === 'win32') {
    return checkWindowsSubprocessActivity(terminalPid)
  }

  return checkPosixSubprocessActivity(terminalPid)
}

function extractCompletedCommands(
  pendingBuffer: string,
  chunk: string,
): { nextBuffer: string; commands: string[] } {
  const commands: string[] = []
  let nextBuffer = pendingBuffer

  for (const char of chunk) {
    if (char === '\r' || char === '\n') {
      const completed = nextBuffer.trim()
      if (completed) {
        commands.push(completed)
      }
      nextBuffer = ''
      continue
    }

    if (char === '\b' || char === '\u007f') {
      nextBuffer = nextBuffer.slice(0, -1)
      continue
    }

    if (char < ' ' || char === '\u001b') {
      continue
    }

    nextBuffer += char
    if (nextBuffer.length > 2048) {
      nextBuffer = nextBuffer.slice(-2048)
    }
  }

  return { nextBuffer, commands }
}

export class TerminalRuntimeHost extends EventEmitter {
  private readonly terminals = new Map<string, ManagedTerminal>()
  private readonly workspaceTerminals = new Map<string, string[]>()
  private readonly terminalHistory = new Map<string, TerminalSnapshot>()

  private normalizeActivityTracking(
    mode: TerminalActivityTrackingMode | null | undefined,
  ): TerminalActivityTrackingMode {
    return mode === 'subprocess' ? 'subprocess' : DEFAULT_ACTIVITY_TRACKING
  }

  private detectTerminalProfiles(): TerminalProfile[] {
    const profiles: TerminalProfile[] = []
    const seenPaths = new Set<string>()
    const addProfile = (profile: TerminalProfile) => {
      if (seenPaths.has(profile.path)) return
      seenPaths.add(profile.path)
      profiles.push(profile)
    }

    if (process.platform !== 'win32') {
      const defaultShell = process.env.SHELL
      if (defaultShell && fs.existsSync(defaultShell)) {
        const base = shellBasename(defaultShell)
        addProfile({
          id: 'default',
          name: base,
          path: defaultShell,
          args: getLoginShellArgs(defaultShell),
          icon: 'terminal',
        })
      }

      if (fs.existsSync('/bin/zsh')) {
        addProfile({ id: 'zsh', name: 'zsh', path: '/bin/zsh', args: getLoginShellArgs('/bin/zsh'), icon: 'terminal' })
      }
      if (fs.existsSync('/bin/bash')) {
        addProfile({ id: 'bash', name: 'bash', path: '/bin/bash', args: getLoginShellArgs('/bin/bash'), icon: 'terminal' })
      }
      if (fs.existsSync('/bin/sh')) {
        addProfile({ id: 'sh', name: 'sh', path: '/bin/sh', icon: 'terminal' })
      }
    }

    if (process.platform === 'win32') {
      if (isWindowsExecutableAvailable('pwsh.exe')) {
        profiles.push({ id: 'pwsh', name: 'PowerShell 7', path: 'pwsh.exe', icon: 'terminal-powershell' })
      }
      if (isWindowsExecutableAvailable('cmd.exe')) {
        profiles.push({ id: 'cmd', name: 'Command Prompt', path: 'cmd.exe', icon: 'terminal-cmd' })
      }
      if (isWindowsExecutableAvailable('powershell.exe')) {
        profiles.push({ id: 'powershell', name: 'PowerShell', path: 'powershell.exe', icon: 'terminal-powershell' })
      }
    }

    profiles.push({ id: 'node', name: 'Node.js', path: 'node', icon: 'symbol-event' })

    return profiles
  }

  private getTerminalProfile(profileId?: string): TerminalProfile {
    const profiles = this.detectTerminalProfiles()
    if (profileId) {
      const profile = profiles.find((candidate) => candidate.id === profileId)
      if (profile) {
        return profile
      }
    }
    return profiles[0] || { id: 'sh', name: 'sh', path: '/bin/sh', icon: 'terminal' }
  }

  private getTerminalProfileCandidates(primary: TerminalProfile): TerminalProfile[] {
    const allProfiles = this.detectTerminalProfiles()
    const candidates: TerminalProfile[] = [primary]
    if (primary.id === 'node') return candidates

    for (const fallback of allProfiles) {
      if (fallback.id === primary.id) continue
      if (fallback.id === 'node') continue
      candidates.push(fallback)
    }

    return candidates
  }

  private removeWorkspaceTerminal(workspaceId: string, terminalId: string): void {
    const ids = this.workspaceTerminals.get(workspaceId) || []
    const remaining = ids.filter((id) => id !== terminalId)
    if (remaining.length > 0) {
      this.workspaceTerminals.set(workspaceId, remaining)
      return
    }
    this.workspaceTerminals.delete(workspaceId)
  }

  private pruneHistory(now = Date.now()): void {
    for (const [terminalId, snapshot] of this.terminalHistory.entries()) {
      const endedAt = snapshot.endedAt ?? snapshot.startedAt
      if (now - endedAt > TERMINAL_HISTORY_TTL_MS) {
        this.terminalHistory.delete(terminalId)
      }
    }

    if (this.terminalHistory.size <= TERMINAL_HISTORY_MAX_ENTRIES) {
      return
    }

    const entries = Array.from(this.terminalHistory.entries()).sort((left, right) => {
      const leftTime = left[1].endedAt ?? left[1].startedAt
      const rightTime = right[1].endedAt ?? right[1].startedAt
      return leftTime - rightTime
    })
    const overflow = entries.length - TERMINAL_HISTORY_MAX_ENTRIES
    for (let index = 0; index < overflow; index += 1) {
      this.terminalHistory.delete(entries[index][0])
    }
  }

  private toSnapshot(terminal: ManagedTerminal): TerminalSnapshot {
    return {
      id: terminal.id,
      workspaceId: terminal.workspaceId,
      runId: terminal.runId,
      command: terminal.lastInput,
      stdout: terminal.output,
      stderr: '',
      outputSequence: terminal.outputSequence,
      updatedAt: terminal.updatedAt,
      exitCode: terminal.exitCode ?? null,
      running: terminal.endedAt === undefined,
      startedAt: terminal.startedAt,
      endedAt: terminal.endedAt ?? null,
      timedOut: terminal.timedOut ?? false,
      cancelled: terminal.cancelled ?? false,
    }
  }

  private getInfoFromTerminal(terminal: ManagedTerminal): TerminalInfo {
    return {
      id: terminal.id,
      profileId: terminal.profile.id,
      profileName: terminal.profile.name,
      title: terminal.title,
    }
  }

  private persistTerminalSnapshot(terminal: ManagedTerminal): void {
    this.terminalHistory.set(terminal.id, this.toSnapshot(terminal))
    this.pruneHistory()
  }

  private emitRuntimeEvent(message: WorkbenchRuntimeEventMessage): void {
    this.emit('event', message)
  }

  private applyTerminalOutputChunk(terminal: Partial<ManagedTerminal>, data: string): void {
    if (!terminal.id) {
      return
    }

    const sanitized = sanitizeTerminalHistoryChunk(
      terminal.pendingOutputControlSequence || '',
      data,
    )
    terminal.pendingOutputControlSequence = sanitized.pendingControlSequence

    const now = Date.now()
    const suppressResizeHistory =
      terminal.resizeHistorySuppressionUntil !== undefined &&
      now <= terminal.resizeHistorySuppressionUntil &&
      shouldSuppressResizeHistoryChunk(data)

    const historyData =
      !suppressResizeHistory && sanitized.visibleText.length > 0
        ? sanitized.visibleText
        : ''

    if (historyData.length > 0) {
      terminal.output = appendTerminalOutput(terminal.output || '', historyData)
    }

    const sequence = (terminal.outputSequence ?? 0) + 1
    terminal.outputSequence = sequence
    terminal.updatedAt = now

    const payload: TerminalOutputEvent = {
      terminalId: terminal.id,
      data,
      sequence,
      createdAt: now,
      historyData,
      runId: terminal.runId,
    }

    this.emitRuntimeEvent({
      type: 'event',
      event: 'terminal.output',
      payload,
    })
  }

  private drainTerminalOutput(terminal: Partial<ManagedTerminal>): void {
    terminal.outputDrainScheduled = false
    const chunks = terminal.pendingOutputChunks ?? []
    if (chunks.length === 0) {
      return
    }

    terminal.pendingOutputChunks = []
    for (const chunk of chunks) {
      this.applyTerminalOutputChunk(terminal, chunk)
    }
  }

  private enqueueTerminalOutput(terminal: Partial<ManagedTerminal>, data: string): void {
    terminal.pendingOutputChunks = [...(terminal.pendingOutputChunks ?? []), data]
    if (terminal.outputDrainScheduled) {
      return
    }

    terminal.outputDrainScheduled = true
    setImmediate(() => {
      this.drainTerminalOutput(terminal)
    })
  }

  private emitTerminalProvenance(
    terminal: ManagedTerminal,
    payload?: {
      commandId?: string
      commandText?: string
      timestamp?: number
    },
  ): void {
    this.emitRuntimeEvent({
      type: 'event',
      event: 'terminal.provenance',
      payload: {
        terminalId: terminal.id,
        workspaceId: terminal.workspaceId,
        projectRootPath: terminal.projectRootPath,
        gitCwd: terminal.gitCwd,
        title: terminal.title,
        terminalKind: terminal.terminalKind,
        sessionKey: terminal.sessionKey,
        laneId: terminal.laneId,
        runId: terminal.runId,
        commandId: payload?.commandId,
        commandText: payload?.commandText,
        timestamp: payload?.timestamp ?? Date.now(),
      },
    })
  }

  private startActivityPolling(terminal: ManagedTerminal): void {
    if (terminal.activityTracking !== 'subprocess') {
      if (terminal.activityPollTimer) {
        clearInterval(terminal.activityPollTimer)
        terminal.activityPollTimer = undefined
      }

      if (terminal.hasRunningSubprocess) {
        terminal.hasRunningSubprocess = false
        this.emitRuntimeEvent({
          type: 'event',
          event: 'terminal.activity',
          payload: {
            terminalId: terminal.id,
            hasRunningSubprocess: false,
            runId: terminal.runId,
          },
        })
      }
      return
    }

    if (terminal.activityPollTimer) {
      clearInterval(terminal.activityPollTimer)
    }

    terminal.hasRunningSubprocess = false
    terminal.activityPollTimer = setInterval(() => {
      try {
        const ptyPid = terminal.ptyProcess.getPid()
        if (!ptyPid) return

        const hasActivity = checkTerminalSubprocessActivity(ptyPid)
        if (hasActivity === terminal.hasRunningSubprocess) {
          return
        }

        terminal.hasRunningSubprocess = hasActivity
        this.emitRuntimeEvent({
          type: 'event',
          event: 'terminal.activity',
          payload: {
            terminalId: terminal.id,
            hasRunningSubprocess: hasActivity,
            runId: terminal.runId,
          },
        })
      } catch {
        // Ignore activity probe failures after process exit.
      }
    }, 1000)
  }

  public setActivityTracking(terminalId: string, mode: TerminalActivityTrackingMode | null | undefined): boolean {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return false
    }

    const normalizedMode = this.normalizeActivityTracking(mode)
    if (terminal.activityTracking === normalizedMode) {
      return true
    }

    terminal.activityTracking = normalizedMode
    this.startActivityPolling(terminal)
    return true
  }

  public async createTerminal(options: TerminalCreateOptions): Promise<WorkbenchRuntimeTerminalCreateResult> {
    try {
      const profile = this.getTerminalProfile(options.profileId)
      const candidates = this.getTerminalProfileCandidates(profile)
      const cols = normalizeTerminalDimension(options.cols ?? DEFAULT_TERMINAL_COLS, MIN_TERMINAL_COLS)
      const rows = normalizeTerminalDimension(options.rows ?? DEFAULT_TERMINAL_ROWS, MIN_TERMINAL_ROWS)
      const cwd = typeof options.cwd === 'string' ? options.cwd : (options as any).projectRootPath
      const projectRootPath =
        typeof (options as any).projectRootPath === 'string'
          ? (options as any).projectRootPath
          : cwd

      if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
        return { success: false, error: `Terminal working directory does not exist: ${cwd || '(empty)'}` }
      }

      const runtimeEnv = createRuntimeEnv(getRuntimePathPrefixes(), process.env)
      if (profile.id === 'node') {
        const ensured = await ensureRuntimeInstalled('node')
        if (!ensured.success) {
          return { success: false, error: ensured.error ?? 'Node runtime is unavailable.' }
        }
      }

      const terminalId = Math.random().toString(36).substring(2, 15)
      const terminal: Partial<ManagedTerminal> = {
        id: terminalId,
        workspaceId: options.workspaceId,
        projectRootPath,
        gitCwd: typeof options.gitCwd === 'string' ? options.gitCwd : cwd,
        runId: options.runId,
        sessionKey: options.sessionKey,
        laneId: options.laneId,
        terminalKind: options.terminalKind ?? 'shell',
        activityTracking: this.normalizeActivityTracking(options.activityTracking),
        cols,
        rows,
        title: '',
        startedAt: Date.now(),
        output: '',
        outputSequence: 0,
        updatedAt: Date.now(),
        pendingOutputControlSequence: '',
        pendingOutputChunks: [],
        outputDrainScheduled: false,
        pendingInputBuffer: '',
        attachedViewCount: 0,
      }

      let spawnError: unknown = null
      let selectedProfile = profile
      let ptyProcess: pty.NativePty | null = null

      for (const candidate of candidates) {
        try {
          const profileEnv: Record<string, string> = {}
          if (candidate.env) {
            Object.assign(profileEnv, candidate.env)
          }
          if (options.env) {
            Object.assign(profileEnv, options.env)
          }
          const effectiveTerm = profileEnv.TERM ?? runtimeEnv.TERM
          const colorEnv = colorCapabilityEnvForPty({ ...runtimeEnv, ...profileEnv })
          ptyProcess = pty.spawn(
            {
              executable: candidate.path,
              args: candidate.args || [],
              cwd,
              cols,
              rows,
              env: toPtyEnv(runtimeEnv, {
                ...defaultTermEnvForPty(effectiveTerm),
                ...colorEnv,
                ...profileEnv,
              }),
            },
            (data) => {
              this.enqueueTerminalOutput(terminal, data)
            },
            (exitCode) => {
              this.drainTerminalOutput(terminal)
              terminal.exitCode = exitCode ?? null
              terminal.endedAt = Date.now()
              terminal.updatedAt = terminal.endedAt

              if (terminal.activityPollTimer) {
                clearInterval(terminal.activityPollTimer)
                terminal.activityPollTimer = undefined
              }
              terminal.pendingOutputControlSequence = ''

              const managedTerminal = terminal as ManagedTerminal
              this.persistTerminalSnapshot(managedTerminal)
              this.terminals.delete(terminalId)
              this.removeWorkspaceTerminal(options.workspaceId, terminalId)

              const payload: WorkbenchRuntimeTerminalExitPayload = {
                terminalId,
                exitCode,
                runId: terminal.runId,
                snapshot: this.toSnapshot(managedTerminal),
                info: this.getInfoFromTerminal(managedTerminal),
              }
              this.emitRuntimeEvent({
                type: 'event',
                event: 'terminal.exit',
                payload,
              })
            },
          )
          selectedProfile = candidate
          break
        } catch (error) {
          spawnError = error
        }
      }

      if (!ptyProcess) {
        throw spawnError instanceof Error ? spawnError : new Error('Unable to spawn terminal process')
      }

      terminal.ptyProcess = ptyProcess
      terminal.profile = selectedProfile
      terminal.title = selectedProfile.name

      const managedTerminal = terminal as ManagedTerminal
      this.terminals.set(terminalId, managedTerminal)
      this.startActivityPolling(managedTerminal)
      this.emitTerminalProvenance(managedTerminal)

      const workspaceTerminals = this.workspaceTerminals.get(options.workspaceId) || []
      workspaceTerminals.push(terminalId)
      this.workspaceTerminals.set(options.workspaceId, workspaceTerminals)

      return {
        success: true,
        terminalId,
        snapshot: this.toSnapshot(managedTerminal),
        info: this.getInfoFromTerminal(managedTerminal),
      }
    } catch (error) {
      const detail = error instanceof Error ? error.message : 'Failed to create terminal'
      return {
        success: false,
        error: `Failed to create terminal (profile=${options.profileId ?? 'default'}, path=${options.cwd || options.workspaceId}): ${detail}`,
      }
    }
  }

  public async sendInput(terminalId: string, data: string): Promise<boolean> {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return false
    }

    const normalized = data.replace(/\r?\n/g, '').trim()
    if (normalized) {
      terminal.lastInput = normalized
    }

    const { nextBuffer, commands } = extractCompletedCommands(terminal.pendingInputBuffer, data)
    terminal.pendingInputBuffer = nextBuffer
    for (const commandText of commands) {
      const timestamp = Date.now()
      const commandId = `cmd_${Math.random().toString(36).slice(2, 10)}_${timestamp.toString(36)}`
      terminal.lastCommandId = commandId
      terminal.lastCommandAt = timestamp
      terminal.lastInput = commandText
      this.emitTerminalProvenance(terminal, {
        commandId,
        commandText,
        timestamp,
      })
    }

    terminal.ptyProcess.write(data)
    return true
  }

  public attachTerminalView(terminalId: string, cols: number, rows: number): { success: boolean } {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return { success: false }
    }

    terminal.attachedViewCount += 1
    return this.resizeTerminal(terminalId, cols, rows)
  }

  public detachTerminalView(terminalId: string): { success: boolean } {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return { success: false }
    }

    terminal.attachedViewCount = Math.max(0, terminal.attachedViewCount - 1)
    return { success: true }
  }

  public resizeTerminal(terminalId: string, cols: number, rows: number): { success: boolean } {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return { success: false }
    }

    const nextSize = resolveTerminalResize(terminal, { cols, rows })
    if (!nextSize) {
      return { success: true }
    }

    terminal.cols = nextSize.cols
    terminal.rows = nextSize.rows
    terminal.resizeHistorySuppressionUntil = Date.now() + RESIZE_HISTORY_SUPPRESSION_MS
    terminal.ptyProcess.resize(nextSize.cols, nextSize.rows)
    return { success: true }
  }

  public killTerminal(terminalId: string): boolean {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return false
    }

    this.drainTerminalOutput(terminal)
    terminal.cancelled = true
    terminal.endedAt = Date.now()
    terminal.updatedAt = terminal.endedAt
    terminal.exitCode = terminal.exitCode ?? -1
    this.persistTerminalSnapshot(terminal)
    try {
      terminal.ptyProcess.kill()
    } catch {
      // Ignore duplicate termination.
    }

    if (terminal.activityPollTimer) {
      clearInterval(terminal.activityPollTimer)
      terminal.activityPollTimer = undefined
    }

    return true
  }

  public listTerminalIds(workspaceId: string): string[] {
    return this.workspaceTerminals.get(workspaceId) || []
  }

  public getInfo(terminalId: string): TerminalInfo | null {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return null
    }
    return this.getInfoFromTerminal(terminal)
  }

  public getTerminalSnapshot(terminalId: string): TerminalSnapshot | null {
    const trimmedId = terminalId.trim()
    if (!trimmedId) return null

    const active = this.terminals.get(trimmedId)
    if (active) return this.toSnapshot(active)

    this.pruneHistory()
    return this.terminalHistory.get(trimmedId) ?? null
  }

  public getProfiles(): TerminalProfile[] {
    return this.detectTerminalProfiles()
  }

  public killAll(): void {
    for (const terminal of this.terminals.values()) {
      try {
        this.drainTerminalOutput(terminal)
        terminal.cancelled = true
        terminal.endedAt = Date.now()
        terminal.updatedAt = terminal.endedAt
        terminal.exitCode = terminal.exitCode ?? -1
        this.persistTerminalSnapshot(terminal)
        terminal.ptyProcess.kill()
      } catch {
        // Ignore repeated cleanup failures.
      }

      if (terminal.activityPollTimer) {
        clearInterval(terminal.activityPollTimer)
        terminal.activityPollTimer = undefined
      }
    }

    this.terminals.clear()
    this.workspaceTerminals.clear()
  }
}
