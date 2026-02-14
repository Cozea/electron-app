import { useEffect, useMemo, useRef } from 'react'
import { DefaultChatTransport } from 'ai'

import { AI_API_URL, AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import type { AgentId, AISurface, VariantId } from '@/lib/ai/runtimeProfiles'

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
}: UseAiChatTransportArgs) {
  const requestConfigRef = useRef({
    accessToken,
    organizationId: organizationId ?? null,
    model,
    conversationId,
    agentId,
    surface,
    variantId: variantId ?? 'medium',
    enableTools,
    enableWebSearch,
    extraBody: extraBody ?? {},
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: organizationId ?? null,
      model,
      conversationId,
      agentId,
      surface,
      variantId: variantId ?? 'medium',
      enableTools,
      enableWebSearch,
      extraBody: extraBody ?? {},
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
  ])

  return useMemo(() => {
    return new DefaultChatTransport({
      api: AI_API_URL,
      headers: (): Record<string, string> => {
        const token = requestConfigRef.current.accessToken
        return token ? { Authorization: `Bearer ${token}` } : {}
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
        const api = `${AI_BASE_URL}/chat`
        const requestBody = body ?? {}
        const nextBody = {
          ...requestBody,
          messages,
          ...(messageId ? { requestId: messageId } : {}),
        }

        return { api, body: nextBody }
      },
    })
  }, [])
}
