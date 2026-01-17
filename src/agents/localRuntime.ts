import type {
  AgentApprovalResponse,
  AgentCheckpoint,
  AgentRunHandle,
  AgentRunRequest,
  AgentRuntime,
  AgentToolCall,
  AgentToolResult,
} from './runtime'

export class LocalAgentRuntime implements AgentRuntime {
  kind: AgentRuntime['kind'] = 'local'

  async startRun(request: AgentRunRequest): Promise<AgentRunHandle> {
    const runId = request.runId || (crypto?.randomUUID ? crypto.randomUUID() : String(Date.now()))
    return {
      runId,
      status: 'running',
      startedAt: Date.now(),
    }
  }

  streamEvents(_runId: string, _onEvent: (event: any) => void): () => void {
    return () => {}
  }

  async requestToolExecution(_runId: string, toolCall: AgentToolCall): Promise<AgentToolResult> {
    if (!window.electronAPI?.tools?.run) {
      return { success: false, error: 'Local tool execution is unavailable' }
    }

    return window.electronAPI.tools.run({ name: toolCall.toolName, input: toolCall.input })
  }

  async checkpoint(_checkpoint: AgentCheckpoint): Promise<void> {
    return
  }

  async confirm(_approval: AgentApprovalResponse): Promise<void> {
    return
  }

  async cancelRun(_runId: string): Promise<void> {
    return
  }

  async finalizeRun(_runId: string): Promise<void> {
    return
  }
}
