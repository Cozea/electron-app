import { useMemo, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai'
import { useAiChatTransport, type UseAiChatTransportArgs, type ChatMessageLike } from '@/lib/ai/useAiChatTransport'
import { readLatestRetryHint } from '@/lib/ai/retryHints'

// Common function for deduplication across the app
export function dedupeMessagesById<T extends ChatMessageLike>(messages: T[]): T[] {
  if (messages.length <= 1) return messages

  const lastIndexById = new Map<string, number>()
  for (let index = 0; index < messages.length; index += 1) {
    const messageId = messages[index]?.id
    if (!messageId) continue
    lastIndexById.set(messageId, index)
  }

  return messages.filter((message, index) => {
    if (!message.id) return true
    return lastIndexById.get(message.id) === index
  })
}

// Simple billing error extraction
export interface BillingErrorData {
  title?: string
  message?: string
  action?: { label: string; href: string }
  hint?: string
}

export function parseBillingError(err: unknown): BillingErrorData | null {
  if (!err) return null
  try {
    const errStr = err instanceof Error ? err.message : String(err)
    if (!errStr.includes('{')) return null
    const jsonStr = errStr.substring(errStr.indexOf('{'))
    const parsed = JSON.parse(jsonStr)
    if (parsed.error === 'billing_error' || parsed.error === 'provider_auth_required' || parsed.error === 'provider_restricted') {
      return parsed
    }
  } catch {
    // ignore
  }
  return null
}

export interface UseCozeaChatArgs {
  transportArgs: UseAiChatTransportArgs
  chatOptions?: Omit<Parameters<typeof useChat>[0], 'transport' | 'sendAutomaticallyWhen'>
  onBillingError?: (error: BillingErrorData) => void
  onError?: (error: Error) => void
}

export function useCozeaChat({ transportArgs, chatOptions, onBillingError, onError }: UseCozeaChatArgs) {
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const { transport, setConversationId } = useAiChatTransport(transportArgs)

  const chatHook = useChat({
    transport,
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }),
    ...chatOptions,
    onError: (err: Error) => {
      console.error('Chat error:', err)
      const parsedBillingErr = parseBillingError(err)
      if (parsedBillingErr) {
        setBillingError(parsedBillingErr)
        onBillingError?.(parsedBillingErr)
      }
      onError?.(err)
      if (chatOptions && 'onError' in chatOptions && typeof chatOptions.onError === 'function') {
        chatOptions.onError(err)
      }
    }
  })

  const dedupedMessages = useMemo(() => dedupeMessagesById(chatHook.messages), [chatHook.messages])

  const retryHint = useMemo(() => {
    // useChat types aren't perfectly aligned with our parts, so we cast to check parts safely
    return readLatestRetryHint(dedupedMessages as any)
  }, [dedupedMessages])

  return {
    ...chatHook,
    dedupedMessages,
    retryHint,
    billingError,
    setBillingError,
    setConversationId,
    transport
  }
}
