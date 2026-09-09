import {
  useCallback,
  useEffect,
  useState,
  type ClipboardEventHandler,
  type Dispatch,
  type MutableRefObject,
  type SetStateAction,
} from "react"
import {
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ProviderKind,
} from "@cozea/assistant-contracts"
import type {
  PreviewAnnotationPayload,
  PreviewAnnotationSubmission,
} from "@cozea/contracts/t3/ipc"

import { providerImageRejection } from "@/features/assistant/chat/providerInputCapabilities"
import type { ComposerImageDraft } from "@/features/assistant/model/assistantComposerTypes"
import {
  appendComposerMentions,
  partitionDroppedComposerFiles,
} from "@/features/assistant/chat/composerDroppedFiles"
import type { PendingUserInput } from "@/features/assistant/chat/session-logic"
import { clampCollapsedComposerCursor } from "@/features/assistant/composer-logic"
import { newMessageId } from "@/features/assistant/lib/utils"
import {
  previewAnnotationScreenshotFile,
} from "@/features/browser/previewAnnotation"

interface UseAssistantComposerAttachmentsInput {
  composer: string
  setComposer: Dispatch<SetStateAction<string>>
  setComposerCursor: Dispatch<SetStateAction<number>>
  composerImages: ComposerImageDraft[]
  setComposerImages: Dispatch<SetStateAction<ComposerImageDraft[]>>
  previewAnnotations: PreviewAnnotationPayload[]
  setPreviewAnnotations: Dispatch<SetStateAction<PreviewAnnotationPayload[]>>
  pendingUserInputs: readonly PendingUserInput[]
  selectedProvider: ProviderKind
  workspaceRoot: string | null
  isSending: boolean
  sendInFlightRef: MutableRefObject<boolean>
  requestSend: () => Promise<void>
  setSendError: Dispatch<SetStateAction<string | null>>
}

export function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) return
  URL.revokeObjectURL(previewUrl)
}

export interface PreparedComposerImages {
  images: ComposerImageDraft[]
  error: string | null
}

export function prepareComposerImageAttachments(
  files: readonly File[],
  currentImages: readonly ComposerImageDraft[],
  selectedProvider: ProviderKind,
): PreparedComposerImages {
  const images: ComposerImageDraft[] = []
  let nextImageCount = currentImages.length
  let error: string | null = null

  for (const file of files) {
    if (!file.type.startsWith("image/")) {
      error = `Unsupported file type for '${file.name}'. Attach image files only.`
      continue
    }
    const rejection = providerImageRejection(selectedProvider, [
      ...currentImages,
      ...images,
      { mimeType: file.type, sizeBytes: file.size },
    ])
    if (rejection) {
      error = rejection
      continue
    }
    if (file.size > PROVIDER_SEND_TURN_MAX_IMAGE_BYTES) {
      const maxMb = Math.round(PROVIDER_SEND_TURN_MAX_IMAGE_BYTES / (1024 * 1024))
      error = `'${file.name}' exceeds the ${maxMb}MB attachment limit.`
      continue
    }
    if (nextImageCount >= PROVIDER_SEND_TURN_MAX_ATTACHMENTS) {
      error = `You can attach up to ${PROVIDER_SEND_TURN_MAX_ATTACHMENTS} images per message.`
      break
    }
    images.push({
      id: newMessageId(),
      name: file.name || "image",
      mimeType: file.type,
      sizeBytes: file.size,
      previewUrl: "",
      file,
    })
    nextImageCount += 1
  }

  return { images, error }
}

