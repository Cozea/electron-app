import { useCallback, useEffect, useRef } from 'react'
import type { UIMessage } from 'ai'

import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import type { Id } from '../../../convex/_generated/dataModel'

type ConversationId = Id<'aiConversations'>

type ConversationRole = 'user' | 'assistant' | 'system'

interface StoredConversationMessage {
  id: string
  role: ConversationRole
  content: string
  createdAt: number | string | Date
}

interface StoredConversationShape {
  projectId: unknown
  title?: string | null
  messages: StoredConversationMessage[]
}

interface ProjectShape {
  _id: unknown
}

interface SaveConversationArgs {
  conversationId: ConversationId
  messages: Array<{
    id: string
    role: ConversationRole
    content: string
    createdAt: number
  }>
  title: string
}

interface UseConversationSyncArgs {
  projectSlug?: string | null
  currentConversationId: ConversationId | null
  project: ProjectShape | null | undefined
  storedConversation: StoredConversationShape | null | undefined
  setCurrentConversationId: (conversationId: ConversationId | null) => void
  setMessages: (messages: UIMessage[]) => void
  uniqueMessages: UIMessage[]
  status: string
  saveConversationMessages: (args: SaveConversationArgs) => Promise<unknown>
}

function getMessageCreatedAt(message: UIMessage): number {
  const candidate = (message as UIMessage & { createdAt?: Date | string | number }).createdAt
  if (candidate instanceof Date) return candidate.getTime()
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  if (typeof candidate === 'string') {
    const parsed = Date.parse(candidate)
    if (!Number.isNaN(parsed)) return parsed
  }
  return Date.now()
}

function dedupeMessagesById(messages: UIMessage[]): UIMessage[] {
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

export function useConversationSync({
  projectSlug,
  currentConversationId,
  project,
  storedConversation,
  setCurrentConversationId,
  setMessages,
  uniqueMessages,
  status,
  saveConversationMessages,
}: UseConversationSyncArgs): { markConversationInitialized: (conversationId: ConversationId) => void } {
  const conversationInitializedRef = useRef<ConversationId | null>(null)
  const isSavingRef = useRef(false)
  const lastProjectSlugRef = useRef<string | null>(null)

  useEffect(() => {
    if (!storedConversation) return
    if (conversationInitializedRef.current === currentConversationId) return
    if (project && storedConversation.projectId !== project._id) return

    const uiMessages: UIMessage[] = storedConversation.messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: [{ type: 'text' as const, text: msg.content }],
      createdAt: new Date(msg.createdAt),
    }))

    setMessages(dedupeMessagesById(uiMessages))
    conversationInitializedRef.current = currentConversationId

    if (storedConversation.title) {
      useAssistantPanelStore.getState().setChatTitle(storedConversation.title)
    }
  }, [storedConversation, currentConversationId, project, setMessages])

  useEffect(() => {
    const nextSlug = projectSlug ?? null
    if (lastProjectSlugRef.current === null) {
      lastProjectSlugRef.current = nextSlug
      return
    }

    if (lastProjectSlugRef.current !== nextSlug) {
      setCurrentConversationId(null)
      setMessages([])
      useAssistantPanelStore.getState().setChatTitle('New Chat')
      lastProjectSlugRef.current = nextSlug
    }
  }, [projectSlug, setCurrentConversationId, setMessages])

  useEffect(() => {
    if (!projectSlug) return
    if (!project) return
    if (!currentConversationId || !storedConversation) return
    if (storedConversation.projectId === project._id) return

    setCurrentConversationId(null)
    setMessages([])
    useAssistantPanelStore.getState().setChatTitle('New Chat')
  }, [projectSlug, project, currentConversationId, storedConversation, setCurrentConversationId, setMessages])

  useEffect(() => {
    if (!projectSlug) return
    if (project !== null) return
    if (!currentConversationId) return

    setCurrentConversationId(null)
    setMessages([])
    useAssistantPanelStore.getState().setChatTitle('New Chat')
  }, [projectSlug, project, currentConversationId, setCurrentConversationId, setMessages])

  useEffect(() => {
    if (currentConversationId === null) {
      conversationInitializedRef.current = null
    }
  }, [currentConversationId])

  useEffect(() => {
    if (!projectSlug) return
    if (!currentConversationId) return
    if (uniqueMessages.length === 0) return
    if (isSavingRef.current) return
    if (status === 'streaming' || status === 'submitted') return

    const saveMessages = async () => {
      isSavingRef.current = true
      try {
        const storedMessages = uniqueMessages.map((msg) => {
          const textParts = msg.parts.filter((p) => p.type === 'text')
          const content = textParts.map((p) => (p as { text: string }).text).join('')

          return {
            id: msg.id,
            role: msg.role as ConversationRole,
            content,
            createdAt: getMessageCreatedAt(msg),
          }
        })

        const firstUserMessage = storedMessages.find((message) => message.role === 'user')
        const title = firstUserMessage
          ? firstUserMessage.content.slice(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '')
          : 'New Conversation'

        await saveConversationMessages({
          conversationId: currentConversationId,
          messages: storedMessages,
          title,
        })
      } catch (err) {
        console.warn('Failed to save conversation messages:', err)
      } finally {
        isSavingRef.current = false
      }
    }

    const timeoutId = setTimeout(saveMessages, 500)
    return () => clearTimeout(timeoutId)
  }, [uniqueMessages, currentConversationId, projectSlug, status, saveConversationMessages])

  const markConversationInitialized = useCallback((conversationId: ConversationId) => {
    conversationInitializedRef.current = conversationId
  }, [])

  return { markConversationInitialized }
}
