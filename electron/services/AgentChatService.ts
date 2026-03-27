import { app, ipcMain, BrowserWindow } from 'electron';
import Database from 'better-sqlite3';
import path from 'path';
import fs from 'fs';

export class AgentChatService {
  private db!: Database.Database;

  constructor() {}

  public init() {
    const userDataPath = app.getPath('userData');
    const dbPath = path.join(userDataPath, 'cozea-agent-chat.sqlite');
    this.db = new Database(dbPath);
    this.migrate();
    this.registerIpcHandlers();
  }

  private migrate() {
    this.db.exec(`
      CREATE TABLE IF NOT EXISTS threads (
        id TEXT PRIMARY KEY,
        project_id TEXT NOT NULL,
        title TEXT,
        created_at INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
      );
      
      CREATE TABLE IF NOT EXISTS messages (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        role TEXT NOT NULL,
        text TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        FOREIGN KEY(thread_id) REFERENCES threads(id) ON DELETE CASCADE
      );
      
      CREATE TABLE IF NOT EXISTS tool_calls (
        id TEXT PRIMARY KEY,
        message_id TEXT NOT NULL,
        thread_id TEXT NOT NULL,
        tool_name TEXT NOT NULL,
        input TEXT NOT NULL,
        status TEXT NOT NULL,
        output TEXT,
        error TEXT,
        started_at INTEGER NOT NULL,
        ended_at INTEGER,
        FOREIGN KEY(message_id) REFERENCES messages(id) ON DELETE CASCADE
      );
    `);
  }

  private registerIpcHandlers() {
    ipcMain.handle('agent:chat:threads:list', (event, projectId: string) => {
      const stmt = this.db.prepare('SELECT * FROM threads WHERE project_id = ? ORDER BY updated_at DESC');
      return stmt.all(projectId);
    });

    ipcMain.handle('agent:chat:threads:get', (event, threadId: string) => {
      const thread = this.db.prepare('SELECT * FROM threads WHERE id = ?').get(threadId);
      if (!thread) return null;
      
      const messages = this.db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY created_at ASC').all(threadId);
      const toolCalls = this.db.prepare('SELECT * FROM tool_calls WHERE thread_id = ? ORDER BY started_at ASC').all(threadId);
      
      return { thread, messages, toolCalls };
    });

    ipcMain.handle('agent:chat:threads:create', (event, data: any) => {
      const stmt = this.db.prepare('INSERT INTO threads (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)');
      const now = Date.now();
      stmt.run(data.id, data.projectId, data.title, now, now);
      return { id: data.id, projectId: data.projectId, title: data.title, createdAt: now, updatedAt: now };
    });

    // ... we can add more granular handlers but the UI will just use the frontend store and emit saves
  }
}

export const agentChatService = new AgentChatService();
