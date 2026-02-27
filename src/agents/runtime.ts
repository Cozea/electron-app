import type { UIMessage } from 'ai'

export type AgentRuntimeKind = 'local'
export type AgentRunStatus = 'running' | 'completed' | 'failed' | 'canceled'

export interface AgentRunRequest {
  runId?: string
  conversationId: string
  organizationId: string
  model: string
  agentId?: 'plan' | 'build'
  surface?: 'wizard' | 'builder' | 'assistant_panel' | 'assistant_project'
  variantId?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  enableTools?: boolean
  enableWebSearch?: boolean
  messages: UIMessage[]
}

export interface AgentRunHandle {
  runId: string
  status: AgentRunStatus
  startedAt: number
}

export interface AgentToolCall {
  toolName: string
  input: Record<string, unknown>
  toolCallId?: string
  projectPath?: string
}

export interface AgentToolResult {
  success: boolean
  output?: unknown
  diagnostics?: unknown
  error?: string
}

export interface AgentCheckpoint {
  runId: string
  label: string
  metadata?: Record<string, unknown>
}

export interface AgentApprovalResponse {
  runId: string
  approvalId: string
  approved: boolean
  reason?: string
}

export interface AgentRuntime {
  kind: AgentRuntimeKind
  startRun(request: AgentRunRequest): Promise<AgentRunHandle>
  streamEvents(runId: string, onEvent: (event: UIMessage) => void): () => void
  requestToolExecution(runId: string, toolCall: AgentToolCall): Promise<AgentToolResult>
  checkpoint(checkpoint: AgentCheckpoint): Promise<void>
  confirm(approval: AgentApprovalResponse): Promise<void>
  cancelRun(runId: string): Promise<void>
  finalizeRun(runId: string): Promise<void>
}
