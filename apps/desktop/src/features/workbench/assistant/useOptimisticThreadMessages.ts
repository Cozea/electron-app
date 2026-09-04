import { useCallback, useEffect, useMemo, useState } from "react"

import type { ChatMessage, Thread } from "@/features/assistant/model/types"

export function useOptimisticThreadMessages(thread: Thread | null) {
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([])

  useEffect(() => {
    setOptimisticUserMessages([])
  }, [thread?.id])

  useEffect(() => {
    if (!thread || optimisticUserMessages.length === 0) {
      return
    }

    const serverMessageIds = new Set(thread.messages.map((message) => message.id))
    if (!optimisticUserMessages.some((message) => serverMessageIds.has(message.id))) {
      return
    }

    setOptimisticUserMessages((current) =>
      current.filter((message) => !serverMessageIds.has(message.id)),
    )
  }, [optimisticUserMessages, thread])

  const visibleThread = useMemo(() => {
    if (!thread || optimisticUserMessages.length === 0) {
      return thread
    }

    const serverMessageIds = new Set(thread.messages.map((message) => message.id))
    const pendingMessages = optimisticUserMessages.filter(
      (message) => !serverMessageIds.has(message.id),
    )
    if (pendingMessages.length === 0) {
      return thread
    }

    return {
      ...thread,
      messages: [...thread.messages, ...pendingMessages],
    }
  }, [optimisticUserMessages, thread])

  const addOptimisticUserMessage = useCallback((message: ChatMessage) => {
    setOptimisticUserMessages((current) => [...current, message])
  }, [])

  const removeOptimisticUserMessage = useCallback((messageId: ChatMessage["id"]) => {
    setOptimisticUserMessages((current) =>
      current.filter((message) => message.id !== messageId),
    )
  }, [])

  return {
    visibleThread,
    addOptimisticUserMessage,
    removeOptimisticUserMessage,
  }
}
