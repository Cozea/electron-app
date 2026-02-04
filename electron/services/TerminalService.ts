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

    registerIpcHandlers(): void {
        ipcMain.handle('terminal:create', async (_event, options: {
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
                    // Broadcast to all windows (or ideally just the relevant one)
                    // Simple approach: send to all, renderer filters by ID if needed, 
                    // but better is to use `_event.sender` if we want to reply, 
                    // however `onData` is async. For now using broadcast via BrowserWindow.getAllWindows() 
                    // or just assume main window. 
                    // A more robust way is to lookup the WebContents that created the terminal.
                    // For now, we will use a global event bus pattern later or just send to all.
                    // Replicating original `main.ts` behavior:
                    // The original code was using `win?.webContents.send`
                    // We need a way to send back to renderer. 
                    // We can accept a callback or emit an event.
                    // For now, we'll use `ipcMain.emit` or require a WindowManager.
                    // Let's assume we pass the sender to the service or broadcast.
                    // Actually, in best practice service shouldn't directly depend on `win`.
                    // We'll emit an event from the service and let main.ts handle the broadcasting?
                    // Or just import BrowserWindow here.

                    import('electron').then(({ BrowserWindow }) => {
                        BrowserWindow.getAllWindows().forEach(win => {
                            win.webContents.send('terminal:output', { terminalId, data })
                        })
                    })
                })

                ptyProcess.onExit((res) => {
                    this.terminals.delete(terminalId)
                    // cleanup project map
                    const terms = this.projectTerminals.get(options.projectPath) || []
                    this.projectTerminals.set(options.projectPath, terms.filter(t => t !== terminalId))

                    import('electron').then(({ BrowserWindow }) => {
                        BrowserWindow.getAllWindows().forEach(win => {
                            win.webContents.send('terminal:exit', { terminalId, exitCode: res.exitCode })
                        })
                    })
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
                term.ptyProcess.kill()
                this.terminals.delete(options.terminalId)
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
