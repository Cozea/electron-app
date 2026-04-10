import { ipcMain, type WebContents } from 'electron'
import * as pty from '@cozea/pty'
import * as fs from 'node:fs'
import { spawnSync } from 'node:child_process'
import { createRuntimeEnv } from '../runtime/runtimeEnv'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { getRuntimePathPrefixes } from '../runtime/runtimeResolver'
import { createIpcOutputBatcher } from '../lib/ipcOutputBatcher'
import type {
    TerminalActivityEvent,
    TerminalExitEvent,
    TerminalOutputEvent,
    TerminalCreateOptions,
} from '../../shared/electronApiTypes'

function shellBasename(shellPath: string): string {
    const name = shellPath.split('/').pop()
    return (name && name.length > 0 ? name : shellPath).toLowerCase()
}

function getLoginShellArgs(shellPath: string): string[] | undefined {
    // Finder-launched Electron apps often miss PATH entries from shell startup files.
    // Launch known shells as login shells so ~/.zprofile, ~/.bash_profile, etc. are loaded.
    const base = shellBasename(shellPath)
    if (base === 'zsh' || base === 'bash' || base === 'fish') {
        return ['-l']
    }
    return undefined
}

export interface TerminalProfile {
    id: string
    name: string
    path: string
    args?: string[]
    env?: Record<string, string>
    icon?: string
}

export interface ManagedTerminal {
    id: string
    projectPath: string
    runId?: string
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

export interface TerminalInfo {
    id: string
    profileId: string
    profileName: string
    title: string
}

export interface TerminalSnapshot {
    id: string
    projectPath: string
    runId?: string
    command?: string
    stdout: string
    stderr: string
    exitCode: number | null
    running: boolean
    startedAt: number
    endedAt: number | null
    timedOut: boolean
    cancelled: boolean
}

interface TerminalObserver {
    onOutput?: (event: TerminalOutputEvent & { projectPath: string }) => void
    onExit?: (event: TerminalExitEvent & { projectPath: string }) => void
    onActivity?: (event: TerminalActivityEvent & { projectPath: string }) => void
}

const MAX_TERMINAL_OUTPUT_LENGTH = 60_000
const TERMINAL_TRUNCATION_MESSAGE = '\n...output truncated...\n'
const TERMINAL_HISTORY_TTL_MS = 30 * 60 * 1000
const TERMINAL_HISTORY_MAX_ENTRIES = 500
const windowsExecutableCache = new Map<string, boolean>()

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

/** GUI / packaged apps often inherit no `TERM` or `TERM=dumb`, which breaks ncurses, colors, and prompts. */
function isCapableTerm(term: string | undefined): boolean {
    if (!term) return false
    const t = term.toLowerCase()
    return t !== 'dumb' && t !== 'unknown'
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
        // Keep classic shells available even if `where` fails unexpectedly.
        const available = executable !== 'pwsh.exe'
        windowsExecutableCache.set(executable, available)
        return available
    }
}

export class TerminalService {
    private static instance: TerminalService
    private terminals = new Map<string, ManagedTerminal>()
    private projectTerminals = new Map<string, string[]>()
    private terminalHistory = new Map<string, TerminalSnapshot>()
    private terminalObservers = new Map<string, Set<TerminalObserver>>()
    private outputTargets = new Set<WebContents>()
    private readonly outputBatcher = createIpcOutputBatcher<{
        terminalId: string
        data: string
        runId?: string
    }>({
        channel: 'terminal:output',
        keyOf: (payload) => payload.terminalId,
        merge: (current, next) => ({
            ...current,
            data: current.data + next.data,
            runId: next.runId ?? current.runId,
        }),
    })

    private constructor() { }

    static getInstance(): TerminalService {
        if (!TerminalService.instance) {
            TerminalService.instance = new TerminalService()
        }
        return TerminalService.instance
    }

    private detectTerminalProfiles(): TerminalProfile[] {
        const profiles: TerminalProfile[] = []
        const seenPaths = new Set<string>()
        const addProfile = (profile: TerminalProfile) => {
            if (seenPaths.has(profile.path)) return
            seenPaths.add(profile.path)
            profiles.push(profile)
        }

        // macOS/Linux shells
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

        // Windows shells
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

        // Node.js (cross-platform)
        profiles.push({ id: 'node', name: 'Node.js', path: 'node', icon: 'symbol-event' })

        return profiles
    }

