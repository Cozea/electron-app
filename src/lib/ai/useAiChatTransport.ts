import { useEffect, useMemo, useRef } from 'react'
import { DefaultChatTransport } from 'ai'

import { AI_API_URL, AI_BASE_URL } from '@/lib/ai/apiEndpoints'

interface UseAiChatTransportArgs {
  accessToken: string | null
  organizationId: string | null | undefined
  model: string
  conversationId: string
  feature: 'assistant' | 'project-wizard'
  actionType: string
  reasoningDepth: 'low' | 'medium' | 'high'
  thinkingEffort: 'low' | 'medium' | 'high'
  enableTools: boolean
  enableWebSearch: boolean
  extraBody?: Record<string, unknown>
}

export function useAiChatTransport({
  accessToken,
  organizationId,
  model,
  conversationId,
  feature,
  actionType,
  reasoningDepth,
  thinkingEffort,
  enableTools,
  enableWebSearch,
  extraBody,
}: UseAiChatTransportArgs) {
  const requestConfigRef = useRef({
    accessToken,
    organizationId: organizationId ?? null,
    model,
    conversationId,
    feature,
    actionType,
    enableTools,
    enableWebSearch,
    reasoningDepth,
    thinkingEffort,
    extraBody: extraBody ?? {},
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: organizationId ?? null,
      model,
      conversationId,
      feature,
      actionType,
      enableTools,
      enableWebSearch,
      reasoningDepth,
      thinkingEffort,
      extraBody: extraBody ?? {},
    }
  }, [
    accessToken,
    organizationId,
    model,
    conversationId,
    feature,
    actionType,
    enableTools,
    enableWebSearch,
    reasoningDepth,
    thinkingEffort,
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
        feature: requestConfigRef.current.feature,
        actionType: requestConfigRef.current.actionType,
        enableTools: requestConfigRef.current.enableTools,
        enableWebSearch: requestConfigRef.current.enableWebSearch,
        reasoningDepth: requestConfigRef.current.reasoningDepth,
        thinkingEffort: requestConfigRef.current.thinkingEffort,
        ...requestConfigRef.current.extraBody,
      }),
      prepareSendMessagesRequest: ({ messages, body, messageId }) => {
        const currentActionType = requestConfigRef.current.actionType
        const api = currentActionType === 'agent'
          ? `${AI_BASE_URL}/agent`
          : `${AI_BASE_URL}/chat`

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
