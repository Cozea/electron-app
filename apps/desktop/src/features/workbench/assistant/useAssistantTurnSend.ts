import { useCallback, useRef, useState } from "react"
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type OrchestrationCommand,
  type ProviderInteractionMode,
  type RuntimeMode,
} from "@cozea/assistant-contracts"

import { newCommandId, newMessageId } from "@/features/assistant/lib/utils"
import { ensureNativeApi } from "@/lib/nativeApi"
import type { ChatMessage, Thread } from "@/features/assistant/model/types"
import type { WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord } from "@/lib/workbenchStore"

import { toErrorMessage, deriveTitleSeed, revokeUserMessagePreviewUrls, cloneComposerImageForRetry } from "./workbenchAssistantShared"

export interface ComposerImageDraft {
  id: string
  name: string
  mimeType: string
  sizeBytes: number
  previewUrl: string
  file: File
}

interface UseAssistantTurnSendInput {
  thread: Thread | null
  composer: string
  composerImages: ReadonlyArray<ComposerImageDraft>
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
    workspaceId?: string | null,
  ) => void
  projectId: string
  laneId: string
  tileId: string
  workspaceId: string | null
  onComposerReset: () => void
  onComposerRestore: (value: string, images?: ReadonlyArray<ComposerImageDraft>) => void
  onError: (message: string | null) => void
  addOptimisticUserMessage: (message: ChatMessage) => void
  removeOptimisticUserMessage: (messageId: ChatMessage["id"]) => void
  clearPendingTurnStart: () => void
  notePendingTurnStart: (
    messageId: ChatMessage["id"],
    threadId: Thread["id"],
    startedAtIso: string,
  ) => void
}

const SKILL_TOKEN_REGEX = /(^|\s)\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\s|$)/g

function readFileAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.addEventListener("load", () => {
      if (typeof reader.result === "string") {
        resolve(reader.result)
        return
      }
      reject(new Error("Could not read image data."))
    })
    reader.addEventListener("error", () => {
      reject(reader.error ?? new Error("Failed to read image."))
    })
    reader.readAsDataURL(file)
  })
}

export function useAssistantTurnSend({
  thread,
  composer,
  composerImages,
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
  workspaceId,
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
    const hasImages = composerImages.length > 0
    if (!nextPrompt && !hasImages) {
      return
    }

    const isFirstUserMessage = !thread.messages.some((message) => message.role === "user")
    const nextThreadTitle = deriveTitleSeed({
      prompt: nextPrompt,
      images: composerImages,
      terminalContexts: [],
    })
    const messageId = newMessageId()
    const messageCreatedAt = new Date().toISOString()
    const optimisticMessage: ChatMessage = {
      id: messageId,
      role: "user",
      text: nextPrompt,
      ...(hasImages
        ? {
            attachments: composerImages.map((image) => ({
              type: "image" as const,
              id: image.id,
              name: image.name,
              mimeType: image.mimeType,
              sizeBytes: image.sizeBytes,
              previewUrl: image.previewUrl,
            })),
          }
        : {}),
      createdAt: messageCreatedAt,
      streaming: false,
    }

    sendInFlightRef.current = true
    setIsSending(true)
    clearPendingTurnStart()
    onError(null)
    onComposerReset()
    addOptimisticUserMessage(optimisticMessage)
    notePendingTurnStart(messageId, thread.id, messageCreatedAt)

    try {
      const api = ensureNativeApi()
      if (isFirstUserMessage && nextThreadTitle) {
        updateAssistantTile(projectId, laneId, tileId, {
          title: nextThreadTitle,
        }, workspaceId)

        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: thread.id,
          title: nextThreadTitle,
        })
      }

      const extractedSkillNames = Array.from(nextPrompt.matchAll(SKILL_TOKEN_REGEX)).map((m) => m[2])
      const skills = providerSkills?.filter((skill) => extractedSkillNames.includes(skill.name)) ?? []
      const turnAttachments = await Promise.all(
        composerImages.map(async (image) => ({
          type: "image" as const,
          name: image.name,
          mimeType: image.mimeType,
          sizeBytes: image.sizeBytes,
          dataUrl: await readFileAsDataUrl(image.file),
        })),
      )

      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: thread.id,
        message: {
          messageId,
          role: "user",
          text: nextPrompt,
          attachments: turnAttachments,
        },
        modelSelection: selectedDispatchModelSelection,
        runtimeMode: selectedRuntimeMode,
        interactionMode: selectedInteractionMode,
        ...(isFirstUserMessage && nextThreadTitle ? { titleSeed: nextThreadTitle } : {}),
        skills,
        createdAt: messageCreatedAt,
      })
    } catch (error) {
      clearPendingTurnStart()
      removeOptimisticUserMessage(messageId)
      // Revoke blob URLs from the removed optimistic message before restoring
      revokeUserMessagePreviewUrls(optimisticMessage)
      // Deep-clone images with fresh blob URLs for retry
      onComposerRestore(nextPrompt, composerImages.map(cloneComposerImageForRetry) as ComposerImageDraft[])
      onError(toErrorMessage(error))
    } finally {
      sendInFlightRef.current = false
      setIsSending(false)
    }
  }, [
    addOptimisticUserMessage,
    clearPendingTurnStart,
    composer,
    composerImages,
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
    workspaceId,
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

export const composerImageLimits = {
  maxAttachments: PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  maxImageBytes: PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
} as const
