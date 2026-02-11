export type AIProvider = 'anthropic' | 'openai' | 'google'

export interface ToolMetaShape {
  name: string
  displayName: string
  description: string
  inputSchema: Record<string, unknown>
  requiresApproval: boolean
  riskLevel: 'safe' | 'moderate' | 'dangerous'
  executionEnvironment: 'local' | 'server' | 'provider'
  provider?: AIProvider
  toolType?: 'function' | 'provider' | 'dynamic'
  providerToolId?: string
  providerToolArgs?: Record<string, unknown>
  supportsDeferredResults?: boolean
}

export interface ToolPolicy {
  allowProviderTools: boolean
  allowWebSearch: boolean
  maxReasoningDepth: 'low' | 'medium' | 'high'
}

export interface ToolsApiResponse<TToolMeta extends ToolMetaShape = ToolMetaShape> {
  tools: TToolMeta[]
  policy?: ToolPolicy
}

export interface ToolCallPayload {
  toolName: string
  input: unknown
  toolCallId: string
  dynamic?: boolean
  providerExecuted?: boolean
}

