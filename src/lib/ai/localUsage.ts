import { AI_BASE_URL } from '@/lib/ai/apiEndpoints'

export interface LocalUsagePayload {
  organizationId: string
  model: string
  conversationId?: string
  requestId?: string
  feature?: string
  actionType?: string
  projectId?: string
  durationMs?: number
  finishReason?: string
  rawFinishReason?: string
  promptTokens: number
  completionTokens: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  toolCallTokens?: number
  toolCalls?: {
    count: number
    names: string[]
    approvalCount?: number
  }
}

export async function reportLocalUsage(
  accessToken: string,
  payload: LocalUsagePayload
): Promise<{ trackedUnits?: number; error?: string } | null> {
  try {
    const response = await fetch(`${AI_BASE_URL}/local/usage`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${accessToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(payload),
    })

    if (!response.ok) {
      return { error: `Local usage tracking failed: ${response.status}` }
    }

    return response.json()
  } catch (error) {
    return {
      error: error instanceof Error ? error.message : 'Local usage tracking failed',
    }
  }
}
