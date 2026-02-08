import { ipcMain } from 'electron'
import * as pty from 'node-pty'
import * as fs from 'node:fs'

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
}

export interface TerminalInfo {
    id: string
    profileId: string
    profileName: string
    title: string
}

export class TerminalService {
    private static instance: TerminalService
    private terminals = new Map<string, ManagedTerminal>()
    private projectTerminals = new Map<string, string[]>()

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

                const ptyProcess = pty.spawn(profile.path, profile.args || [], {
                    name: 'xterm-256color',
                    cols,
                    rows,
                    cwd,
                    env: process.env as Record<string, string>,
                })

                const terminalId = Math.random().toString(36).substring(2, 15)
                const terminal: ManagedTerminal = {
                    id: terminalId,
                    projectPath: options.projectPath,
                    ptyProcess,
                    profile,
                    title: profile.name,
                }

                this.terminals.set(terminalId, terminal)

                // Track per project
                const projectTerms = this.projectTerminals.get(options.projectPath) || []
                projectTerms.push(terminalId)
                this.projectTerminals.set(options.projectPath, projectTerms)

                // Setup listeners
                ptyProcess.onData((data) => {
                    if (!event.sender.isDestroyed()) {
                        event.sender.send('terminal:output', { terminalId, data })
                    }
                })

                ptyProcess.onExit((res) => {
                    this.terminals.delete(terminalId)
                    this.removeProjectTerminal(options.projectPath, terminalId)

                    if (!event.sender.isDestroyed()) {
                        event.sender.send('terminal:exit', { terminalId, exitCode: res.exitCode })
                    }
                })

                return { success: true, terminalId }
            } catch (err) {
                return { success: false, error: err instanceof Error ? err.message : 'Failed to create terminal' }
            }
        })

        ipcMain.handle('terminal:input', async (_event, options: { terminalId: string; data: string }) => {
            const term = this.terminals.get(options.terminalId)
            if (term) {
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
                terminal.ptyProcess.kill()
            } catch {
                // Ignore errors
            }
        }
        this.terminals.clear()
        this.projectTerminals.clear()
    }
}
