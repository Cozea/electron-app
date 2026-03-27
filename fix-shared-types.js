const fs = require('fs');
let file = fs.readFileSync('shared/electronApiTypes.ts', 'utf8');

const oldTerminalOutputEvent = `export interface TerminalOutputEvent {
  terminalId: string
  data: string
  runId?: string
}`;

const newTerminalOutputEvent = `export interface TerminalOutputEvent {
  terminalId: string
  data: string
  runId?: string
}

export interface TerminalActivityEvent {
  terminalId: string
  hasRunningSubprocess: boolean
  runId?: string
}`;

file = file.replace(oldTerminalOutputEvent, newTerminalOutputEvent);

const oldOnOutput = `    onOutput: (callback: (data: TerminalOutputEvent) => void) => () => void
    onExit: (callback: (data: TerminalExitEvent) => void) => () => void`;

const newOnOutput = `    onOutput: (callback: (data: TerminalOutputEvent) => void) => () => void
    onExit: (callback: (data: TerminalExitEvent) => void) => () => void
    onActivity: (callback: (data: TerminalActivityEvent) => void) => () => void`;

file = file.replace(oldOnOutput, newOnOutput);

fs.writeFileSync('shared/electronApiTypes.ts', file);
