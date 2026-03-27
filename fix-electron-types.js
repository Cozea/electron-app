const fs = require('fs');
let file = fs.readFileSync('shared/electronApiTypes.ts', 'utf8');

if (!file.includes('agentProvider: {')) {
  file = file.replace(
    "export interface ElectronAPI {",
    `export interface ElectronAPI {
  agentProvider: {
    start: (options: any) => Promise<{ ok: boolean; threadId: string }>;
    stop: (threadId: string) => Promise<{ ok: boolean }>;
    onEventStream: (callback: (data: any) => void) => () => void;
  };
  agentChat: {
    listThreads: (projectId: string) => Promise<any[]>;
    getThread: (threadId: string) => Promise<any>;
    createThread: (data: any) => Promise<any>;
  };`
  );
  fs.writeFileSync('shared/electronApiTypes.ts', file);
}
