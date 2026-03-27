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
  messageId: string; // The assistant message this belongs to
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

export interface AgentChatEvent {
  type: 'message_added' | 'message_updated' | 'tool_call_started' | 'tool_call_updated' | 'tool_call_finished' | 'text_delta';
  payload: any;
}
