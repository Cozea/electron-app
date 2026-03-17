import { useEffect, useMemo, useRef, useState } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai'
import { useAiChatTransport, type UseAiChatTransportArgs, type ChatMessageLike } from '@/lib/ai/useAiChatTransport'
import {
  readLatestRetryHint,
  resolveAutoRetryDelayMs,
  shouldAutoRetryFromHint,
  type RetryHint,
} from '@/lib/ai/retryHints'
import { parseBillingError, type BillingErrorData } from '@/lib/ai/billingErrors'

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

export interface UseCozeaChatArgs {
  transportArgs: UseAiChatTransportArgs
  chatOptions?: Omit<Parameters<typeof useChat>[0], 'transport' | 'sendAutomaticallyWhen'>
  autoRetry?: {
    enabled?: boolean
    maxAttempts?: number
    initialDelayMs?: number
    maxDelayMs?: number
    backoffFactor?: number
  }
  onBillingError?: (error: BillingErrorData) => void
  onError?: (error: Error) => void
}

export interface ChatAutoRetryState {
  scheduled: boolean
  attempt: number
  maxAttempts: number
  nextRetryAt: number | null
  exhausted: boolean
  reasonCode?: RetryHint['code']
}

function resolveRetryScopeKey(messages: Array<{ id?: string; role?: string }>): string {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const message = messages[index]
    if (message.role !== 'user') continue
    if (typeof message.id === 'string' && message.id.trim().length > 0) {
      return message.id
    }
    return `user-${index}`
  }

  const lastMessage = messages[messages.length - 1]
  if (lastMessage && typeof lastMessage.id === 'string' && lastMessage.id.trim().length > 0) {
    return `fallback-${lastMessage.id}`
  }
  return 'conversation'
}

