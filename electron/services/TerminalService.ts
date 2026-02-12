import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'node:fs'
import path from 'node:path'
import { createRuntimeEnv } from '../runtime/runtimeEnv'
import { ensureRuntimeInstalled } from '../runtime/runtimeInstaller'
import { getRuntimePathPrefixes } from '../runtime/runtimeResolver'

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
    ptyProcess: pty.IPty
    profile: TerminalProfile
    title: string
    startedAt: number
    endedAt?: number
    exitCode?: number | null
    output: string
    cancelled?: boolean
    timedOut?: boolean
    lastInput?: string
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

const MAX_TERMINAL_OUTPUT_LENGTH = 60_000
const TERMINAL_TRUNCATION_MESSAGE = '\n...output truncated...\n'
const TERMINAL_HISTORY_TTL_MS = 30 * 60 * 1000
const TERMINAL_HISTORY_MAX_ENTRIES = 500
const SPAWN_HELPER_EXEC_MODE = 0o755

const spawnHelperFixCache = new Map<string, boolean>()

function getNodePtySpawnHelperCandidates(): string[] {
    const target = `${process.platform}-${process.arch}`
    const appRoot = process.env.APP_ROOT || process.cwd()
    return [
        path.join(appRoot, 'node_modules', 'node-pty', 'prebuilds', target, 'spawn-helper'),
        path.join(process.resourcesPath, 'app.asar.unpacked', 'node_modules', 'node-pty', 'prebuilds', target, 'spawn-helper'),
        path.join(process.resourcesPath, 'node_modules', 'node-pty', 'prebuilds', target, 'spawn-helper'),
    ]
}

function ensureNodePtySpawnHelperExecutable(): void {
    if (process.platform === 'win32') return
    const cacheKey = `${process.platform}-${process.arch}`
    if (spawnHelperFixCache.get(cacheKey)) return

    for (const candidate of getNodePtySpawnHelperCandidates()) {
        try {
            if (!fs.existsSync(candidate)) continue
            const stat = fs.statSync(candidate)
            const hasExecBit = (stat.mode & 0o111) !== 0
            if (!hasExecBit) {
                fs.chmodSync(candidate, SPAWN_HELPER_EXEC_MODE)
            }
            spawnHelperFixCache.set(cacheKey, true)
            return
        } catch {
            // Continue trying other candidate paths.
        }
    }
}

function truncateTerminalOutput(output: string): string {
    if (output.length <= MAX_TERMINAL_OUTPUT_LENGTH) return output
    const tailLength = Math.max(0, MAX_TERMINAL_OUTPUT_LENGTH - TERMINAL_TRUNCATION_MESSAGE.length)
    return `${TERMINAL_TRUNCATION_MESSAGE}${output.slice(-tailLength)}`
}

function appendTerminalOutput(current: string, chunk: string): string {
    return truncateTerminalOutput(current + chunk)
}

export class TerminalService {
    private static instance: TerminalService
    private terminals = new Map<string, ManagedTerminal>()
    private projectTerminals = new Map<string, string[]>()
    private terminalHistory = new Map<string, TerminalSnapshot>()

    private constructor() { }

    static getInstance(): TerminalService {
        if (!TerminalService.instance) {
            TerminalService.instance = new TerminalService()
        }
        return TerminalService.instance
    }

