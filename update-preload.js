const fs = require('fs');
let preload = fs.readFileSync('electron/preload.ts', 'utf8');

const agentApi = `
  agentProvider: {
    start: (options: any) => ipcRenderer.invoke('agent:start', options),
    stop: (threadId: string) => ipcRenderer.invoke('agent:stop', threadId),
    onEventStream: (callback: (data: any) => void) => {
      const handler = (_event: any, data: any) => callback(data);
      ipcRenderer.on('agent:event:stream', handler);
      return () => ipcRenderer.removeListener('agent:event:stream', handler);
    }
  },
  agentChat: {
    listThreads: (projectId: string) => ipcRenderer.invoke('agent:chat:threads:list', projectId),
    getThread: (threadId: string) => ipcRenderer.invoke('agent:chat:threads:get', threadId),
    createThread: (data: any) => ipcRenderer.invoke('agent:chat:threads:create', data),
    // more as needed
  },
`;

preload = preload.replace(
  "  system: {",
  agentApi + "  system: {"
);

fs.writeFileSync('electron/preload.ts', preload);
