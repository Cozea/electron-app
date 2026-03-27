import { ipcMain, BrowserWindow } from 'electron';
import { query, SDKMessage } from '@anthropic-ai/claude-agent-sdk';

export interface ProviderStartOptions {
  threadId: string;
  projectId: string;
  projectPath: string;
  prompt: string;
  options?: any;
}

export class AgentProviderService {
  private activeQueries = new Map<string, any>(); // threadId -> query handle
  private window: BrowserWindow | null = null;

  constructor() {}

  public setWindow(win: BrowserWindow) {
    this.window = win;
  }

  public registerIpcHandlers() {
    ipcMain.handle('agent:start', async (event, options: ProviderStartOptions) => {
      return this.startQuery(options);
    });

    ipcMain.handle('agent:stop', async (event, threadId: string) => {
      return this.stopQuery(threadId);
    });
  }

  public async startQuery(options: ProviderStartOptions) {
    if (this.activeQueries.has(options.threadId)) {
      await this.stopQuery(options.threadId);
    }

    console.log(`Starting Claude Agent SDK for thread ${options.threadId} in ${options.projectPath}`);
    
    // We run the SDK programmatic query
    const abortController = new AbortController();
    
    const q = query({
      prompt: options.prompt,
      cwd: options.projectPath,
      abortController,
      // For now, auto-allow edits or prompt? We'll bypass for now or map to our UI.
      permissionMode: 'acceptEdits',
      includePartialMessages: true,
      agentProgressSummaries: true
    });
    
    this.activeQueries.set(options.threadId, { query: q, abortController });

    // We consume the AsyncGenerator from query
    this.consumeQueryStream(options.threadId, q, abortController);

    return { ok: true, threadId: options.threadId };
  }

  private async consumeQueryStream(threadId: string, q: AsyncGenerator<SDKMessage, any, unknown>, abortController: AbortController) {
    try {
      for await (const message of q) {
        if (!this.activeQueries.has(threadId)) {
          break; // Stopped
        }
        
        // Stream stdout if it's a CLI toggle thing, but right now we just emit IPC
        this.emitToFrontend('agent:event:stream', {
          threadId,
          type: message.type,
          payload: message,
        });
      }
    } catch (error: any) {
      console.error(`AgentProviderService error for thread ${threadId}:`, error);
      this.emitToFrontend('agent:event:stream', {
        threadId,
        type: 'error',
        payload: { message: error?.message || 'Unknown error' },
      });
    } finally {
      this.activeQueries.delete(threadId);
      this.emitToFrontend('agent:event:stream', {
        threadId,
        type: 'exited',
        payload: {},
      });
    }
  }

  public async stopQuery(threadId: string) {
    const session = this.activeQueries.get(threadId);
    if (session) {
      session.abortController.abort();
      this.activeQueries.delete(threadId);
      this.emitToFrontend('agent:event:stream', {
        threadId,
        type: 'exited',
        payload: { reason: 'stopped_by_user' },
      });
    }
    return { ok: true };
  }

  private emitToFrontend(channel: string, data: any) {
    if (this.window && !this.window.isDestroyed()) {
      this.window.webContents.send(channel, data);
    }
  }
}

export const agentProviderService = new AgentProviderService();