    private getTerminalProfile(profileId?: string): TerminalProfile {
        const profiles = this.detectTerminalProfiles()
        if (profileId) {
            const profile = profiles.find((p) => p.id === profileId)
            if (profile) return profile
        }
        // Default to first available profile (usually zsh or bash)
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

    private removeProjectTerminal(projectPath: string, terminalId: string) {
        const terms = this.projectTerminals.get(projectPath) || []
        const remaining = terms.filter((id) => id !== terminalId)
        if (remaining.length > 0) {
            this.projectTerminals.set(projectPath, remaining)
        } else {
            this.projectTerminals.delete(projectPath)
        }
    }

    private pruneHistory(now = Date.now()) {
        for (const [id, snapshot] of this.terminalHistory.entries()) {
            const endedAt = snapshot.endedAt ?? snapshot.startedAt
            if (now - endedAt > TERMINAL_HISTORY_TTL_MS) {
                this.terminalHistory.delete(id)
            }
        }

        if (this.terminalHistory.size <= TERMINAL_HISTORY_MAX_ENTRIES) return
        const entries = Array.from(this.terminalHistory.entries())
            .sort((a, b) => {
                const aTime = a[1].endedAt ?? a[1].startedAt
                const bTime = b[1].endedAt ?? b[1].startedAt
                return aTime - bTime
            })
        const overflow = entries.length - TERMINAL_HISTORY_MAX_ENTRIES
        for (let i = 0; i < overflow; i += 1) {
            this.terminalHistory.delete(entries[i][0])
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

    private persistTerminalSnapshot(terminal: ManagedTerminal) {
        this.terminalHistory.set(terminal.id, this.toSnapshot(terminal))
        this.pruneHistory()
    }

    private registerOutputTarget(sender: WebContents): void {
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
            this.outputBatcher.enqueue(target, event)
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

    private emitObserverOutput(terminalId: string, event: TerminalOutputEvent & { projectPath: string }): void {
        const observers = this.terminalObservers.get(terminalId)
        if (!observers) return
        for (const observer of Array.from(observers)) {
            observer.onOutput?.(event)
        }
    }

    private emitObserverExit(terminalId: string, event: TerminalExitEvent & { projectPath: string }): void {
        const observers = this.terminalObservers.get(terminalId)
        if (!observers) return
        for (const observer of Array.from(observers)) {
            observer.onExit?.(event)
        }
    }

    private emitObserverActivity(terminalId: string, event: TerminalActivityEvent & { projectPath: string }): void {
        const observers = this.terminalObservers.get(terminalId)
        if (!observers) return
        for (const observer of Array.from(observers)) {
            observer.onActivity?.(event)
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

    private startActivityPolling(terminal: ManagedTerminal): void {
        if (terminal.activityPollTimer) {
            clearInterval(terminal.activityPollTimer)
        }

        terminal.hasRunningSubprocess = false
        terminal.activityPollTimer = setInterval(() => {
            try {
                const ptyPid = terminal.ptyProcess.getPid()
                if (!ptyPid) return

                const hasActivity = pty.checkSubprocessActivity(ptyPid)
                if (hasActivity === terminal.hasRunningSubprocess) {
                    return
                }

                terminal.hasRunningSubprocess = hasActivity
                const event = {
                    terminalId: terminal.id,
                    hasRunningSubprocess: hasActivity,
                    runId: terminal.runId,
                }
                this.broadcastActivity(event)
                this.emitObserverActivity(terminal.id, {
                    ...event,
                    projectPath: terminal.projectPath,
                })
            } catch {
                // Ignore errors during activity check (for example when the process already exited).
            }
        }, 1000)
    }

    async createTerminal(options: TerminalCreateOptions): Promise<{ success: boolean; terminalId?: string; error?: string }> {
        try {
            const profile = this.getTerminalProfile(options.profileId)
            const profileCandidates = this.getTerminalProfileCandidates(profile)
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
                title: '',
                startedAt: Date.now(),
                output: '',
            }

            let spawnError: unknown = null
            let selectedProfile = profile
            let ptyProcess: pty.NativePty | null = null

            for (const candidate of profileCandidates) {
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
                            let cleanData = data
                            // eslint-disable-next-line no-control-regex
                            cleanData = cleanData.replace(/\x1b\](10|11|12);(?:\?|rgb:)[^\x07\x1b]*(\x07|\x1b\\)/g, '')
                            // eslint-disable-next-line no-control-regex
                            cleanData = cleanData.replace(/\x1b\[6n/g, '')

                            terminal.output = appendTerminalOutput(terminal.output || '', cleanData)
                            const outputEvent = { terminalId, data: cleanData, runId: terminal.runId }
                            this.broadcastOutput(outputEvent)
                            this.emitObserverOutput(terminalId, {
                                ...outputEvent,
                                projectPath: options.projectPath,
                            })
                        },
                        (exitCode) => {
                            terminal.exitCode = exitCode ?? null
                            terminal.endedAt = Date.now()
                            if (terminal.ptyProcess) {
                                this.persistTerminalSnapshot(terminal as ManagedTerminal)
                            }
                            this.terminals.delete(terminalId)
                            this.removeProjectTerminal(options.projectPath, terminalId)
                            if (terminal.activityPollTimer) {
                                clearInterval(terminal.activityPollTimer)
                            }

                            const exitEvent = { terminalId, exitCode, runId: terminal.runId }
                            this.broadcastExit(exitEvent)
                            this.emitObserverExit(terminalId, {
                                ...exitEvent,
                                projectPath: options.projectPath,
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
                throw spawnError instanceof Error
                    ? spawnError
                    : new Error('Unable to spawn terminal process')
            }

            terminal.ptyProcess = ptyProcess
            terminal.profile = selectedProfile
            terminal.title = selectedProfile.name

            this.terminals.set(terminalId, terminal as ManagedTerminal)
            this.startActivityPolling(terminal as ManagedTerminal)

            const projectTerms = this.projectTerminals.get(options.projectPath) || []
            projectTerms.push(terminalId)
            this.projectTerminals.set(options.projectPath, projectTerms)

            return { success: true, terminalId }
        } catch (err) {
            const detail = err instanceof Error ? err.message : 'Failed to create terminal'
            return {
                success: false,
                error: `Failed to create terminal (profile=${options.profileId ?? 'default'}, path=${options.cwd || options.projectPath}): ${detail}`,
            }
        }
    }

    getTerminalSnapshot(terminalId: string): TerminalSnapshot | null {
        const trimmedId = terminalId.trim()
        if (!trimmedId) return null

        const active = this.terminals.get(trimmedId)
        if (active) return this.toSnapshot(active)

        this.pruneHistory()
        return this.terminalHistory.get(trimmedId) ?? null
    }

    async sendInput(terminalId: string, data: string): Promise<boolean> {
        const term = this.terminals.get(terminalId)
        if (!term) return false

        const normalized = data.replace(/\r?\n/g, '').trim()
        if (normalized) {
            term.lastInput = normalized
        }

        term.ptyProcess.write(data)
        return true
    }

    getInfo(terminalId: string): TerminalInfo | null {
        const term = this.terminals.get(terminalId)
        if (!term) return null
        return {
            id: term.id,
            profileId: term.profile.id,
            profileName: term.profile.name,
            title: term.title,
        }
    }

    hasTerminal(terminalId: string): boolean {
        return this.terminals.has(terminalId)
    }

    listTerminalIds(projectPath: string): string[] {
        return this.projectTerminals.get(projectPath) || []
    }

    killTerminal(terminalId: string): boolean {
        const term = this.terminals.get(terminalId)
        if (!term) {
            return false
        }

        term.cancelled = true
        term.endedAt = Date.now()
        term.exitCode = term.exitCode ?? -1
        this.persistTerminalSnapshot(term)
        try {
            term.ptyProcess.kill()
        } catch {
            // Ignore kill errors if process already exited
        }
        if (term.activityPollTimer) {
            clearInterval(term.activityPollTimer)
        }
        this.terminals.delete(terminalId)
        this.terminalObservers.delete(terminalId)
        this.removeProjectTerminal(term.projectPath, terminalId)
        return true
    }

    registerIpcHandlers(): void {
        ipcMain.handle('terminal:create', async (event, options: TerminalCreateOptions) => {
            this.registerOutputTarget(event.sender)
            return this.createTerminal(options)
        })

        ipcMain.handle('terminal:input', async (event, options: { terminalId: string; data: string }) => {
            this.registerOutputTarget(event.sender)
            return await this.sendInput(options.terminalId, options.data)
        })

        ipcMain.handle('terminal:resize', async (event, options: { terminalId: string; cols: number; rows: number }) => {
            this.registerOutputTarget(event.sender)
            const term = this.terminals.get(options.terminalId)
            if (term) {
                term.ptyProcess.resize(options.cols, options.rows)
                return { success: true }
            }
            return { success: false }
        })

        ipcMain.handle('terminal:kill', async (event, options: { terminalId: string }) => {
            this.registerOutputTarget(event.sender)
            return { success: this.killTerminal(options.terminalId) }
        })

        ipcMain.handle('terminal:getProfiles', (event) => {
            this.registerOutputTarget(event.sender)
            return this.detectTerminalProfiles()
        })

        ipcMain.handle('terminal:list', (event, options: { projectPath: string }) => {
            this.registerOutputTarget(event.sender)
            return this.listTerminalIds(options.projectPath)
        })

        ipcMain.handle('terminal:getInfo', (event, options: { terminalId: string }) => {
            this.registerOutputTarget(event.sender)
            return this.getInfo(options.terminalId)
        })

        ipcMain.handle('terminal:getSnapshot', (event, options: { terminalId: string }) => {
            this.registerOutputTarget(event.sender)
            return this.getTerminalSnapshot(options.terminalId)
        })
    }

    // Cleanup all terminals for a project (used by ProjectLayout cleanup)
    killAllForProject(projectPath: string) {
        const ids = this.listTerminalIds(projectPath)
        ids.forEach(id => {
            this.killTerminal(id)
        })
        this.projectTerminals.delete(projectPath)
    }

    // Cleanup all terminals (used on app exit)
    killAll() {
        for (const terminal of this.terminals.values()) {
            try {
                terminal.cancelled = true
                terminal.endedAt = Date.now()
                terminal.exitCode = terminal.exitCode ?? -1
                this.persistTerminalSnapshot(terminal)
                terminal.ptyProcess.kill()
            } catch {
                // Ignore errors
            }
        }
        this.terminals.clear()
        this.projectTerminals.clear()
    }
}
