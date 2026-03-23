import { AI_BASE_URL } from '@/lib/ai/apiEndpoints'

export interface ConversationTitleMessage {
  role: 'user' | 'assistant' | 'system'
  content: string
}

function normalizeTitleText(value: string): string {
  return value.trim().replace(/\s+/g, ' ')
}

export function buildFallbackConversationTitle(messages: ConversationTitleMessage[]): string {
  const firstUserMessage = messages.find(
    (message) => message.role === 'user' && normalizeTitleText(message.content).length > 0,
  )
  if (!firstUserMessage) {
    return 'New Conversation'
  }

  const normalized = normalizeTitleText(firstUserMessage.content)
  if (normalized.length <= 50) {
    return normalized
  }
  return `${normalized.slice(0, 50)}...`
}

export function shouldPreserveConversationTitle(
  existingTitle: string | null | undefined,
  fallbackTitle: string,
): boolean {
  const normalized = existingTitle ? normalizeTitleText(existingTitle) : ''
  if (!normalized) return false
  if (normalized === 'New Chat' || normalized === 'New Conversation') return false
  return normalized !== fallbackTitle
}

export function sanitizeGeneratedConversationTitle(title: string | null | undefined): string | null {
  if (!title) return null
  const normalized = normalizeTitleText(title).replace(/^["']+|["']+$/g, '')
  if (!normalized) return null
  return normalized.slice(0, 80)
}

export async function inferConversationTitle(args: {
  accessToken: string
  organizationId: string
  messages: ConversationTitleMessage[]
}): Promise<string | null> {
  const response = await fetch(`${AI_BASE_URL}/conversation-title`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${args.accessToken}`,
    },
    body: JSON.stringify({
      organizationId: args.organizationId,
      messages: args.messages,
    }),
  })

  if (!response.ok) {
    return null
  }

  const payload = await response.json() as { title?: string }
  return sanitizeGeneratedConversationTitle(payload.title)
}
