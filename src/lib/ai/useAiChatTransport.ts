import { useCallback, useEffect, useMemo, useRef } from 'react'
import { DefaultChatTransport } from 'ai'

import { AI_API_URL } from '@/lib/ai/apiEndpoints'
import type { AgentId, AISurface, VariantId } from '@/lib/ai/runtimeProfiles'
import { getAiTimezoneHeaders } from '@/lib/ai/timezoneHeaders'

interface UseAiChatTransportArgs {
  accessToken: string | null
  organizationId: string | null | undefined
  model: string
  conversationId: string
  agentId: AgentId
  surface: AISurface
  variantId?: VariantId
  enableTools: boolean
  enableWebSearch: boolean
  extraBody?: Record<string, unknown>
  providerAuthHeader?: string | null
  api?: string
}

interface ChatMessageLike {
  id?: string
}

function dedupeMessagesById<T extends ChatMessageLike>(messages: T[]): T[] {
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

export function useAiChatTransport({
  accessToken,
  organizationId,
  model,
  conversationId,
  agentId,
  surface,
  variantId,
  enableTools,
  enableWebSearch,
  extraBody,
  providerAuthHeader,
  api,
}: UseAiChatTransportArgs) {
  const chatApi = api ?? AI_API_URL
  const requestConfigRef = useRef({
    accessToken,
    organizationId: organizationId ?? null,
    model,
    conversationId,
    agentId,
    surface,
    variantId: variantId,
    enableTools,
    enableWebSearch,
    extraBody: extraBody ?? {},
    providerAuthHeader: providerAuthHeader ?? null,
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: organizationId ?? null,
      model,
      conversationId,
      agentId,
      surface,
      variantId: variantId,
      enableTools,
      enableWebSearch,
      extraBody: extraBody ?? {},
      providerAuthHeader: providerAuthHeader ?? null,
    }
  }, [
    accessToken,
    organizationId,
    model,
    conversationId,
    agentId,
    surface,
    variantId,
    enableTools,
    enableWebSearch,
    extraBody,
    providerAuthHeader,
  ])

  const setConversationId = useCallback((nextConversationId: string) => {
    requestConfigRef.current.conversationId = nextConversationId
  }, [])

  const transport = useMemo(() => {
    const baseApi = chatApi.replace(/\/chat$/, '')

    return new DefaultChatTransport({
      api: chatApi,
      headers: (): Record<string, string> => {
        const token = requestConfigRef.current.accessToken
        const providerHeader = requestConfigRef.current.providerAuthHeader
        const next: Record<string, string> = {}
        if (token) {
          next.Authorization = `Bearer ${token}`
        }
        if (providerHeader) {
          next['x-cozea-provider-auth'] = providerHeader
        }
        return {
          ...next,
          ...getAiTimezoneHeaders(),
        }
      },
      body: () => ({
        model: requestConfigRef.current.model,
        organizationId: requestConfigRef.current.organizationId,
        conversationId: requestConfigRef.current.conversationId,
        agentId: requestConfigRef.current.agentId,
        surface: requestConfigRef.current.surface,
        variantId: requestConfigRef.current.variantId,
        enableTools: requestConfigRef.current.enableTools,
        enableWebSearch: requestConfigRef.current.enableWebSearch,
        ...requestConfigRef.current.extraBody,
      }),
      prepareSendMessagesRequest: ({ messages, body, messageId }) => {
        const api = `${baseApi}/chat`
        const requestBody = body ?? {}
        const dedupedMessages = dedupeMessagesById(messages)
        const nextBody = {
          ...requestBody,
          messages: dedupedMessages,
          ...(messageId ? { requestId: messageId } : {}),
        }

        return { api, body: nextBody }
      },
    })
  }, [chatApi])

  return {
    transport,
    setConversationId,
  }
}
