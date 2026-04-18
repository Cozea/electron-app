import { EventEmitter } from 'node:events'
import * as fs from 'node:fs'
import { spawnSync } from 'node:child_process'

import * as pty from '@cozea/pty'

import type {
  TerminalActivityTrackingMode,
  TerminalCreateOptions,
  TerminalInfo,
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
  if (base === 'zsh' || base === 'bash' || base === 'fish') {
    return ['-l']
  }
  return undefined
}

interface ManagedTerminal {
  id: string
  projectPath: string
  runId?: string
  activityTracking: TerminalActivityTrackingMode
  ptyProcess: pty.NativePty
  profile: TerminalProfile
  title: string
  startedAt: number
  endedAt?: number
  exitCode?: number | null
  output: string
  cancelled?: boolean
  timedOut?: boolean
  lastInput?: string
  hasRunningSubprocess?: boolean
  activityPollTimer?: NodeJS.Timeout
}

const MAX_TERMINAL_OUTPUT_LENGTH = 60_000
const TERMINAL_TRUNCATION_MESSAGE = '\n...output truncated...\n'
const TERMINAL_HISTORY_TTL_MS = 30 * 60 * 1000
const TERMINAL_HISTORY_MAX_ENTRIES = 500
const windowsExecutableCache = new Map<string, boolean>()
const DEFAULT_ACTIVITY_TRACKING: TerminalActivityTrackingMode = 'off'

function truncateTerminalOutput(output: string): string {
  if (output.length <= MAX_TERMINAL_OUTPUT_LENGTH) return output
  const tailLength = Math.max(0, MAX_TERMINAL_OUTPUT_LENGTH - TERMINAL_TRUNCATION_MESSAGE.length)
  return `${TERMINAL_TRUNCATION_MESSAGE}${output.slice(-tailLength)}`
}

function appendTerminalOutput(current: string, chunk: string): string {
  return truncateTerminalOutput(current + chunk)
}

function toPtyEnv(env: NodeJS.ProcessEnv, extra?: Record<string, string>): Record<string, string> {
  const merged: NodeJS.ProcessEnv = {
    ...env,
    ...(extra ?? {}),
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
  if (isCapableTerm(resolvedTerm)) return {}
  return {
    TERM: 'xterm-256color',
    COLORTERM: 'truecolor',
  }
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

export class TerminalRuntimeHost extends EventEmitter {
  private readonly terminals = new Map<string, ManagedTerminal>()
  private readonly projectTerminals = new Map<string, string[]>()
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

  private removeProjectTerminal(projectPath: string, terminalId: string): void {
    const ids = this.projectTerminals.get(projectPath) || []
    const remaining = ids.filter((id) => id !== terminalId)
    if (remaining.length > 0) {
      this.projectTerminals.set(projectPath, remaining)
      return
    }
    this.projectTerminals.delete(projectPath)
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
      projectPath: terminal.projectPath,
      runId: terminal.runId,
      command: terminal.lastInput,
      stdout: terminal.output,
      stderr: '',
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
      const cols = options.cols || 80
      const rows = options.rows || 24
      const cwd = options.cwd || options.projectPath

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
        projectPath: options.projectPath,
        runId: options.runId,
        activityTracking: this.normalizeActivityTracking(options.activityTracking),
        title: '',
        startedAt: Date.now(),
        output: '',
      }

      let spawnError: unknown = null
      let selectedProfile = profile
      let ptyProcess: pty.NativePty | null = null

      for (const candidate of candidates) {
        try {
          const profileEnv = { ...(candidate.env ?? {}), ...(options.env ?? {}) }
          const effectiveTerm = profileEnv.TERM ?? runtimeEnv.TERM
          ptyProcess = pty.spawn(
            {
              executable: candidate.path,
              args: candidate.args || [],
              cwd,
              cols,
              rows,
              env: toPtyEnv(runtimeEnv, {
                ...defaultTermEnvForPty(effectiveTerm),
                ...profileEnv,
              }),
            },
            (data) => {
              terminal.output = appendTerminalOutput(terminal.output || '', data)
              this.emitRuntimeEvent({
                type: 'event',
                event: 'terminal.output',
                payload: {
                  terminalId,
                  data,
                  runId: terminal.runId,
                },
              })
            },
            (exitCode) => {
              terminal.exitCode = exitCode ?? null
              terminal.endedAt = Date.now()

              if (terminal.activityPollTimer) {
                clearInterval(terminal.activityPollTimer)
                terminal.activityPollTimer = undefined
              }

              const managedTerminal = terminal as ManagedTerminal
              this.persistTerminalSnapshot(managedTerminal)
              this.terminals.delete(terminalId)
              this.removeProjectTerminal(options.projectPath, terminalId)

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

      const projectTerminals = this.projectTerminals.get(options.projectPath) || []
      projectTerminals.push(terminalId)
      this.projectTerminals.set(options.projectPath, projectTerminals)

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
        error: `Failed to create terminal (profile=${options.profileId ?? 'default'}, path=${options.cwd || options.projectPath}): ${detail}`,
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

    terminal.ptyProcess.write(data)
    return true
  }

  public resizeTerminal(terminalId: string, cols: number, rows: number): { success: boolean } {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return { success: false }
    }

    terminal.ptyProcess.resize(cols, rows)
    return { success: true }
  }

  public killTerminal(terminalId: string): boolean {
    const terminal = this.terminals.get(terminalId)
    if (!terminal) {
      return false
    }

    terminal.cancelled = true
    terminal.endedAt = Date.now()
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

  public listTerminalIds(projectPath: string): string[] {
    return this.projectTerminals.get(projectPath) || []
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
        terminal.cancelled = true
        terminal.endedAt = Date.now()
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
    this.projectTerminals.clear()
  }
}