    private detectTerminalProfiles(): TerminalProfile[] {
        const profiles: TerminalProfile[] = []

        // macOS/Linux shells
        if (process.platform !== 'win32') {
            if (fs.existsSync('/bin/zsh')) {
                profiles.push({ id: 'zsh', name: 'zsh', path: '/bin/zsh', icon: 'terminal' })
            }
            if (fs.existsSync('/bin/bash')) {
                profiles.push({ id: 'bash', name: 'bash', path: '/bin/bash', icon: 'terminal' })
            }
            if (fs.existsSync('/bin/sh')) {
                profiles.push({ id: 'sh', name: 'sh', path: '/bin/sh', icon: 'terminal' })
            }
        }

        // Windows shells
        if (process.platform === 'win32') {
            profiles.push({ id: 'powershell', name: 'PowerShell', path: 'powershell.exe', icon: 'terminal-powershell' })
            profiles.push({ id: 'cmd', name: 'Command Prompt', path: 'cmd.exe', icon: 'terminal-cmd' })
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

    getTerminalSnapshot(terminalId: string): TerminalSnapshot | null {
        const trimmedId = terminalId.trim()
        if (!trimmedId) return null

        const active = this.terminals.get(trimmedId)
        if (active) return this.toSnapshot(active)

        this.pruneHistory()
        return this.terminalHistory.get(trimmedId) ?? null
    }

    registerIpcHandlers(): void {
        ipcMain.handle('terminal:create', async (event, options: {
            projectPath: string
            profileId?: string
            cwd?: string
            cols?: number
            rows?: number
        }) => {
            try {
                const profile = this.getTerminalProfile(options.profileId)
                const cols = options.cols || 80
                const rows = options.rows || 24
                const cwd = options.cwd || options.projectPath
                if (!cwd || !fs.existsSync(cwd) || !fs.statSync(cwd).isDirectory()) {
                    return { success: false, error: `Terminal working directory does not exist: ${cwd || '(empty)'}` }
                }

                ensureNodePtySpawnHelperExecutable()
                const runtimeEnv = createRuntimeEnv(getRuntimePathPrefixes(), process.env)

                if (profile.id === 'node') {
                    const ensured = await ensureRuntimeInstalled('node')
                    if (!ensured.success) {
                        return { success: false, error: ensured.error ?? 'Node runtime is unavailable.' }
                    }
                }

                const ptyProcess = pty.spawn(profile.path, profile.args || [], {
                    name: 'xterm-256color',
                    cols,
                    rows,
                    cwd,
                    env: {
                        ...runtimeEnv,
                        ...(profile.env ?? {}),
                    } as Record<string, string>,
                })

                const terminalId = Math.random().toString(36).substring(2, 15)
                const terminal: ManagedTerminal = {
                    id: terminalId,
                    projectPath: options.projectPath,
                    ptyProcess,
                    profile,
                    title: profile.name,
                    startedAt: Date.now(),
                    output: '',
                }

                this.terminals.set(terminalId, terminal)

                // Track per project
                const projectTerms = this.projectTerminals.get(options.projectPath) || []
                projectTerms.push(terminalId)
                this.projectTerminals.set(options.projectPath, projectTerms)

                // Setup listeners
                ptyProcess.onData((data) => {
                    terminal.output = appendTerminalOutput(terminal.output, data)
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('terminal:output', { terminalId, data })
                    }
                })

                ptyProcess.onExit((res) => {
                    terminal.exitCode = res.exitCode ?? null
                    terminal.endedAt = Date.now()
                    this.persistTerminalSnapshot(terminal)
                    this.terminals.delete(terminalId)
                    this.removeProjectTerminal(options.projectPath, terminalId)

                    if (!event.sender.isDestroyed()) {
                        event.sender.send('terminal:exit', { terminalId, exitCode: res.exitCode })
                    }
                })

                return { success: true, terminalId }
            } catch (err) {
                const detail = err instanceof Error ? err.message : 'Failed to create terminal'
                return { success: false, error: `Failed to create terminal (profile=${options.profileId ?? 'default'}, path=${options.cwd || options.projectPath}): ${detail}` }
            }
        })

        ipcMain.handle('terminal:input', async (_event, options: { terminalId: string; data: string }) => {
            const term = this.terminals.get(options.terminalId)
            if (term) {
                const normalized = options.data.replace(/\r?\n/g, '').trim()
                if (normalized) {
                    term.lastInput = normalized
                }
                term.ptyProcess.write(options.data)
            }
        })

        ipcMain.handle('terminal:resize', async (_event, options: { terminalId: string; cols: number; rows: number }) => {
            const term = this.terminals.get(options.terminalId)
            if (term) {
                term.ptyProcess.resize(options.cols, options.rows)
                return { success: true }
            }
            return { success: false }
        })

        ipcMain.handle('terminal:kill', async (_event, options: { terminalId: string }) => {
            const term = this.terminals.get(options.terminalId)
            if (term) {
                term.cancelled = true
                term.endedAt = Date.now()
                term.exitCode = term.exitCode ?? -1
                this.persistTerminalSnapshot(term)
                try {
                    term.ptyProcess.kill()
                } catch {
                    // Ignore kill errors if process already exited
                }
                this.terminals.delete(options.terminalId)
                this.removeProjectTerminal(term.projectPath, options.terminalId)
                return { success: true }
            }
            return { success: false }
        })

        ipcMain.handle('terminal:getProfiles', () => {
            return this.detectTerminalProfiles()
        })

        ipcMain.handle('terminal:list', (_event, options: { projectPath: string }) => {
            return this.projectTerminals.get(options.projectPath) || []
        })

        ipcMain.handle('terminal:getInfo', (_event, options: { terminalId: string }) => {
            const term = this.terminals.get(options.terminalId)
            if (!term) return null
            return {
                id: term.id,
                profileId: term.profile.id,
                profileName: term.profile.name,
                title: term.title
            } as TerminalInfo
        })
    }

    // Cleanup all terminals for a project (used by ProjectLayout cleanup)
    killAllForProject(projectPath: string) {
        const ids = this.projectTerminals.get(projectPath) || []
        ids.forEach(id => {
            const term = this.terminals.get(id)
            if (term) {
                term.cancelled = true
                term.endedAt = Date.now()
                term.exitCode = term.exitCode ?? -1
                this.persistTerminalSnapshot(term)
                term.ptyProcess.kill()
                this.terminals.delete(id)
            }
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
