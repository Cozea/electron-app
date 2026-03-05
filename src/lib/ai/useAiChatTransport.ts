import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { DefaultChatTransport } from 'ai'

import { AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import type { AgentId, AISurface, VariantId } from '@/lib/ai/runtimeProfiles'
import { getAiTimezoneHeaders } from '@/lib/ai/timezoneHeaders'

export interface UseAiChatTransportArgs {
  accessToken: string | null
  organizationId: string | null | undefined
  model: string
  selectedProvider?: string | null
  conversationId: string
  agentId: AgentId
  surface: AISurface
  variantId?: VariantId
  enableTools: boolean
  enableWebSearch: boolean
  extraBody?: Record<string, unknown>
  providerAuthHeader?: string | null
}

export interface ChatMessageLike {
  id?: string
}

const LOCAL_RUNTIME_PENDING_CHAT_API = 'http://127.0.0.1:9/local-runtime-unavailable/chat'
const LOCAL_RUNTIME_STATUS_POLL_MS = 1500
const LOCAL_RUNTIME_BOOT_WAIT_MS = 6000
const LOCAL_RUNTIME_BOOT_POLL_MS = 300

function wait(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms)
  })
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

function isScopedModelId(modelId: string): boolean {
  const trimmed = modelId.trim()
  const separatorIndex = trimmed.indexOf('/')
  return separatorIndex > 0 && separatorIndex < trimmed.length - 1
}

