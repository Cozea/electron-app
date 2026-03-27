const fs = require('fs');

let terminal = fs.readFileSync('electron/services/TerminalService.ts', 'utf8');

// The issue is that the callbacks inside pty.spawn reference `terminalId` and `terminal`
// which haven't been declared yet! 

// First, we need to extract the callback functions to happen *after* terminal is created.
// Wait, the Rust `spawn` function takes the callbacks at creation time.
// We have to declare `terminalId` and the `terminal` object BEFORE we call pty.spawn!

let termRepl = `
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
                        ptyProcess = pty.spawn({
                            executable: candidate.path,
                            args: candidate.args || [],
                            cwd,
                            cols,
                            rows,
                            env: toPtyEnv(runtimeEnv, {
                                ...(candidate.env ?? {}),
                                ...(options.env ?? {}),
                                COZEA_RADON_LIB_PATH: resolveRadonLibPath().replace(/\\\\/g, '/'),
                                RADON_IDE_LIB_PATH: resolveRadonLibPath().replace(/\\\\/g, '/'),
                                RCT_DEVTOOLS_PORT: runtimeBridgePort.toString(),
                                REACT_DEVTOOLS_PORT: runtimeBridgePort.toString(),
                            }),
                        }, (data) => {
                            terminal.output = appendTerminalOutput(terminal.output || '', data)
                            if (!event.sender.isDestroyed()) {
                                event.sender.send('terminal:output', { terminalId, data, runId: terminal.runId })
                            }
                        }, (exitCode) => {
                            terminal.exitCode = exitCode ?? null
                            terminal.endedAt = Date.now()
                            if (terminal.ptyProcess) {
                                this.persistTerminalSnapshot(terminal as ManagedTerminal)
                            }
                            this.terminals.delete(terminalId)
                            this.removeProjectTerminal(options.projectPath, terminalId)
        
                            if (!event.sender.isDestroyed()) {
                                event.sender.send('terminal:exit', { terminalId, exitCode, runId: terminal.runId })
                            }
                        })
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
`;

// Find the block to replace
const startMarker = "let spawnError: unknown = null";
const endMarker = "this.terminals.set(terminalId, terminal)";

const startIdx = terminal.indexOf(startMarker);
const endIdx = terminal.indexOf(endMarker) + endMarker.length;

if (startIdx > -1 && endIdx > -1) {
    const before = terminal.slice(0, startIdx);
    const after = terminal.slice(endIdx);
    
    // also remove the old const terminalId = ... above the old this.terminals.set
    let newTerminal = before + termRepl + after;
    
    // Clean up the duplicate terminalId/terminal declarations that might be right before endMarker
    newTerminal = newTerminal.replace(/const terminalId = Math\.random\(\)[\s\S]*?this\.terminals\.set\(terminalId, terminal\)/, '');
    
    fs.writeFileSync('electron/services/TerminalService.ts', newTerminal);
}
