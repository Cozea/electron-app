export type AgentChatRole = 'user' | 'assistant' | 'system';

export interface AgentChatMessage {
  id: string;
  threadId: string;
  role: AgentChatRole;
  text: string;
  createdAt: number;
}

export interface AgentChatToolCall {
  id: string;
  messageId: string;
  threadId: string;
  toolName: string;
  input: any;
  status: 'pending' | 'running' | 'success' | 'error';
  output?: string;
  error?: string;
  startedAt: number;
  endedAt?: number;
}

export interface AgentChatThread {
  id: string;
  projectId: string;
  title: string;
  createdAt: number;
  updatedAt: number;
}
