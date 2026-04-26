import { useCallback, useRef, useState } from "react"
import type { OrchestrationCommand, ProviderInteractionMode, RuntimeMode } from "@cozea/assistant-contracts"

import { newCommandId, newMessageId } from "@/features/projects/components/assistant/lib/utils"
import { refreshAssistantRuntimeSnapshot } from "@/features/projects/components/workbench/useAssistantRuntimeSync"
import { ensureNativeApi } from "@/lib/nativeApi"
import type { ChatMessage, Thread } from "@/stores/types"
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/stores/useProjectWorkbenchStore"

import { toErrorMessage, truncateTitle } from "./workbenchAssistantShared"

interface UseAssistantTurnSendInput {
  thread: Thread | null
  composer: string
  isRuntimeReady: boolean
  runtimeErrorMessage: string | null
  isTurnBusy: boolean
  isBinding: boolean
  isRevertingCheckpoint: boolean
  providerSkills?: ReadonlyArray<{ name: string }>
  selectedDispatchModelSelection: Extract<
    OrchestrationCommand,
    { type: "thread.turn.start" }
  >["modelSelection"]
  selectedRuntimeMode: RuntimeMode
  selectedInteractionMode: ProviderInteractionMode
  updateAssistantTile: (
    projectId: string,
    laneId: string,
    tileId: string,
    patch: Partial<Pick<WorkbenchAssistantChatTileRecord, "title">>,
    projectPath?: string | null,
  ) => void
  projectId: string
  laneId: string
  tileId: string
  projectPath: string | null
  onComposerReset: () => void
  onComposerRestore: (value: string) => void
  onError: (message: string | null) => void
  addOptimisticUserMessage: (message: ChatMessage) => void
  removeOptimisticUserMessage: (messageId: ChatMessage["id"]) => void
  clearPendingTurnStart: () => void
  notePendingTurnStart: (messageId: ChatMessage["id"], threadId: Thread["id"]) => void
}

const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g

export function useAssistantTurnSend({
  thread,
  composer,
  isRuntimeReady,
  runtimeErrorMessage,
  isTurnBusy,
  isBinding,
  isRevertingCheckpoint,
  providerSkills,
  selectedDispatchModelSelection,
  selectedRuntimeMode,
  selectedInteractionMode,
  updateAssistantTile,
  projectId,
  laneId,
  tileId,
  projectPath,
  onComposerReset,
  onComposerRestore,
  onError,
  addOptimisticUserMessage,
  removeOptimisticUserMessage,
  clearPendingTurnStart,
  notePendingTurnStart,
}: UseAssistantTurnSendInput) {
  const [isSending, setIsSending] = useState(false)
  const sendInFlightRef = useRef(false)

  const handleSend = useCallback(async () => {
    if (sendInFlightRef.current) {
      return
    }

    if (isTurnBusy) {
      onError("Agent is still working. Stop it or wait before sending.")
      return
    }

    if (isBinding || isRevertingCheckpoint) {
      return
    }

    if (!isRuntimeReady) {
      onError(runtimeErrorMessage ?? "Local chat runtime is still starting.")
      return
    }

    if (!thread) {
      return
    }

    const nextPrompt = composer.trim()
    if (!nextPrompt) {
      return
    }

    const isFirstUserMessage = !thread.messages.some((message) => message.role === "user")
    const nextThreadTitle = truncateTitle(nextPrompt)
    const messageId = newMessageId()
    const messageCreatedAt = new Date().toISOString()
    const optimisticMessage: ChatMessage = {
      id: messageId,
      role: "user",
      text: nextPrompt,
      createdAt: messageCreatedAt,
      streaming: false,
    }

    sendInFlightRef.current = true
    setIsSending(true)
    clearPendingTurnStart()
    onError(null)
    onComposerReset()
    addOptimisticUserMessage(optimisticMessage)

    try {
      const api = ensureNativeApi()
      if (isFirstUserMessage && nextThreadTitle) {
        updateAssistantTile(projectId, laneId, tileId, {
          title: nextThreadTitle,
        }, projectPath)

        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: thread.id,
          title: nextThreadTitle,
        })
      }

      const extractedSkillNames = Array.from(nextPrompt.matchAll(SKILL_TOKEN_REGEX)).map((m) => m[2])
      const skills = providerSkills?.filter((skill) => extractedSkillNames.includes(skill.name)) ?? []

      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: thread.id,
        message: {
          messageId,
          role: "user",
          text: nextPrompt,
          attachments: [],
        },
        modelSelection: selectedDispatchModelSelection,
        runtimeMode: selectedRuntimeMode,
        interactionMode: selectedInteractionMode,
        ...(isFirstUserMessage && nextThreadTitle ? { titleSeed: nextThreadTitle } : {}),
        skills,
        createdAt: messageCreatedAt,
      })
      notePendingTurnStart(messageId, thread.id)
      await refreshAssistantRuntimeSnapshot()
    } catch (error) {
      clearPendingTurnStart()
      removeOptimisticUserMessage(messageId)
      onComposerRestore(nextPrompt)
      onError(toErrorMessage(error))
    } finally {
      sendInFlightRef.current = false
      setIsSending(false)
    }
  }, [
    addOptimisticUserMessage,
    clearPendingTurnStart,
    composer,
    isBinding,
    isRevertingCheckpoint,
    isRuntimeReady,
    isTurnBusy,
    laneId,
    notePendingTurnStart,
    onComposerReset,
    onComposerRestore,
    onError,
    projectId,
    projectPath,
    providerSkills,
    removeOptimisticUserMessage,
    runtimeErrorMessage,
    selectedDispatchModelSelection,
    selectedInteractionMode,
    selectedRuntimeMode,
    thread,
    tileId,
    updateAssistantTile,
  ])

  return {
    isSending,
    handleSend,
  }
}
