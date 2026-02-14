import type { UIMessage } from 'ai'
import type {
  AgentApprovalResponse,
  AgentCheckpoint,
  AgentRunHandle,
  AgentRunRequest,
  AgentRuntime,
  AgentToolCall,
  AgentToolResult,
} from './runtime'

/**
 * Cloud Agent Runtime - Executes agent runs on the server
 *
 * Uses Server-Sent Events (SSE) for streaming agent events back to the client.
 * Supports checkpointing, tool approval, and run management.
 */
export class CloudAgentRuntime implements AgentRuntime {
  kind: AgentRuntime['kind'] = 'cloud'

  private baseUrl: string
  private accessToken: string | null = null
  private activeEventSources: Map<string, EventSource> = new Map()

  constructor(baseUrl?: string) {
    this.baseUrl = baseUrl || '/api/ai'
  }

  /**
   * Set the access token for authenticated requests
   */
  setAccessToken(token: string | null): void {
    this.accessToken = token
  }

  /**
   * Get headers for authenticated requests
   */
  private getHeaders(): Record<string, string> {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
    }
    if (this.accessToken) {
      headers['Authorization'] = `Bearer ${this.accessToken}`
    }
    return headers
  }

  /**
   * Start a new agent run on the server
   */
  async startRun(request: AgentRunRequest): Promise<AgentRunHandle> {
    const response = await fetch(`${this.baseUrl}/agent/start`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        runId: request.runId,
        conversationId: request.conversationId,
        organizationId: request.organizationId,
        model: request.model,
        agentId: request.agentId || 'assistant_general',
        surface: request.surface || 'assistant_panel',
        variantId: request.variantId || 'medium',
        enableTools: request.enableTools ?? true,
        enableWebSearch: request.enableWebSearch ?? false,
        messages: request.messages,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Failed to start agent run: ${response.status}`)
    }

    const data = await response.json()

    return {
      runId: data.runId,
      status: 'running',
      startedAt: Date.now(),
    }
  }

  /**
   * Stream events from an active agent run using SSE
   */
  streamEvents(runId: string, onEvent: (event: UIMessage) => void): () => void {
    // Build URL with auth token as query param for SSE (can't use headers)
    const url = new URL(`${this.baseUrl}/agent/${runId}/events`, window.location.origin)
    if (this.accessToken) {
      url.searchParams.set('token', this.accessToken)
    }

    const eventSource = new EventSource(url.toString())
    this.activeEventSources.set(runId, eventSource)

    eventSource.onmessage = (event) => {
      try {
        const data = JSON.parse(event.data)
        onEvent(data as UIMessage)
      } catch (err) {
        console.error('Failed to parse agent event:', err)
      }
    }

    eventSource.addEventListener('done', () => {
      eventSource.close()
      this.activeEventSources.delete(runId)
    })

    eventSource.addEventListener('error', (event) => {
      console.error('Agent event stream error:', event)
      // Don't close on error - SSE will auto-reconnect
    })

    // Return cleanup function
    return () => {
      eventSource.close()
      this.activeEventSources.delete(runId)
    }
  }

  /**
   * Request tool execution from the server
   */
  async requestToolExecution(runId: string, toolCall: AgentToolCall): Promise<AgentToolResult> {
    const response = await fetch(`${this.baseUrl}/agent/${runId}/tool`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        toolName: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        input: toolCall.input,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      return {
        success: false,
        error: error.error || `Tool execution failed: ${response.status}`,
      }
    }

    const result = await response.json()
    return {
      success: true,
      output: result.output,
    }
  }

  /**
   * Save a checkpoint for the agent run
   */
  async checkpoint(checkpoint: AgentCheckpoint): Promise<void> {
    const response = await fetch(`${this.baseUrl}/agent/${checkpoint.runId}/checkpoint`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        label: checkpoint.label,
        metadata: checkpoint.metadata,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Failed to save checkpoint: ${response.status}`)
    }
  }

  /**
   * Send approval response for a tool call requiring confirmation
   */
  async confirm(approval: AgentApprovalResponse): Promise<void> {
    const response = await fetch(`${this.baseUrl}/agent/${approval.runId}/approve`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({
        approvalId: approval.approvalId,
        approved: approval.approved,
        reason: approval.reason,
      }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Failed to send approval: ${response.status}`)
    }
  }

  /**
   * Cancel an active agent run
   */
  async cancelRun(runId: string): Promise<void> {
    // Close event source if active
    const eventSource = this.activeEventSources.get(runId)
    if (eventSource) {
      eventSource.close()
      this.activeEventSources.delete(runId)
    }

    const response = await fetch(`${this.baseUrl}/agent/${runId}/cancel`, {
      method: 'POST',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Failed to cancel run: ${response.status}`)
    }
  }

  /**
   * Finalize an agent run (cleanup resources)
   */
  async finalizeRun(runId: string): Promise<void> {
    // Close event source if still active
    const eventSource = this.activeEventSources.get(runId)
    if (eventSource) {
      eventSource.close()
      this.activeEventSources.delete(runId)
    }

    const response = await fetch(`${this.baseUrl}/agent/${runId}/finalize`, {
      method: 'POST',
      headers: this.getHeaders(),
    })

    // Finalize is best-effort, don't throw on error
    if (!response.ok) {
      console.warn(`Failed to finalize agent run ${runId}:`, response.status)
    }
  }

  /**
   * Get the status of an agent run
   */
  async getRunStatus(runId: string): Promise<AgentRunHandle | null> {
    const response = await fetch(`${this.baseUrl}/agent/${runId}/status`, {
      method: 'GET',
      headers: this.getHeaders(),
    })

    if (!response.ok) {
      if (response.status === 404) {
        return null
      }
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Failed to get run status: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Restore a run to a previous checkpoint
   */
  async restoreCheckpoint(runId: string, checkpointId: string): Promise<AgentRunHandle> {
    const response = await fetch(`${this.baseUrl}/agent/${runId}/restore`, {
      method: 'POST',
      headers: this.getHeaders(),
      body: JSON.stringify({ checkpointId }),
    })

    if (!response.ok) {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }))
      throw new Error(error.error || `Failed to restore checkpoint: ${response.status}`)
    }

    return response.json()
  }

  /**
   * Clean up all active connections
   */
  dispose(): void {
    for (const [runId, eventSource] of this.activeEventSources) {
      eventSource.close()
      this.activeEventSources.delete(runId)
    }
  }
}
