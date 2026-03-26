const fs = require('fs');

let term = fs.readFileSync('electron/services/TerminalService.ts', 'utf8');

term = term.replace(/import \* as pty from 'node-pty'/g, "import * as pty from '@cozea/pty'");
term = term.replace(/pty\.IPty/g, "pty.NativePty");
term = term.replace(/const cols = options\.cols || 80/g, "const cols = options.cols || 80;");
term = term.replace(/const rows = options\.rows || 24/g, "const rows = options.rows || 24;");

// find spawn
let match = /ptyProcess = pty\.spawn\([\s\S]*?\}\)/.exec(term);
if (match) {
    let spawnCode = match[0];
    spawnCode = `ptyProcess = pty.spawn({
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
                            terminal.output = appendTerminalOutput(terminal.output, data)
                            if (!event.sender.isDestroyed()) {
                                event.sender.send('terminal:output', { terminalId, data, runId: terminal.runId })
                            }
                        }, (exitCode) => {
                            terminal.exitCode = exitCode ?? null
                            terminal.endedAt = Date.now()
                            this.persistTerminalSnapshot(terminal)
                            this.terminals.delete(terminalId)
                            this.removeProjectTerminal(options.projectPath, terminalId)
        
                            if (!event.sender.isDestroyed()) {
                                event.sender.send('terminal:exit', { terminalId, exitCode, runId: terminal.runId })
                            }
                        })`;
    term = term.replace(match[0], spawnCode);
}

// remove onData and onExit listeners since they are passed as callbacks
term = term.replace(/ptyProcess\.onData\(\(data\) => \{[\s\S]*?\}\)/g, '');
term = term.replace(/ptyProcess\.onExit\(\(res\) => \{[\s\S]*?\}\)/g, '');

// The old ptyProcess.write expects string, ours is also write. resize is resize. kill is kill.

fs.writeFileSync('electron/services/TerminalService.ts', term);

