const fs = require('fs');
let file = fs.readFileSync('electron/services/TerminalService.ts', 'utf8');

const oldManagerTerminal = `export interface ManagedTerminal {
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
}`;

const newManagerTerminal = `export interface ManagedTerminal {
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
}`;

file = file.replace(oldManagerTerminal, newManagerTerminal);

const oldCreateHandler = `                        ptyProcess = pty.spawn(
                            {
                                executable: candidate.path,
                                args: candidate.args || [],
                                cwd,
                                cols,
                                rows,
                                env: toPtyEnv(runtimeEnv, {
                                    ...(candidate.env ?? {}),
                                    ...(options.env ?? {}),
                                }),
                            },
                            (data) => {
                                terminal.output = appendTerminalOutput(terminal.output || '', data)
                                if (!event.sender.isDestroyed()) {
                                    event.sender.send('terminal:output', { terminalId, data, runId: terminal.runId })
                                }
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
                                if (!event.sender.isDestroyed()) {
                                    event.sender.send('terminal:exit', { terminalId, exitCode, runId: terminal.runId })
                                }
                            }
                        )`;

const newCreateHandler = `                        ptyProcess = pty.spawn(
                            {
                                executable: candidate.path,
                                args: candidate.args || [],
                                cwd,
                                cols,
                                rows,
                                env: toPtyEnv(runtimeEnv, {
                                    ...(candidate.env ?? {}),
                                    ...(options.env ?? {}),
                                }),
                            },
                            (data) => {
                                // Strip aggressive CSI/OSC escape sequences
                                let cleanData = data
                                // Strip OSC color/theme overrides
                                cleanData = cleanData.replace(/\\x1b\\](10|11|12);(?:\\?|rgb:)[^\\x07\\x1b]*(\\x07|\\x1b\\\\)/g, '')
                                // Strip DSR (Device Status Report) requests
                                cleanData = cleanData.replace(/\\x1b\\[6n/g, '')
                                
                                terminal.output = appendTerminalOutput(terminal.output || '', cleanData)
                                if (!event.sender.isDestroyed()) {
                                    event.sender.send('terminal:output', { terminalId, data: cleanData, runId: terminal.runId })
                                }
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
                                if (!event.sender.isDestroyed()) {
                                    event.sender.send('terminal:exit', { terminalId, exitCode, runId: terminal.runId })
                                }
                            }
                        )

                        // Start subprocess activity polling
                        if (ptyProcess) {
                            terminal.hasRunningSubprocess = false
                            terminal.activityPollTimer = setInterval(() => {
                                try {
                                    const ptyPid = ptyProcess!.getPid()
                                    if (!ptyPid) return
                                    
                                    const hasActivity = pty.checkSubprocessActivity(ptyPid)
                                    if (hasActivity !== terminal.hasRunningSubprocess) {
                                        terminal.hasRunningSubprocess = hasActivity
                                        if (!event.sender.isDestroyed()) {
                                            event.sender.send('terminal:activity', { 
                                                terminalId, 
                                                hasRunningSubprocess: hasActivity,
                                                runId: terminal.runId 
                                            })
                                        }
                                    }
                                } catch (e) {
                                    // Ignore errors during activity check (e.g. process died)
                                }
                            }, 1000)
                        }`;

if (file.includes('ptyProcess = pty.spawn(')) {
    // Need to do a more complex regex replacement since the code has some slight variations
    const spawnRegex = /ptyProcess = pty\.spawn\([\s\S]*?\(exitCode\) => \{[\s\S]*?\}\s*\)/m;
    
    // First let's check what exactly is in the file
    const match = file.match(spawnRegex);
    if (match) {
        let spawnBlock = match[0];
        
        // Add CSI/OSC stripping
        spawnBlock = spawnBlock.replace(
            /(terminal\.output = appendTerminalOutput\(terminal\.output \|\| '', )data(\))/,
            `let cleanData = data
                                // Strip OSC color/theme overrides
                                cleanData = cleanData.replace(/\\x1b\\](10|11|12);(?:\\?|rgb:)[^\\x07\\x1b]*(\\x07|\\x1b\\\\)/g, '')
                                // Strip DSR (Device Status Report) requests
                                cleanData = cleanData.replace(/\\x1b\\[6n/g, '')
                                
                                $1cleanData$2`
        );
        
        spawnBlock = spawnBlock.replace(
            /event\.sender\.send\('terminal:output', \{ terminalId, data, runId: terminal\.runId \}\)/,
            "event.sender.send('terminal:output', { terminalId, data: cleanData, runId: terminal.runId })"
        );
        
        // Add the cleanup timer
        spawnBlock = spawnBlock.replace(
            /this\.removeProjectTerminal\(options\.projectPath, terminalId\)/,
            `this.removeProjectTerminal(options.projectPath, terminalId)
                                if (terminal.activityPollTimer) {
                                    clearInterval(terminal.activityPollTimer)
                                }`
        );
        
        // Append the activity poll timer setup
        const pollTimerSetup = `
                        // Start subprocess activity polling
                        if (ptyProcess) {
                            terminal.hasRunningSubprocess = false
                            terminal.activityPollTimer = setInterval(() => {
                                try {
                                    const ptyPid = ptyProcess.getPid()
                                    if (!ptyPid) return
                                    
                                    const hasActivity = pty.checkSubprocessActivity(ptyPid)
                                    if (hasActivity !== terminal.hasRunningSubprocess) {
                                        terminal.hasRunningSubprocess = hasActivity
                                        if (!event.sender.isDestroyed()) {
                                            event.sender.send('terminal:activity', { 
                                                terminalId, 
                                                hasRunningSubprocess: hasActivity,
                                                runId: terminal.runId 
                                            })
                                        }
                                    }
                                } catch (e) {
                                    // Ignore errors during activity check (e.g. process died)
                                }
                            }, 1000)
                        }`;
                        
        file = file.replace(match[0], spawnBlock + pollTimerSetup);
        fs.writeFileSync('electron/services/TerminalService.ts', file);
    } else {
        console.error("Could not find pty.spawn block");
    }
}