function buildUniqueRequestId(messageId?: string): string {
  const base = typeof messageId === 'string' && messageId.trim().length > 0
    ? messageId.trim()
    : 'chat'
  return `${base}:${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
}

export function useAiChatTransport({
  accessToken,
  organizationId,
  model,
  selectedProvider,
  conversationId,
  agentId,
  surface,
  variantId,
  enableTools,
  enableWebSearch,
  extraBody,
  providerAuthHeader,
}: UseAiChatTransportArgs) {
  const remoteBaseApi = AI_BASE_URL
  const hasDesktopLocalRuntimeApi =
    typeof window !== 'undefined' &&
    typeof window.electronAPI?.localAiRuntime?.getStatus === 'function'
  const [localRuntimeChatApi, setLocalRuntimeChatApi] = useState<string | null>(null)
  const [localRuntimeStatus, setLocalRuntimeStatus] = useState<'checking' | 'ready' | 'unavailable'>('checking')

  useEffect(() => {
    let cancelled = false
    let pollTimeout: ReturnType<typeof setTimeout> | null = null

    const resolveLocalRuntime = async () => {
      if (!hasDesktopLocalRuntimeApi) {
        if (!cancelled) {
          setLocalRuntimeChatApi(null)
          setLocalRuntimeStatus('unavailable')
        }
        return
      }
      if (!cancelled) setLocalRuntimeStatus('checking')
      try {
        const status = await window.electronAPI.localAiRuntime.getStatus()
        if (cancelled) return
        if (status.enabled && status.running && typeof status.endpoint === 'string' && status.endpoint.length > 0) {
          setLocalRuntimeChatApi(status.endpoint)
          setLocalRuntimeStatus('ready')
        } else if (status.enabled) {
          setLocalRuntimeChatApi(null)
          setLocalRuntimeStatus('checking')
        } else {
          setLocalRuntimeChatApi(null)
          setLocalRuntimeStatus('unavailable')
        }
      } catch {
        if (!cancelled) {
          setLocalRuntimeChatApi(null)
          setLocalRuntimeStatus('checking')
        }
      } finally {
        if (!cancelled) {
          pollTimeout = setTimeout(() => {
            void resolveLocalRuntime()
          }, LOCAL_RUNTIME_STATUS_POLL_MS)
        }
      }
    }

    void resolveLocalRuntime()
    return () => {
      cancelled = true
      if (pollTimeout) {
        clearTimeout(pollTimeout)
      }
    }
  }, [hasDesktopLocalRuntimeApi])

  const chatApi = localRuntimeChatApi ?? LOCAL_RUNTIME_PENDING_CHAT_API
  const requestConfigRef = useRef({
    accessToken,
    organizationId: organizationId ?? null,
    model,
    selectedProvider: selectedProvider?.trim().toLowerCase() || null,
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
      selectedProvider: selectedProvider?.trim().toLowerCase() || null,
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
    selectedProvider,
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
    const localRuntimeRunApi = localRuntimeChatApi
      ? localRuntimeChatApi.replace(/\/chat$/, '/agent/run')
      : null

    const resolveRunApi = async (): Promise<{ api: string | null; state: 'checking' | 'unavailable' }> => {
      if (localRuntimeRunApi) {
        return { api: localRuntimeRunApi, state: 'checking' }
      }
      if (!hasDesktopLocalRuntimeApi) {
        return { api: null, state: 'unavailable' }
      }

      const deadline = Date.now() + LOCAL_RUNTIME_BOOT_WAIT_MS
      let lastState: 'checking' | 'unavailable' = localRuntimeStatus === 'unavailable' ? 'unavailable' : 'checking'

      while (Date.now() < deadline) {
        try {
          const status = await window.electronAPI.localAiRuntime.getStatus()
          if (status.enabled && status.running && typeof status.endpoint === 'string' && status.endpoint.length > 0) {
            setLocalRuntimeChatApi(status.endpoint)
            setLocalRuntimeStatus('ready')
            return {
              api: status.endpoint.replace(/\/chat$/, '/agent/run'),
              state: 'checking',
            }
          }
          if (status.enabled) {
            lastState = 'checking'
            setLocalRuntimeStatus('checking')
          } else {
            lastState = 'unavailable'
            setLocalRuntimeStatus('unavailable')
            setLocalRuntimeChatApi(null)
            break
          }
        } catch {
          lastState = 'checking'
          setLocalRuntimeStatus('checking')
        }

        await wait(LOCAL_RUNTIME_BOOT_POLL_MS)
      }

      return { api: null, state: lastState }
    }

    return new DefaultChatTransport({
      api: chatApi,
      headers: (): Record<string, string> => {
        const token = requestConfigRef.current.accessToken
        const providerHeader = requestConfigRef.current.providerAuthHeader
        const selectedProviderHeader = requestConfigRef.current.selectedProvider
        const next: Record<string, string> = {}
        if (token) {
          next.Authorization = `Bearer ${token}`
        }
        if (providerHeader) {
          next['x-cozea-provider-auth'] = providerHeader
        }
        if (selectedProviderHeader) {
          next['x-cozea-selected-provider'] = selectedProviderHeader
        }
        if (remoteBaseApi) {
          next['x-cozea-ai-base-url'] = remoteBaseApi
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
      prepareSendMessagesRequest: async ({ messages, body, messageId }) => {
        const requestedModel = requestConfigRef.current.model
        if (!isScopedModelId(requestedModel)) {
          throw new Error(
            'Selected model is invalid. Choose a provider-specific model in Settings > AI and retry.'
          )
        }

        const { api, state } = await resolveRunApi()
        if (!api) {
          throw new Error(
            state === 'checking'
              ? 'Local AI runtime is still starting. Please retry in a moment.'
              : 'Local AI runtime is unavailable. AI execution is configured to run locally only.'
          )
        }
        const requestBody = body ?? {}
        const dedupedMessages = dedupeMessagesById(messages)
        const nextBody = {
          ...requestBody,
          messages: dedupedMessages,
          requestId: buildUniqueRequestId(messageId),
        }

        return { api, body: nextBody }
      },
    })
  }, [chatApi, hasDesktopLocalRuntimeApi, localRuntimeChatApi, localRuntimeStatus, remoteBaseApi])

  return {
    transport,
    setConversationId,
  }
}