export function useCozeaChat({
  transportArgs,
  chatOptions,
  autoRetry,
  onBillingError,
  onError,
}: UseCozeaChatArgs) {
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const { transport, setConversationId } = useAiChatTransport(transportArgs)
  const retryTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const retryAttemptsByScopeRef = useRef<Map<string, number>>(new Map())
  const scheduledRetryKeyRef = useRef<string | null>(null)

  const chatHook = useChat({
    transport,
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }),
    ...chatOptions,
    onError: (err: Error) => {
      console.error('Chat error:', err)
      const parsedBillingErr = parseBillingError(err, {
        workspaceScoped: Boolean(transportArgs.organizationId),
      })
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
    return readLatestRetryHint(
      dedupedMessages as Array<{ parts: Array<{ type: string } & Record<string, unknown>> }>
    )
  }, [dedupedMessages])

  const retryScopeKey = useMemo(() => {
    const scopedMessages = dedupedMessages as Array<{ id?: string; role?: string }>
    return resolveRetryScopeKey(scopedMessages)
  }, [dedupedMessages])

  const autoRetrySettings = useMemo(() => {
    const maxAttempts = Math.max(0, Math.floor(autoRetry?.maxAttempts ?? 2))
    return {
      enabled: autoRetry?.enabled === true,
      maxAttempts,
      initialDelayMs: Math.max(250, Math.floor(autoRetry?.initialDelayMs ?? 2000)),
      maxDelayMs: Math.max(250, Math.floor(autoRetry?.maxDelayMs ?? 30000)),
      backoffFactor: Math.max(1, autoRetry?.backoffFactor ?? 2),
    }
  }, [
    autoRetry?.enabled,
    autoRetry?.maxAttempts,
    autoRetry?.initialDelayMs,
    autoRetry?.maxDelayMs,
    autoRetry?.backoffFactor,
  ])

  const [autoRetryState, setAutoRetryState] = useState<ChatAutoRetryState>({
    scheduled: false,
    attempt: 0,
    maxAttempts: autoRetrySettings.maxAttempts,
    nextRetryAt: null,
    exhausted: false,
  })

  useEffect(() => {
    if (!autoRetrySettings.enabled) {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      scheduledRetryKeyRef.current = null
    } else if (chatHook.status !== 'error') {
      if (retryTimerRef.current) {
        clearTimeout(retryTimerRef.current)
        retryTimerRef.current = null
      }
      scheduledRetryKeyRef.current = null
      if (
        autoRetryState.scheduled ||
        autoRetryState.nextRetryAt !== null ||
        autoRetryState.maxAttempts !== autoRetrySettings.maxAttempts ||
        autoRetryState.exhausted !== false
      ) {
        queueMicrotask(() => {
          setAutoRetryState((prev) => ({
            ...prev,
            attempt: 0,
            scheduled: false,
            nextRetryAt: null,
            maxAttempts: autoRetrySettings.maxAttempts,
            exhausted: false,
            reasonCode: undefined,
          }))
        })
      }
    } else if (shouldAutoRetryFromHint(retryHint)) {
      const maxAttemptsForHint =
        retryHint.code === 'duplicate_response_item_id'
          ? Math.min(1, autoRetrySettings.maxAttempts)
          : autoRetrySettings.maxAttempts

      if (maxAttemptsForHint <= 0) {
        queueMicrotask(() => {
          setAutoRetryState((prev) => ({
            ...prev,
            scheduled: false,
            nextRetryAt: null,
            maxAttempts: maxAttemptsForHint,
            exhausted: true,
            reasonCode: retryHint.code,
          }))
        })
      } else {
        const completedAttempts = retryAttemptsByScopeRef.current.get(retryScopeKey) ?? 0
        if (completedAttempts >= maxAttemptsForHint) {
          queueMicrotask(() => {
            setAutoRetryState((prev) => ({
              ...prev,
              scheduled: false,
              nextRetryAt: null,
              attempt: completedAttempts,
              maxAttempts: maxAttemptsForHint,
              exhausted: true,
              reasonCode: retryHint.code,
            }))
          })
        }
      }
    }
  }, [
    chatHook.status,
    autoRetrySettings.enabled,
    autoRetrySettings.maxAttempts,
    retryHint,
    retryScopeKey,
    autoRetryState.scheduled,
    autoRetryState.nextRetryAt,
    autoRetryState.maxAttempts,
    autoRetryState.exhausted
  ])

  useEffect(() => {
    return () => {
      if (!retryTimerRef.current) return
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
      scheduledRetryKeyRef.current = null
    }
  }, [])

  const chatStatus = chatHook.status
  const clearError = chatHook.clearError
  const regenerate = chatHook.regenerate

  useEffect(() => {
    if (!autoRetrySettings.enabled || chatStatus !== 'error' || !shouldAutoRetryFromHint(retryHint)) {
      return
    }

    const maxAttemptsForHint =
      retryHint.code === 'duplicate_response_item_id'
        ? Math.min(1, autoRetrySettings.maxAttempts)
        : autoRetrySettings.maxAttempts

    if (maxAttemptsForHint <= 0) return

    const completedAttempts = retryAttemptsByScopeRef.current.get(retryScopeKey) ?? 0
    if (completedAttempts >= maxAttemptsForHint) return

    const nextAttempt = completedAttempts + 1
    const scheduledRetryKey = `${retryScopeKey}:${retryHint.code}:${nextAttempt}`
    if (scheduledRetryKeyRef.current === scheduledRetryKey) {
      return
    }

    if (retryTimerRef.current) {
      clearTimeout(retryTimerRef.current)
      retryTimerRef.current = null
    }

    const retryDelayMs = resolveAutoRetryDelayMs({
      attempt: nextAttempt,
      hint: retryHint,
      initialDelayMs: autoRetrySettings.initialDelayMs,
      maxDelayMs: autoRetrySettings.maxDelayMs,
      backoffFactor: autoRetrySettings.backoffFactor,
    })
    const nextRetryAt = Date.now() + retryDelayMs

    scheduledRetryKeyRef.current = scheduledRetryKey
    setAutoRetryState({
      scheduled: true,
      attempt: nextAttempt,
      maxAttempts: maxAttemptsForHint,
      nextRetryAt,
      exhausted: false,
      reasonCode: retryHint.code,
    })

    retryTimerRef.current = setTimeout(() => {
      retryTimerRef.current = null
      scheduledRetryKeyRef.current = null
      retryAttemptsByScopeRef.current.set(retryScopeKey, nextAttempt)

      setAutoRetryState((current) => ({
        ...current,
        scheduled: false,
        nextRetryAt: null,
        attempt: nextAttempt,
        maxAttempts: maxAttemptsForHint,
        exhausted: nextAttempt >= maxAttemptsForHint,
        reasonCode: retryHint.code,
      }))

      clearError()
      void regenerate().catch((error) => {
        console.warn('Automatic chat retry failed:', error)
      })
    }, retryDelayMs)
  }, [
    autoRetrySettings.backoffFactor,
    autoRetrySettings.enabled,
    autoRetrySettings.initialDelayMs,
    autoRetrySettings.maxAttempts,
    autoRetrySettings.maxDelayMs,
    chatStatus,
    clearError,
    regenerate,
    retryHint,
    retryScopeKey,
  ])

  return {
    ...chatHook,
    dedupedMessages,
    retryHint,
    autoRetryState,
    billingError,
    setBillingError,
    setConversationId,
    transport
  }
}