/** Owns composer attachment validation, preview lifecycle, and annotation auto-send. */
export function useAssistantComposerAttachments(
  input: UseAssistantComposerAttachmentsInput,
) {
  const {
    composer,
    composerImages,
    isSending,
    pendingUserInputs,
    previewAnnotations,
    requestSend,
    selectedProvider,
    sendInFlightRef,
    setComposer,
    setComposerCursor,
    setComposerImages,
    setPreviewAnnotations,
    setSendError,
    workspaceRoot,
  } = input
  const [autoSendAnnotationId, setAutoSendAnnotationId] = useState<string | null>(null)

  useEffect(() => {
    if (!autoSendAnnotationId || isSending || sendInFlightRef.current) return
    const annotation = previewAnnotations.find(
      (candidate) => candidate.id === autoSendAnnotationId,
    )
    if (!annotation) return
    setAutoSendAnnotationId(null)
    void requestSend()
  }, [autoSendAnnotationId, isSending, previewAnnotations, requestSend, sendInFlightRef])

  const attachPreviewAnnotation = useCallback(
    async (
      annotation: PreviewAnnotationPayload,
      submission: PreviewAnnotationSubmission,
    ): Promise<void> => {
      setPreviewAnnotations((current) => [
        ...current.filter((candidate) => candidate.id !== annotation.id),
        annotation,
      ])
      try {
        const file = await previewAnnotationScreenshotFile(annotation)
        const screenshot = annotation.screenshot
        if (file && screenshot) {
          setComposerImages((current) => [
            ...current.filter((image) => image.id !== annotation.id),
            {
              id: annotation.id,
              name: file.name,
              mimeType: file.type,
              sizeBytes: file.size,
              previewUrl: screenshot.dataUrl,
              file,
            },
          ])
        }
      } catch {
        // The exact structured T3 payload remains sendable if screenshot conversion fails.
      }
      if (submission === "send") setAutoSendAnnotationId(annotation.id)
    },
    [setComposerImages, setPreviewAnnotations],
  )

  const removePreviewAnnotation = useCallback(
    (annotationId: string) => {
      setPreviewAnnotations((current) =>
        current.filter((annotation) => annotation.id !== annotationId),
      )
      setComposerImages((current) =>
        current.filter((image) => {
          if (image.id !== annotationId) return true
          revokeBlobPreviewUrl(image.previewUrl)
          return false
        }),
      )
      setAutoSendAnnotationId((current) => (current === annotationId ? null : current))
    },
    [setComposerImages, setPreviewAnnotations],
  )

  const addComposerImages = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      if (pendingUserInputs.some((request) => request.responseMode !== "message")) {
        setSendError("Attach images after answering pending questions.")
        return
      }
      const { images: nextImages, error } = prepareComposerImageAttachments(
        files,
        composerImages,
        selectedProvider,
      )

      if (nextImages.length > 0) {
        setComposerImages((current) => [...current, ...nextImages])
      }
      if (error) setSendError(error)
    },
    [composerImages, pendingUserInputs, selectedProvider, setComposerImages, setSendError],
  )

  const removeComposerImage = useCallback(
    (imageId: string) => {
      setComposerImages((current) =>
        current.filter((image) => {
          if (image.id !== imageId) return true
          revokeBlobPreviewUrl(image.previewUrl)
          return false
        }),
      )
    },
    [setComposerImages],
  )

  const addComposerFiles = useCallback(
    (files: File[]) => {
      if (files.length === 0) return
      if (pendingUserInputs.length > 0) {
        setSendError("Attach files after answering pending questions.")
        return
      }

      const { images, mentionPaths, unresolvedNames } = partitionDroppedComposerFiles(files, {
        resolvePath: window.electronAPI?.getPathForFile,
        workspaceRoot,
      })
      if (mentionPaths.length > 0) {
        const nextComposer = appendComposerMentions(composer, mentionPaths)
        setComposer(nextComposer)
        setComposerCursor(
          clampCollapsedComposerCursor(nextComposer, Number.POSITIVE_INFINITY),
        )
      }
      addComposerImages(images)

      if (unresolvedNames.length > 0) {
        const names = unresolvedNames.map((name) => `'${name}'`).join(", ")
        setSendError(
          `Cozea could not read a local path for ${names}. Save the file to disk, then drop it in.`,
        )
      }
    },
    [
      addComposerImages,
      composer,
      pendingUserInputs.length,
      setComposer,
      setComposerCursor,
      setSendError,
      workspaceRoot,
    ],
  )

  const handleComposerPaste: ClipboardEventHandler<HTMLElement> = useCallback(
    (event) => {
      const files = Array.from(event.clipboardData.files)
      if (files.length === 0) return
      const imageFiles = files.filter((file) => file.type.startsWith("image/"))
      if (imageFiles.length === 0) return
      event.preventDefault()
      addComposerImages(imageFiles)
    },
    [addComposerImages],
  )

  return {
    addComposerFiles,
    attachPreviewAnnotation,
    handleComposerPaste,
    removeComposerImage,
    removePreviewAnnotation,
  }
}
