const fs = require('fs');
let file = fs.readFileSync('electron/preload.ts', 'utf8');

const oldTerminalMethods = `    onOutput: (callback: (data: { terminalId: string; data: string; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; data: string; runId?: string }) => callback(data)
      ipcRenderer.on('terminal:output', handler)
      return () => ipcRenderer.removeListener('terminal:output', handler)
    },
    onExit: (callback: (data: { terminalId: string; exitCode: number | null; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; exitCode: number | null; runId?: string }) => callback(data)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },`;

const newTerminalMethods = `    onOutput: (callback: (data: { terminalId: string; data: string; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; data: string; runId?: string }) => callback(data)
      ipcRenderer.on('terminal:output', handler)
      return () => ipcRenderer.removeListener('terminal:output', handler)
    },
    onExit: (callback: (data: { terminalId: string; exitCode: number | null; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; exitCode: number | null; runId?: string }) => callback(data)
      ipcRenderer.on('terminal:exit', handler)
      return () => ipcRenderer.removeListener('terminal:exit', handler)
    },
    onActivity: (callback: (data: { terminalId: string; hasRunningSubprocess: boolean; runId?: string }) => void) => {
      const handler = (_event: Electron.IpcRendererEvent, data: { terminalId: string; hasRunningSubprocess: boolean; runId?: string }) => callback(data)
      ipcRenderer.on('terminal:activity', handler)
      return () => ipcRenderer.removeListener('terminal:activity', handler)
    },`;

file = file.replace(oldTerminalMethods, newTerminalMethods);

fs.writeFileSync('electron/preload.ts', file);
