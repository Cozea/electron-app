import { useCallback, useEffect, useMemo, useRef, useState, type ClipboardEventHandler, type ComponentProps } from "react"

import {

  ApprovalRequestId,
  PROVIDER_SEND_TURN_MAX_ATTACHMENTS,
  PROVIDER_SEND_TURN_MAX_IMAGE_BYTES,
  type ModelSelection,
  type OrchestrationGetTurnDiffResult,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderInstanceId,
  type ProviderKind,
  type RuntimeMode,
  type TurnId,
} from "@cozea/assistant-contracts"
import {
  buildProviderOptionSelectionsFromDescriptors,
  getModelSelectionOptionDescriptors,
  resolveModelSlugForProvider,
  resolveSelectableModel,
  setProviderOptionSelectionValue,
} from "@cozea/assistant-shared/model"

import { Button } from "@/components/ui/button"
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  inferCheckpointTurnCountByTurnId,
} from "@/features/projects/components/assistant/chat/session-logic"
import {
  CozeaChatSurface,
  type ComposerImageDraft,
  type ProviderModelOptionsByProvider,
  type UserInputAnswerDrafts,
} from "@/features/projects/components/assistant/chat/CozeaChatSurface"
import {
  getAssistantComposerDraft,
  useAssistantComposerDraftStore,
} from "@/features/projects/components/assistant/chat/composerDraftStore"
import { ProviderRemediationAction } from "@/features/projects/components/assistant/chat/ProviderRemediationAction"
import {
  deriveThreadImageArtifacts,
  type ThreadImageArtifact,
} from "@/features/projects/components/assistant/artifacts/threadArtifacts"
import {
  useThreadArtifactMedia,
  type ThreadArtifactMediaState,
} from "@/features/projects/components/assistant/artifacts/useThreadArtifactMedia"
import { deriveLatestContextWindowSnapshot } from "@/features/projects/components/assistant/lib/contextWindow"
import {
  newCommandId,
  newMessageId,
  newProjectId,
  newThreadId,
} from "@/features/projects/components/assistant/lib/utils"
import {
  refreshAssistantRuntimeSnapshot,
  useAssistantRuntimeSync,
} from "@/features/projects/components/workbench/useAssistantRuntimeSync"
import { useAssistantRuntimeStatus } from "@/features/projects/components/workbench/useAssistantRuntimeStatus"
import { useSubstrateRpcChat } from "@/features/projects/components/workbench/assistant/useSubstrateRpcChat"
import { useSubstrateChatTransport } from "@/substrate/useSubstrateChatTransport"
import { useSubstrateOrchestrationSync } from "@/substrate/useSubstrateOrchestrationSync"
import { resolveOrchestrationApi } from "@/substrate/resolveOrchestrationApi"
import { useT3CutoverActive } from "@/substrate/t3CutoverStore"
import { sendSubstrateRpcTurn } from "@/substrate/sendSubstrateRpcTurn"
import { deleteAssistantThread } from "@/features/projects/lib/deleteAssistantThread"
import { useTileThreadStream } from "@/substrate/useTileThreadStream"
import { ensureNativeApi } from "@/lib/nativeApi"
import { projectAnalysisDesktopClient } from "@/lib/projectAnalysis/projectAnalysisDesktopClient"
import { getProviderModelCapabilities } from "@/stores/providerModels"
import {
  createAssistantProjectSelectorForTile,
  createAssistantThreadSelectorById,
  selectAssistantProjectByCwd,
  selectAssistantProjectById,
  selectAssistantThreadById,
  selectAssistantThreads,
  useStore,
} from "@/stores/assistant-store"
import type { ChatMessage, Project, Thread } from "@/stores/types"
import {
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  useProjectWorkbenchStore,
  flushWorkbenchStorage,
} from "@/stores/useProjectWorkbenchStore"

import { useAssistantServerConfig } from "./useAssistantServerConfig"
import { useAssistantTurnLifecycle } from "./useAssistantTurnLifecycle"
import {
  resolvePlanFollowUpSubmission,
} from "@/features/projects/components/assistant/proposedPlan"
import {
  findLatestProposedPlan,
  hasActionableProposedPlan,
} from "@/features/projects/components/assistant/chat/timelineDerivations"
import {
  type DiffDialogState,
  basenameFromPath,
  cloneComposerImageForRetry,
  deriveAssistantTurnRunning,
  deriveTitleSeed,
  getLiveAssistantTile,
  getProviderModelOptions,
  getProviderSnapshot,
  normalizeModelSelection,
  resolveInteractionMode,
  resolvePreferredModelSelection,
  resolveRememberedModelSelection,
  resolveRuntimeMode,
  revokeUserMessagePreviewUrls,
  toErrorMessage,
  withWorkspaceBindingLock,
  withModelSelectionModel,
} from "./workbenchAssistantShared"

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __AlertCircleHugeIcon } from '@hugeicons/core-free-icons'

interface UseWorkbenchAssistantTileControllerInput {
  projectId: string
  laneId: string
  workspaceId: string | null
  projectRootPath: string | null
  tile: WorkbenchAssistantChatTileRecord
}

interface WorkbenchAssistantTileControllerResult {
  chatTitle: string
  showTitleSpinner: boolean
  diffDialog: DiffDialogState | null
  closeDiffDialog: () => void
  handleDeleteThread: () => Promise<boolean>
  artifacts: ReadonlyArray<ThreadImageArtifact>
  artifactMedia: ThreadArtifactMediaState
  surfaceProps: ComponentProps<typeof CozeaChatSurface>
}

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

function revokeBlobPreviewUrl(previewUrl: string | undefined): void {
  if (!previewUrl || typeof URL === "undefined" || !previewUrl.startsWith("blob:")) {
    return
  }
  URL.revokeObjectURL(previewUrl)
}

export function useWorkbenchAssistantTileController(
  input: UseWorkbenchAssistantTileControllerInput,
): WorkbenchAssistantTileControllerResult {
  const assistantRuntime = useAssistantRuntimeStatus()
  // Phase 2 flagged path (default off): connect via substrate shadow RPC when enabled.
  const substrateRpcChat = useSubstrateRpcChat()
  const substrateTransport = useSubstrateChatTransport()
  const t3CutoverActive = useT3CutoverActive()
  const getOrchestration = useCallback(
    () => resolveOrchestrationApi(t3CutoverActive ? ensureNativeApi().orchestration : null),
    [t3CutoverActive],
  )
  useSubstrateOrchestrationSync({
    active: substrateTransport.active,
    shadowBaseUrl: substrateTransport.shadowBaseUrl,
  })
  useEffect(() => {
    if (substrateTransport.active) {
      console.info("[substrate] primary chat transport active", {
        shadowBaseUrl: substrateTransport.shadowBaseUrl,
        rpcChat: substrateTransport.shadowStatus?.features.rpcChat ?? false,
        providers: substrateTransport.shadowStatus?.features.providers ?? false,
      })
    }
  }, [
    substrateTransport.active,
    substrateTransport.shadowBaseUrl,
    substrateTransport.shadowStatus?.features.providers,
    substrateTransport.shadowStatus?.features.rpcChat,
  ])
  if (substrateRpcChat.enabled && substrateRpcChat.lastError) {
    console.warn("[substrate.rpcChat]", substrateRpcChat.lastError)
  }
  const isRuntimeReady = assistantRuntime.phase === "ready" || (substrateTransport.active && t3CutoverActive)
  const isChatReady = isRuntimeReady || substrateTransport.active
  const runtimeErrorMessage =
    assistantRuntime.phase === "error"
      ? assistantRuntime.lastError?.trim() || "Local chat runtime is unavailable."
      : null

  useAssistantRuntimeSync(isChatReady && !substrateTransport.active)

  const {
    config,
    error: configError,
    isLoading: isConfigLoading,
  } = useAssistantServerConfig(isChatReady)
  const [composer, setComposer] = useState("")
  const [composerCursor, setComposerCursor] = useState(0)
  const [sendError, setSendError] = useState<string | null>(null)
  const [composerImages, setComposerImages] = useState<ComposerImageDraft[]>([])
  const [bindingError, setBindingError] = useState<string | null>(null)
  const [isBinding, setIsBinding] = useState(false)
  const [bindingRevision, setBindingRevision] = useState(0)
  const [isSending, setIsSending] = useState(false)
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false)
  const [activeRequestKey, setActiveRequestKey] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [diffDialog, setDiffDialog] = useState<DiffDialogState | null>(null)
  const [userInputDrafts, setUserInputDrafts] = useState<UserInputAnswerDrafts>({})
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([])
  const updateAssistantTile = useProjectWorkbenchStore((state) => state.actions.updateAssistantTile)
  const upsertComposerDraft = useAssistantComposerDraftStore((state) => state.upsertDraft)
  const adoptComposerDraft = useAssistantComposerDraftStore((state) => state.adoptDraft)
  const lastModelSelectionByInstanceId = useAssistantComposerDraftStore(
    (state) => state.lastModelSelectionByInstanceId,
  )
  const setThreadError = useStore((state) => state.setError)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const bindingInFlightRef = useRef(false)
  const sendInFlightRef = useRef(false)

  const assistantProjectSelector = useMemo(
    () =>
      createAssistantProjectSelectorForTile({
        assistantProjectId: input.tile.assistantProjectId,
        projectPath: input.projectRootPath,
      }),
    [input.projectRootPath, input.tile.assistantProjectId],
  )
  const threadSelector = useMemo(
    () => createAssistantThreadSelectorById(input.tile.threadId),
    [input.tile.threadId],
  )
  const assistantProject = useStore(assistantProjectSelector)
  const thread = useStore(threadSelector)
  const threadStream = useTileThreadStream(input.tile.threadId)
  const draftTargetKey = thread?.id ?? input.tile.id
  const composerDraft = useAssistantComposerDraftStore(
    useCallback(
      (state) => state.draftsByTargetKey[draftTargetKey] ?? null,
      [draftTargetKey],
    ),
  )

  // Absolute filesystem root of the bound workspace, used to trim absolute
  // tool/changedFiles/proposed-plan paths down to workspace-relative labels in
  // the timeline. The runtime context already exposes the real root via
  // `input.projectRootPath`; only fall back to resolving from the opaque
  // workspaceId when that is unavailable.
  const [resolvedWorkspaceRoot, setResolvedWorkspaceRoot] = useState<string | null>(null)
  useEffect(() => {
    if (input.projectRootPath) {
      setResolvedWorkspaceRoot(input.projectRootPath)
      return
    }
    if (!input.workspaceId) {
      setResolvedWorkspaceRoot(null)
      return
    }
    let cancelled = false
    const workspaceId = input.workspaceId
    void projectAnalysisDesktopClient
      .resolveRoot(workspaceId)
      .then((root) => {
        if (!cancelled) {
          setResolvedWorkspaceRoot(root)
        }
      })
      .catch(() => {
        if (!cancelled) {
          setResolvedWorkspaceRoot(null)
        }
      })
    return () => {
      cancelled = true
    }
  }, [input.projectRootPath, input.workspaceId])

  useEffect(() => {
    if (!thread?.id) {
      return
    }
    adoptComposerDraft(input.tile.id, thread.id)
  }, [adoptComposerDraft, input.tile.id, thread?.id])

  useEffect(() => {
    setOptimisticUserMessages([])
    setComposerImages((current) => {
      for (const image of current) {
        revokeBlobPreviewUrl(image.previewUrl)
      }
      return []
    })
  }, [thread?.id])

  useEffect(() => {
    if (!thread || optimisticUserMessages.length === 0) {
      return
    }
    const serverMessageIds = new Set(thread.messages.map((message) => message.id))
    if (!optimisticUserMessages.some((message) => serverMessageIds.has(message.id))) {
      return
    }
    setOptimisticUserMessages((current) => {
      const removed = current.filter((message) => serverMessageIds.has(message.id))
      for (const message of removed) {
        if (!message.attachments) continue
        for (const attachment of message.attachments) {
          if (attachment.type !== "image") continue
          revokeBlobPreviewUrl(attachment.previewUrl)
        }
      }
      return current.filter((message) => !serverMessageIds.has(message.id))
    })
  }, [optimisticUserMessages, thread])

  const fallbackModelSelection = useMemo(() => {
    const fallbackSelection = resolvePreferredModelSelection({
      config,
      tile: input.tile,
      projectModelSelection: assistantProject?.defaultModelSelection,
    })
    return resolveRememberedModelSelection({
      fallbackSelection,
      explicitTileModel: input.tile.model,
      rememberedSelection:
        lastModelSelectionByInstanceId[fallbackSelection.instanceId] ?? null,
      selectableModels: getProviderModelOptions(
        config,
        fallbackSelection.provider,
        fallbackSelection.instanceId,
      ),
    })
  }, [
    assistantProject?.defaultModelSelection,
    config,
    input.tile,
    lastModelSelectionByInstanceId,
  ])
  const selectedModelSelection =
    composerDraft?.modelSelection ?? thread?.modelSelection ?? fallbackModelSelection
  const selectedDispatchModelSelection = useMemo(
    () => withModelSelectionModel(selectedModelSelection, selectedModelSelection.model),
    [selectedModelSelection],
  )

  const selectedRuntimeMode =
    composerDraft?.runtimeMode ?? thread?.runtimeMode ?? resolveRuntimeMode(input.tile)
  const selectedInteractionMode =
    composerDraft?.interactionMode ?? thread?.interactionMode ?? resolveInteractionMode(input.tile)
  const selectedProvider = selectedModelSelection.provider
  const selectedProviderInstanceId = selectedModelSelection.instanceId
  const providerSnapshot = getProviderSnapshot(config, selectedProvider, selectedProviderInstanceId)
  const modelOptionsByProvider = useMemo<ProviderModelOptionsByProvider>(
    () => ({
      codex: getProviderModelOptions(config, "codex"),
      claudeAgent: getProviderModelOptions(config, "claudeAgent"),
      cursor: getProviderModelOptions(config, "cursor"),
      opencode: getProviderModelOptions(config, "opencode"),
    }),
    [config],
  )

  const mergedThread = useMemo(() => {
    if (!thread && !input.tile.threadId) {
      return null
    }

    const base = thread ?? {
      id: input.tile.threadId as any,
      projectId: input.tile.assistantProjectId as any,
      title: input.tile.agentLabel?.trim() || input.tile.title.trim() || "AI Agent",
      modelSelection: selectedDispatchModelSelection,
      runtimeMode: selectedRuntimeMode,
      interactionMode: selectedInteractionMode,
      session: null,
      messages: [],
      proposedPlans: [],
      error: null,
      createdAt: new Date().toISOString(),
      latestTurn: null,
      branch: null,
      worktreePath: null,
      turnDiffSummaries: [],
      activities: [],
    }

    const streamMessages = threadStream.messages.length > 0 ? threadStream.messages : base.messages
    const streamActivities = threadStream.activities.length > 0 ? threadStream.activities : base.activities
    const streamPlans = threadStream.proposedPlans.length > 0 ? threadStream.proposedPlans : base.proposedPlans
    const streamDiffs = threadStream.turnDiffSummaries.length > 0 ? threadStream.turnDiffSummaries : base.turnDiffSummaries

    return {
      ...base,
      messages: streamMessages,
      activities: streamActivities,
      proposedPlans: streamPlans,
      turnDiffSummaries: streamDiffs,
    } as unknown as Thread
  }, [
    input.tile.assistantProjectId,
    input.tile.threadId,
    input.tile.title,
    input.tile.agentLabel,
    selectedDispatchModelSelection,
    selectedInteractionMode,
    selectedRuntimeMode,
    thread,
    threadStream,
  ])

  const visibleThread = useMemo(() => {
    if (!mergedThread || optimisticUserMessages.length === 0) {
      return mergedThread
    }
    const serverMessageIds = new Set(mergedThread.messages.map((message) => message.id))
    const pendingMessages = optimisticUserMessages.filter(
      (message) => !serverMessageIds.has(message.id),
    )
    if (pendingMessages.length === 0) {
      return mergedThread
    }
    return {
      ...mergedThread,
      messages: [...mergedThread.messages, ...pendingMessages],
    }
  }, [mergedThread, optimisticUserMessages])
  const artifacts = useMemo(
    () => deriveThreadImageArtifacts(visibleThread?.id, visibleThread?.activities ?? []),
    [visibleThread?.activities, visibleThread?.id],
  )
  const artifactMedia = useThreadArtifactMedia(visibleThread?.id, artifacts, {
    active: substrateTransport.active,
    shadowBaseUrl: substrateTransport.shadowBaseUrl,
  })
  const providerModelOptions = useMemo(() => {
    const options = getProviderModelOptions(config, selectedProvider, selectedProviderInstanceId)
    if (options.some((option) => option.slug === selectedModelSelection.model)) {
      return options
    }
    return [
      {
        slug: selectedModelSelection.model,
        name: selectedModelSelection.model,
      },
      ...options,
    ]
  }, [config, selectedModelSelection.model, selectedProvider, selectedProviderInstanceId])
  const selectedModelCapabilities = useMemo(
    () =>
      getProviderModelCapabilities(
        providerSnapshot?.models ?? [],
        selectedModelSelection.model,
        selectedProvider,
      ),
    [providerSnapshot?.models, selectedModelSelection.model, selectedProvider],
  )
  const selectedModelOptionDescriptors = useMemo(
    () => getModelSelectionOptionDescriptors(selectedModelSelection, selectedModelCapabilities),
    [selectedModelCapabilities, selectedModelSelection],
  )
  const latestTurnId = visibleThread?.latestTurn?.turnId
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(visibleThread?.activities ?? []),
    [visibleThread?.activities],
  )
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(visibleThread?.activities ?? []),
    [visibleThread?.activities],
  )
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(visibleThread?.activities ?? []),
    [visibleThread?.activities],
  )
  const turnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(visibleThread?.turnDiffSummaries ?? []),
    [visibleThread?.turnDiffSummaries],
  )
  const isRunning = deriveAssistantTurnRunning({
    orchestrationStatus: thread?.session?.orchestrationStatus,
    streamIsStreaming: threadStream.isStreaming,
  })
  const {
    isInterrupting,
    isForceStopAvailable,
    isTurnStartPending,
    pendingTurnStartStartedAtIso,
    clearPendingTurnStart,
    notePendingTurnStart,
    handleInterrupt,
  } = useAssistantTurnLifecycle({
    thread: visibleThread,
    isRuntimeReady,
    runtimeErrorMessage,
    isRunning,
    onError: setSendError,
  })

  // Plan follow-up state — detect when the agent has proposed a plan and we're
  // in plan mode, so that handleSend can intercept and route to the plan
  // follow-up submission flow instead of a normal turn.
  const activeProposedPlan = useMemo(
    () =>
      findLatestProposedPlan(
        visibleThread?.proposedPlans ?? [],
        visibleThread?.latestTurn?.turnId ?? null,
      ),
    [visibleThread?.latestTurn?.turnId, visibleThread?.proposedPlans],
  )
  const latestTurnSettled = !isRunning && !isTurnStartPending && !isInterrupting
  const showPlanFollowUpPrompt =
    pendingUserInputs.length === 0 &&
    selectedInteractionMode === "plan" &&
    latestTurnSettled &&
    hasActionableProposedPlan(activeProposedPlan)
  const hasBoundThread = Boolean(input.tile.threadId && (thread || mergedThread))
  const visibleBindingState = isRuntimeReady && !hasBoundThread && isBinding
  const chatTitle =
    visibleThread?.title?.trim() ||
    input.tile.agentLabel?.trim() ||
    input.tile.title.trim() ||
    "AI Agent"
  const showTitleSpinner =
    isRunning ||
    isTurnStartPending ||
    isInterrupting ||
    assistantRuntime.phase === "starting" ||
    (visibleBindingState && !bindingError)

  useEffect(() => {
    if (isRuntimeReady) {
      return
    }

    bindingInFlightRef.current = false
    setIsBinding(false)
  }, [isRuntimeReady])

  useEffect(() => {
    if (!thread) {
      return
    }

    const patch: Partial<WorkbenchAssistantChatTileRecord> = {}

    if (input.tile.assistantProjectId !== thread.projectId) {
      patch.assistantProjectId = thread.projectId
    }
    if (input.tile.threadId !== thread.id) {
      patch.threadId = thread.id
    }
    if (input.tile.title !== thread.title) {
      patch.title = thread.title
    }
    if (input.tile.provider !== thread.modelSelection.provider) {
      patch.provider = thread.modelSelection.provider
    }
    if (input.tile.model !== thread.modelSelection.model) {
      patch.model = thread.modelSelection.model
    }
    if (input.tile.runtimeMode !== thread.runtimeMode) {
      patch.runtimeMode = thread.runtimeMode
    }
    if (input.tile.interactionMode !== thread.interactionMode) {
      patch.interactionMode = thread.interactionMode
    }

    if (Object.keys(patch).length === 0) {
      return
    }

    updateAssistantTile(input.projectId, input.laneId, input.tile.id, patch, input.workspaceId)
  }, [input.laneId, input.projectId, input.workspaceId, input.tile, thread, updateAssistantTile])

  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) {
      return
    }
    timeline.scrollTop = timeline.scrollHeight
  }, [
    latestTurnId,
    visibleThread?.messages.length,
    pendingApprovals.length,
    pendingUserInputs.length,
  ])

  useEffect(() => {
    if (!isRuntimeReady || !input.workspaceId || !input.projectRootPath) {
      return
    }
    setBindingError(null)
    const workspaceRoot = input.projectRootPath
    if (bindingInFlightRef.current) {
      return
    }
    if (hasBoundThread) {
      setBindingError(null)
      setIsBinding(false)
      return
    }

    let cancelled = false
    bindingInFlightRef.current = true
    setIsBinding(true)

    const ensureBinding = async () => {
      try {
        if (cancelled) return

        // For fresh tiles (no threadId), only resolve/create the project.
        // Thread creation is deferred to the first send to avoid empty thread
        // accumulation when users open tiles and close them without typing.
        const isResumingExistingThread = Boolean(input.tile.threadId)

        if (!isResumingExistingThread) {
          const currentAssistantState = useStore.getState()
          const existingProject =
            (input.tile.assistantProjectId
              ? selectAssistantProjectById(currentAssistantState, input.tile.assistantProjectId)
              : null) ??
            selectAssistantProjectByCwd(currentAssistantState, workspaceRoot) ??
            null

          if (existingProject) {
            if (input.tile.assistantProjectId !== existingProject.id) {
              updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
                assistantProjectId: existingProject.id,
              }, input.workspaceId)
            }
            setBindingError(null)
            setIsBinding(false)
            return
          }
        }

        await withWorkspaceBindingLock(workspaceRoot, async () => {
          const api = ensureNativeApi()
          const liveTile = () =>
            getLiveAssistantTile(input.projectId, input.laneId, input.tile.id, input.workspaceId) ?? input.tile
          const liveConfig = config ?? (await api.server.getConfig().catch(() => null))

          // The runtime can report ready before the renderer has applied its
          // first orchestration snapshot. Resolve the authoritative project
          // collection before deciding that this workspace needs a new T3
          // project; otherwise project.create is rejected as a duplicate and
          // the tile can remain stuck in its binding state.
          const currentSnapshot = await getOrchestration().getSnapshot()
          useStore.getState().syncServerReadModel(currentSnapshot)

          const currentTile = liveTile()
          const currentAssistantState = useStore.getState()
          let nextProject =
            (currentTile.assistantProjectId
              ? selectAssistantProjectById(currentAssistantState, currentTile.assistantProjectId)
              : null) ??
            selectAssistantProjectByCwd(currentAssistantState, workspaceRoot) ??
            null

          if (!nextProject) {
            const projectId = newProjectId()
            const defaultModelSelection = normalizeDraftModelSelection(
              getAssistantComposerDraft(currentTile.id)?.modelSelection ??
                resolvePreferredModelSelection({
                  config: liveConfig,
                  tile: currentTile,
                  projectModelSelection: null,
                }),
            )
            try {
              await getOrchestration().dispatchCommand({
                type: "project.create",
                commandId: newCommandId(),
                projectId,
                title: basenameFromPath(workspaceRoot),
                workspaceRoot,
                defaultModelSelection,
                createdAt: new Date().toISOString(),
              })
            } catch (createError: unknown) {
              const errMsg = createError instanceof Error ? `${createError.message} ${createError.stack ?? ""}` : JSON.stringify(createError);
              const match = errMsg.match(/Active project (?:\\'|'|")([^'\\" ]+)(?:\\'|'|") already exists/);
              if (match && match[1]) {
                const existingId = match[1];
                const currentReadModel = useStore.getState().orchestrationReadModel;
                useStore.getState().syncServerReadModel({
                  snapshotSequence: currentReadModel?.snapshotSequence ?? 0,
                  projects: [
                    ...(currentReadModel?.projects ?? []).filter((p) => p.id !== existingId),
                    {
                      id: existingId as any,
                      title: basenameFromPath(workspaceRoot),
                      workspaceRoot,
                      defaultModelSelection: null,
                      scripts: [],
                      createdAt: new Date().toISOString(),
                      updatedAt: new Date().toISOString(),
                    } as any,
                  ],
                  threads: currentReadModel?.threads ?? [],
                  updatedAt: new Date().toISOString(),
                });
                nextProject = useStore.getState().projectById[existingId as any] ?? null;
              } else {
                throw createError;
              }
            }
            const nextAssistantState = useStore.getState()
            nextProject =
              nextProject ??
              selectAssistantProjectById(nextAssistantState, projectId) ??
              selectAssistantProjectByCwd(nextAssistantState, workspaceRoot) ??
              null
          }

          if (!nextProject) {
            throw new Error("Unable to create an assistant project for this workspace.")
          }

          if (isResumingExistingThread) {
            // Resuming an existing thread: create if needed (same as before)
            const resolvedTile = liveTile()
            let nextThread =
              (resolvedTile.threadId
                ? selectAssistantThreadById(useStore.getState(), resolvedTile.threadId)
                : null) ?? null

            if (!nextThread || nextThread.projectId !== nextProject.id) {
              const threadId = newThreadId()
              const threadDraft = getAssistantComposerDraft(resolvedTile.id)
              const modelSelection = normalizeDraftModelSelection(
                threadDraft?.modelSelection ??
                  resolvePreferredModelSelection({
                    config: liveConfig,
                    tile: resolvedTile,
                    projectModelSelection: nextProject.defaultModelSelection,
                  }),
              )
              await getOrchestration().dispatchCommand({
                type: "thread.create",
                commandId: newCommandId(),
                threadId,
                projectId: nextProject.id,
                title: resolvedTile.agentLabel?.trim() || resolvedTile.title.trim() || "AI Agent",
                modelSelection,
                runtimeMode: threadDraft?.runtimeMode ?? resolveRuntimeMode(resolvedTile),
                interactionMode:
                  threadDraft?.interactionMode ?? resolveInteractionMode(resolvedTile),
                branch: null,
                worktreePath: null,
                createdAt: new Date().toISOString(),
              })
              nextThread =
                selectAssistantThreadById(useStore.getState(), threadId) ?? null
            }

            const latestTile = liveTile()
            const patch: Partial<WorkbenchAssistantChatTileRecord> = {}

            if (latestTile.assistantProjectId !== nextProject.id) {
              patch.assistantProjectId = nextProject.id
            }
            if (nextThread && latestTile.threadId !== nextThread.id) {
              patch.threadId = nextThread.id
            }
            if (nextThread && latestTile.provider !== nextThread.modelSelection.provider) {
              patch.provider = nextThread.modelSelection.provider
            }
            if (nextThread && latestTile.model !== nextThread.modelSelection.model) {
              patch.model = nextThread.modelSelection.model
            }
            if (latestTile.runtimeMode !== resolveRuntimeMode(latestTile)) {
              patch.runtimeMode = resolveRuntimeMode(latestTile)
            }
            if (latestTile.interactionMode !== resolveInteractionMode(latestTile)) {
              patch.interactionMode = resolveInteractionMode(latestTile)
            }

            if (!cancelled && Object.keys(patch).length > 0) {
              updateAssistantTile(input.projectId, input.laneId, input.tile.id, patch, input.workspaceId)
            }
          } else {
            // --- Fix 6: Fresh tile --- just bind the project, no thread yet
            const latestTile = liveTile()
            if (!cancelled && latestTile.assistantProjectId !== nextProject.id) {
              updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
                assistantProjectId: nextProject.id,
              }, input.workspaceId)
            }
          }

          if (!cancelled) {
            setBindingError(null)
          }
        })
      } catch (error) {
        if (!cancelled) {
          setBindingError(toErrorMessage(error))
        }
      } finally {
        bindingInFlightRef.current = false
        if (!cancelled) {
          setIsBinding(false)
        }
      }
    }

    void ensureBinding()

    return () => {
      cancelled = true
    }
  }, [
    bindingRevision,
    config,
    hasBoundThread,
    input.laneId,
    input.projectId,
    input.workspaceId,
    input.projectRootPath,
    input.tile,
    isRuntimeReady,
    updateAssistantTile,
  ])

  const runMetaSync = async (
    mutate: () => Promise<void>,
    options?: { requestKey?: string },
  ) => {
    if (options?.requestKey) {
      setActiveRequestKey(options.requestKey)
    }
    setRequestError(null)
    try {
      await mutate()
    } catch (error) {
      setRequestError(toErrorMessage(error))
    } finally {
      if (options?.requestKey) {
        setActiveRequestKey(null)
      }
    }
  }

  const normalizeDraftModelSelection = useCallback(
    (selection: ModelSelection) =>
      normalizeModelSelection({
        provider: selection.provider,
        instanceId: selection.instanceId,
        model: selection.model,
        options: buildProviderOptionSelectionsFromDescriptors(
          getModelSelectionOptionDescriptors(
            selection,
            getProviderModelCapabilities(
              getProviderSnapshot(config, selection.provider, selection.instanceId)?.models ?? [],
              selection.model,
              selection.provider,
            ),
          ),
        ),
      }),
    [config],
  )

  const handleProviderChange = async (
    nextProviderValue: string,
    nextModelValue?: string,
    nextInstanceId?: ProviderInstanceId,
  ) => {
    const nextProvider = nextProviderValue as ProviderKind
    const preferredModelSelection = resolvePreferredModelSelection({
      config,
      tile: {
        ...input.tile,
        provider: nextProvider,
        providerInstanceId: nextInstanceId,
        model: nextModelValue ?? null,
      },
      projectModelSelection: assistantProject?.defaultModelSelection,
      provider: nextProvider,
      providerInstanceId: nextInstanceId,
    })
    const nextModelSelection = normalizeDraftModelSelection(
      withModelSelectionModel(
      preferredModelSelection,
      (nextModelValue
        ? resolveSelectableModel(
            nextProvider,
            nextModelValue,
            getProviderModelOptions(config, nextProvider, nextInstanceId),
          ) ?? resolveModelSlugForProvider(nextProvider, nextModelValue)
        : null) ?? preferredModelSelection.model,
      ),
    )
    upsertComposerDraft(draftTargetKey, {
      modelSelection: nextModelSelection,
    })

    const isDifferentProvider = Boolean(thread && thread.modelSelection.provider !== nextProvider)
    updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
      provider: nextModelSelection.provider,
      providerInstanceId: nextModelSelection.instanceId,
      model: nextModelSelection.model,
      ...(isDifferentProvider ? { threadId: null } : {}),
    }, input.workspaceId)
    flushWorkbenchStorage()

    if (!thread || isDifferentProvider) {
      return
    }

    await runMetaSync(async () => {
      ensureNativeApi()
      await getOrchestration().dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: thread.id,
        modelSelection: nextModelSelection,
      })
    })
  }

  const handleModelChange = async (nextModel: string) => {
    const nextModelSelection = normalizeDraftModelSelection(
      withModelSelectionModel(
        selectedModelSelection,
        resolveSelectableModel(selectedProvider, nextModel, providerModelOptions) ??
          resolveModelSlugForProvider(selectedProvider, nextModel),
      ),
    )
    upsertComposerDraft(draftTargetKey, {
      modelSelection: nextModelSelection,
    })

    updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
      provider: nextModelSelection.provider,
      providerInstanceId: nextModelSelection.instanceId,
      model: nextModelSelection.model,
    }, input.workspaceId)

    if (!thread) {
      return
    }

    await runMetaSync(async () => {
      ensureNativeApi()
      await getOrchestration().dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: thread.id,
        modelSelection: nextModelSelection,
      })
    })
  }

  const handleModelOptionChange = async (optionId: string, value: string | boolean) => {
    const nextModelSelection = normalizeDraftModelSelection(
      normalizeModelSelection({
        provider: selectedProvider,
        instanceId: selectedProviderInstanceId,
        model: selectedModelSelection.model,
        options: setProviderOptionSelectionValue(selectedModelSelection.options, optionId, value),
      }),
    )
    upsertComposerDraft(draftTargetKey, {
      modelSelection: nextModelSelection,
    })

    if (!thread) {
      return
    }

    await runMetaSync(async () => {
      ensureNativeApi()
      await getOrchestration().dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: thread.id,
        modelSelection: nextModelSelection,
      })
    })
  }

  const handleRuntimeModeChange = async (nextValue: string) => {
    const nextRuntimeMode = nextValue as RuntimeMode
    upsertComposerDraft(draftTargetKey, {
      runtimeMode: nextRuntimeMode,
    })
    updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
      runtimeMode: nextRuntimeMode,
    }, input.workspaceId)

    if (!thread) {
      return
    }

    await runMetaSync(async () => {
      ensureNativeApi()
      await getOrchestration().dispatchCommand({
        type: "thread.runtime-mode.set",
        commandId: newCommandId(),
        threadId: thread.id,
        runtimeMode: nextRuntimeMode,
        createdAt: new Date().toISOString(),
      })
    })
  }

  const handleInteractionModeChange = async (nextValue: string) => {
    const nextInteractionMode = nextValue as ProviderInteractionMode
    upsertComposerDraft(draftTargetKey, {
      interactionMode: nextInteractionMode,
    })
    updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
      interactionMode: nextInteractionMode,
    }, input.workspaceId)

    if (!thread) {
      return
    }

    await runMetaSync(async () => {
      ensureNativeApi()
      await getOrchestration().dispatchCommand({
        type: "thread.interaction-mode.set",
        commandId: newCommandId(),
        threadId: thread.id,
        interactionMode: nextInteractionMode,
        createdAt: new Date().toISOString(),
      })
    })
  }

  // --- Fix 5: Pre-turn metadata synchronization ---
  // Flush any pending model/runtime/interaction mode changes to the server
  // immediately before dispatching thread.turn.start, eliminating race
  // conditions if the user changes model and instantly sends.
  const persistThreadSettingsForNextTurn = async (threadForSync: NonNullable<typeof thread>) => {
    ensureNativeApi()

    // Model selection drift
    if (
      selectedModelSelection.model !== threadForSync.modelSelection.model ||
      selectedModelSelection.provider !== threadForSync.modelSelection.provider ||
      JSON.stringify(selectedModelSelection.options ?? null) !==
        JSON.stringify(threadForSync.modelSelection.options ?? null)
    ) {
      await getOrchestration().dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: threadForSync.id,
        modelSelection: selectedDispatchModelSelection,
      })
    }

    // Runtime mode drift
    if (selectedRuntimeMode !== threadForSync.runtimeMode) {
      await getOrchestration().dispatchCommand({
        type: "thread.runtime-mode.set",
        commandId: newCommandId(),
        threadId: threadForSync.id,
        runtimeMode: selectedRuntimeMode,
        createdAt: new Date().toISOString(),
      })
    }

    // Interaction mode drift
    if (selectedInteractionMode !== threadForSync.interactionMode) {
      await getOrchestration().dispatchCommand({
        type: "thread.interaction-mode.set",
        commandId: newCommandId(),
        threadId: threadForSync.id,
        interactionMode: selectedInteractionMode,
        createdAt: new Date().toISOString(),
      })
    }
  }

  // --- Fix 1: Plan follow-up submission flow ---
  const handlePlanFollowUpSend = async () => {
    if (!thread || !activeProposedPlan) {
      return
    }
    const draftText = composer.trim()
    const followUp = resolvePlanFollowUpSubmission({
      draftText,
      planMarkdown: activeProposedPlan.planMarkdown,
    })

    const messageId = newMessageId()
    const messageCreatedAt = new Date().toISOString()
    const optimisticMessage: ChatMessage = {
      id: messageId,
      role: "user",
      text: followUp.text,
      createdAt: messageCreatedAt,
      streaming: false,
    }

    sendInFlightRef.current = true
    setIsSending(true)
    setSendError(null)
    setComposer("")
    setComposerCursor(0)
    setOptimisticUserMessages((current) => [...current, optimisticMessage])
    notePendingTurnStart(messageId, thread.id, messageCreatedAt)

    try {
      ensureNativeApi()

      // Sync settings before turn
      await persistThreadSettingsForNextTurn(thread)

      // Update interaction mode on the tile to match follow-up
      if (followUp.interactionMode !== selectedInteractionMode) {
        upsertComposerDraft(draftTargetKey, {
          interactionMode: followUp.interactionMode,
        })
        updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
          interactionMode: followUp.interactionMode,
        }, input.workspaceId)

        await getOrchestration().dispatchCommand({
          type: "thread.interaction-mode.set",
          commandId: newCommandId(),
          threadId: thread.id,
          interactionMode: followUp.interactionMode,
          createdAt: messageCreatedAt,
        })
      }

      await getOrchestration().dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: thread.id,
        message: {
          messageId,
          role: "user",
          text: followUp.text,
          attachments: [],
        },
        modelSelection: selectedDispatchModelSelection,
        titleSeed: thread.title,
        runtimeMode: selectedRuntimeMode,
        interactionMode: followUp.interactionMode,
        ...(followUp.interactionMode === "default" && activeProposedPlan
          ? {
              sourceProposedPlan: {
                threadId: thread.id,
                planId: activeProposedPlan.id,
              },
            }
          : {}),
        createdAt: messageCreatedAt,
      })
    } catch (error) {
      clearPendingTurnStart()
      setOptimisticUserMessages((current) =>
        current.filter((message) => message.id !== messageId),
      )
      setComposer(draftText)
      setComposerCursor(draftText.length)
      setSendError(toErrorMessage(error))
    } finally {
      sendInFlightRef.current = false
      setIsSending(false)
    }
  }

  const handleSend = async () => {
    if (sendInFlightRef.current) {
      return
    }

    if (!isChatReady) {
      setSendError(
        substrateTransport.loading
          ? "Substrate chat is still starting."
          : runtimeErrorMessage ?? "Local chat runtime is still starting.",
      )
      return
    }

    // --- Fix 6: Bootstrap pattern --- create thread on first send if needed
    // A T3 detail snapshot can hydrate the bound tile before the shell store
    // has materialized its Thread object. Reuse the merged bound thread so a
    // follow-up stays on the same subscription instead of creating a new one.
    let resolvedThread = thread ?? mergedThread
    if (!resolvedThread) {
      if (!input.workspaceId || !input.projectRootPath) {
        return
      }
      try {
        const threadTitle = input.tile.agentLabel?.trim() || input.tile.title.trim() || "AI Agent"
        const threadId = newThreadId()
        const threadDraft = getAssistantComposerDraft(input.tile.id)
        ensureNativeApi()

        // Resolve the project
        const currentAssistantState = useStore.getState()
        const workspaceRoot = input.projectRootPath
        let currentProject =
          (input.tile.assistantProjectId
            ? selectAssistantProjectById(currentAssistantState, input.tile.assistantProjectId)
            : null) ??
          selectAssistantProjectByCwd(currentAssistantState, workspaceRoot) ??
          null

        if (!currentProject) {
          await refreshAssistantRuntimeSnapshot().catch(() => {})
          const refreshedState = useStore.getState()
          currentProject =
            (input.tile.assistantProjectId
              ? selectAssistantProjectById(refreshedState, input.tile.assistantProjectId)
              : null) ??
            selectAssistantProjectByCwd(refreshedState, workspaceRoot) ??
            null
        }

        if (!currentProject) {
          const newId = newProjectId()
          try {
            await getOrchestration().dispatchCommand({
              type: "project.create",
              commandId: newCommandId(),
              projectId: newId,
              title: basenameFromPath(workspaceRoot),
              workspaceRoot,
              defaultModelSelection: null,
              createdAt: new Date().toISOString(),
            })
            currentProject = {
              id: newId,
              name: basenameFromPath(workspaceRoot),
              cwd: workspaceRoot,
              defaultModelSelection: null,
              expanded: true,
              scripts: [],
              createdAt: new Date().toISOString(),
              updatedAt: new Date().toISOString(),
            } satisfies Project as any
          } catch (createErr: unknown) {
            const errMsg = createErr instanceof Error ? `${createErr.message} ${createErr.stack ?? ""}` : JSON.stringify(createErr);
            const match = errMsg.match(/Active project (?:\\'|'|")([^'\\" ]+)(?:\\'|'|") already exists/);
            if (match && match[1]) {
              const existingId = match[1];
              currentProject = {
                id: existingId as any,
                name: basenameFromPath(workspaceRoot),
                cwd: workspaceRoot,
                defaultModelSelection: null,
                expanded: true,
                scripts: [],
                createdAt: new Date().toISOString(),
                updatedAt: new Date().toISOString(),
              } satisfies Project as any
            }
          }
        }

        if (!currentProject) {
          setSendError("Unable to initialize project. Please retry.")
          return
        }

        const resolvedModelSelection = selectedDispatchModelSelection
        const resolvedRuntimeMode = threadDraft?.runtimeMode ?? selectedRuntimeMode
        const resolvedInteractionMode = threadDraft?.interactionMode ?? selectedInteractionMode
        const createdAt = new Date().toISOString()

        await getOrchestration().dispatchCommand({
          type: "thread.create",
          commandId: newCommandId(),
          threadId,
          projectId: currentProject.id,
          title: threadTitle,
          modelSelection: resolvedModelSelection,
          runtimeMode: resolvedRuntimeMode,
          interactionMode: resolvedInteractionMode,
          branch: null,
          worktreePath: null,
          createdAt,
        })

        updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
          threadId,
          assistantProjectId: currentProject.id,
        }, input.workspaceId)

        // Build a minimal thread-like object from the data we just sent.
        // We can't read from the store yet because the domain event hasn't
        // been projected — the store update is async via WebSocket push.
        resolvedThread = {
          id: threadId,
          projectId: currentProject.id,
          title: threadTitle,
          modelSelection: resolvedModelSelection,
          runtimeMode: resolvedRuntimeMode,
          interactionMode: resolvedInteractionMode,
          messages: [],
          activities: [],
          proposedPlans: [],
          turnDiffSummaries: [],
          checkpoints: [],
          session: null,
          latestTurn: null,
          branch: null,
          worktreePath: null,
          createdAt,
          updatedAt: createdAt,
          deletedAt: null,
        } as any
      } catch (error) {
        setSendError(toErrorMessage(error))
        return
      }
    }

    // At this point, resolvedThread is guaranteed to be non-null.
    // Either it was the existing thread, or we just constructed it above.
    if (!resolvedThread) {
      return
    }

    // --- Fix 1: Intercept plan follow-up ---
    if (showPlanFollowUpPrompt && activeProposedPlan) {
      await handlePlanFollowUpSend()
      return
    }

    const nextPrompt = composer.trim()
    const hasImages = composerImages.length > 0
    if (!nextPrompt && !hasImages) {
      return
    }

    const isFirstUserMessage = !resolvedThread.messages.some((message) => message.role === "user")
    // --- Fix 4: Smart auto-titling ---
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
    const composerImagesSnapshot = [...composerImages]

    sendInFlightRef.current = true
    setIsSending(true)
    setSendError(null)
    setComposer("")
    setComposerCursor(0)
    setComposerImages([])
    setOptimisticUserMessages((current) => [...current, optimisticMessage])
    notePendingTurnStart(messageId, resolvedThread.id, messageCreatedAt)

    try {
      const useSubstrateRpcFallback =
        substrateTransport.active && !isRuntimeReady && !t3CutoverActive
      if (useSubstrateRpcFallback) {
        if (hasImages) {
          throw new Error("Substrate RPC chat fallback does not support image attachments yet.")
        }
        const turn = await sendSubstrateRpcTurn({
          threadId: resolvedThread.id,
          text: nextPrompt,
          shadowBaseUrl: substrateTransport.shadowBaseUrl ?? undefined,
          providerId: selectedDispatchModelSelection?.provider,
          modelSelection: selectedDispatchModelSelection,
        })
        if (turn.assistantText.trim().length > 0) {
          setOptimisticUserMessages((current) => [
            ...current,
            {
              id: newMessageId(),
              role: "assistant",
              text: turn.assistantText,
              createdAt: new Date().toISOString(),
              streaming: false,
            },
          ])
        }
        clearPendingTurnStart()
        return
      }

      ensureNativeApi()
      if (isFirstUserMessage && nextThreadTitle) {
        updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
          title: nextThreadTitle,
        }, input.workspaceId)

        await getOrchestration().dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: resolvedThread.id,
          title: nextThreadTitle,
        })
      }

      // --- Fix 5: Flush settings before turn start ---
      await persistThreadSettingsForNextTurn(resolvedThread)

      const SKILL_TOKEN_REGEX = /(^|\\s)\\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\\s|$)/g
      const extractedSkillNames = Array.from(nextPrompt.matchAll(SKILL_TOKEN_REGEX)).map((m) => m[2])
      const skills = providerSnapshot?.skills?.filter((s) => extractedSkillNames.includes(s.name)) ?? []
      const uploadAttachments = await Promise.all(
        composerImagesSnapshot.map(async (image) => {
          if (!image.file) {
            throw new Error(`Attachment '${image.name}' is no longer available.`)
          }
          return {
            type: "image" as const,
            name: image.name,
            mimeType: image.mimeType,
            sizeBytes: image.sizeBytes,
            dataUrl: await readFileAsDataUrl(image.file),
          }
        }),
      )

      await getOrchestration().dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: resolvedThread.id,
        message: {
          messageId,
          role: "user",
          text: nextPrompt,
          attachments: uploadAttachments,
        },
        modelSelection: selectedDispatchModelSelection,
        runtimeMode: selectedRuntimeMode,
        interactionMode: selectedInteractionMode,
        ...(isFirstUserMessage && nextThreadTitle ? { titleSeed: nextThreadTitle } : {}),
        skills,
        createdAt: messageCreatedAt,
      })
    } catch (error) {
      // --- Fix 3: Properly handle blob URLs on failed sends ---
      clearPendingTurnStart()
      setOptimisticUserMessages((current) => {
        const removed = current.filter((message) => message.id === messageId)
        for (const message of removed) {
          revokeUserMessagePreviewUrls(message)
        }
        return current.filter((message) => message.id !== messageId)
      })
      setComposer(nextPrompt)
      setComposerCursor(nextPrompt.length)
      // Deep-clone images with fresh blob URLs so the originals are safely revoked
      setComposerImages(composerImagesSnapshot.map(cloneComposerImageForRetry))
      setSendError(toErrorMessage(error))
    } finally {
      sendInFlightRef.current = false
      setIsSending(false)
    }
  }

  const handleApprovalDecision = async (
    requestId: string,
    decision: ProviderApprovalDecision,
  ) => {
    if (!thread) {
      return
    }

    await runMetaSync(
      async () => {
        ensureNativeApi()
        await getOrchestration().dispatchCommand({
          type: "thread.approval.respond",
          commandId: newCommandId(),
          threadId: thread.id,
          requestId: ApprovalRequestId.makeUnsafe(requestId),
          decision,
          createdAt: new Date().toISOString(),
        })
      },
      { requestKey: requestId },
    )
  }

  const handleUserInputDraftChange = (
    requestId: string,
    questionId: string,
    value: string,
    cursor?: number,
  ) => {
    setUserInputDrafts((current) => ({
      ...current,
      [requestId]: {
        ...current[requestId],
        [questionId]: value,
      },
    }))
    if (cursor !== undefined) {
      setComposerCursor(cursor)
    }
  }

  const handleSubmitUserInput = async (requestId: string) => {
    if (!thread) {
      return
    }

    const answers = userInputDrafts[requestId]
    if (!answers) {
      return
    }

    const normalizedAnswers = Object.fromEntries(
      Object.entries(answers)
        .map(([questionId, answer]) => [questionId, answer.trim()])
        .filter((entry) => entry[1].length > 0),
    )

    if (Object.keys(normalizedAnswers).length === 0) {
      return
    }

    await runMetaSync(
      async () => {
        ensureNativeApi()
        await getOrchestration().dispatchCommand({
          type: "thread.user-input.respond",
          commandId: newCommandId(),
          threadId: thread.id,
          requestId: ApprovalRequestId.makeUnsafe(requestId),
          answers: normalizedAnswers,
          createdAt: new Date().toISOString(),
        })
        setUserInputDrafts((current) => {
          const next = { ...current }
          delete next[requestId]
          return next
        })
      },
      { requestKey: requestId },
    )
  }

  const openDiffDialog = async (dialogInput: {
    title: string
    request: () => Promise<OrchestrationGetTurnDiffResult>
  }) => {
    setDiffDialog({
      title: dialogInput.title,
      diff: "",
      error: null,
      isLoading: true,
    })

    try {
      const result = await dialogInput.request()
      setDiffDialog({
        title: dialogInput.title,
        diff: result.diff,
        error: null,
        isLoading: false,
      })
    } catch (error) {
      setDiffDialog({
        title: dialogInput.title,
        diff: "",
        error: toErrorMessage(error),
        isLoading: false,
      })
    }
  }

  const handleComposerChange = (
    nextValue: string,
    nextCursor: number,
  ) => {
    setComposer(nextValue)
    setComposerCursor(nextCursor)
  }

  const handleComposerCommandKey = (
    key: "ArrowDown" | "ArrowUp" | "Enter" | "Tab",
    event: KeyboardEvent,
  ) => {
    if (key === "Enter" && !event.shiftKey) {
      void handleSend()
      return true
    }

    return false
  }

  const addComposerImages = useCallback((files: File[]) => {
    if (files.length === 0) return
    if (!thread) return
    if (pendingUserInputs.length > 0) {
      setSendError("Attach images after answering pending questions.")
      return
    }
    const currentImageCount = composerImages.length
    const nextImages: ComposerImageDraft[] = []
    let nextImageCount = currentImageCount
    let error: string | null = null

    for (const file of files) {
      if (!file.type.startsWith("image/")) {
        error = `Unsupported file type for '${file.name}'. Attach image files only.`
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
      nextImages.push({
        id: newMessageId(),
        name: file.name || "image",
        mimeType: file.type,
        sizeBytes: file.size,
        previewUrl: URL.createObjectURL(file),
        file,
      })
      nextImageCount += 1
    }

    if (nextImages.length > 0) {
      setComposerImages((current) => [...current, ...nextImages])
    }
    if (error) {
      setSendError(error)
    }
  }, [composerImages.length, pendingUserInputs.length, thread])

  const removeComposerImage = useCallback((imageId: string) => {
    setComposerImages((current) => {
      const next: ComposerImageDraft[] = []
      for (const image of current) {
        if (image.id === imageId) {
          revokeBlobPreviewUrl(image.previewUrl)
          continue
        }
        next.push(image)
      }
      return next
    })
  }, [])

  const handleComposerPaste: ClipboardEventHandler<HTMLElement> = (event) => {
    const files = Array.from(event.clipboardData.files)
    if (files.length === 0) return
    const imageFiles = files.filter((file) => file.type.startsWith("image/"))
    if (imageFiles.length === 0) return
    event.preventDefault()
    addComposerImages(imageFiles)
  }

  const toggleInteractionMode = async () => {
    const nextInteractionMode =
      selectedInteractionMode === "plan" ? "default" : "plan"
    await handleInteractionModeChange(nextInteractionMode)
  }

  const toggleRuntimeMode = async () => {
    const nextRuntimeMode =
      selectedRuntimeMode === "full-access" ? "approval-required" : "full-access"
    await handleRuntimeModeChange(nextRuntimeMode)
  }

  const handleOpenTurnDiff = async (turnId: TurnId, filePath?: string) => {
    if (!thread) {
      return
    }

    const summary = thread.turnDiffSummaries.find((entry) => entry.turnId === turnId)
    const checkpointTurnCount =
      summary?.checkpointTurnCount ?? turnCountByTurnId[turnId]

    if (checkpointTurnCount === undefined) {
      return
    }
    const threadId = thread.id
    const turnNumber = checkpointTurnCount + 1

    await openDiffDialog({
      title: filePath ? `${chatTitle} turn ${turnNumber} · ${filePath}` : `${chatTitle} turn ${turnNumber}`,
      request: async () => {
        ensureNativeApi()
        return getOrchestration().getTurnDiff({
          threadId,
          fromTurnCount: checkpointTurnCount,
          toTurnCount: checkpointTurnCount,
        })
      },
    })
  }

  const handleDismissThreadError = () => {
    if (!thread) {
      return
    }
    setThreadError(thread.id, null)
  }

  const handleDeleteThread = async (): Promise<boolean> => {
    if (!thread) {
      return false
    }

    const api = ensureNativeApi()
    const confirmed = await api.dialogs.confirm(
      `Delete thread "${thread.title}"? Provider sessions and terminals for this thread will be cleaned up.`,
    )
    if (!confirmed) {
      return false
    }

    const assistantState = useStore.getState()
    const threads = selectAssistantThreads(assistantState).map((entry) => ({
      id: entry.id,
      worktreePath: entry.worktreePath,
    }))
    const project =
      selectAssistantProjectById(assistantState, thread.projectId) ??
      selectAssistantProjectByCwd(assistantState, input.projectRootPath)

    setSendError(null)
    try {
      const result = await deleteAssistantThread({
        threadId: thread.id,
        threads,
        project: project ? { workspaceRoot: project.cwd } : null,
        deps: {
          confirm: (message) => api.dialogs.confirm(message),
          dispatchDelete: ({ threadId, commandId }) =>
            getOrchestration().dispatchCommand({
              type: "thread.delete",
              commandId,
              threadId,
            }),
          removeWorktree: (worktreeInput) => api.git.removeWorktree(worktreeInput),
          newCommandId,
          closeTerminals: (threadId) =>
            api.terminal.close({ threadId, deleteHistory: true }),
        },
      })

      if (result.status === "deleted_worktree_failed") {
        const detail =
          result.error instanceof Error ? result.error.message : "Unknown worktree removal error."
        setSendError(
          `Thread deleted, but worktree removal failed (${result.worktreePath}): ${detail}`,
        )
        return true
      }

      return result.status === "deleted"
    } catch (error) {
      setSendError(toErrorMessage(error))
      return false
    }
  }

  const handleRevertToTurnCount = async (turnCount: number) => {
    if (!thread) {
      return
    }

    const api = ensureNativeApi()
    const confirmed = await api.dialogs.confirm(
      `Revert this chat thread to the state before turn ${turnCount + 1}?`,
    )
    if (!confirmed) {
      return
    }

    setIsRevertingCheckpoint(true)
    setSendError(null)

    try {
      await getOrchestration().dispatchCommand({
        type: "thread.checkpoint.revert",
        commandId: newCommandId(),
        threadId: thread.id,
        turnCount,
        createdAt: new Date().toISOString(),
      })
    } catch (error) {
      setSendError(toErrorMessage(error))
    } finally {
      setIsRevertingCheckpoint(false)
    }
  }

  const composerStatus = (() => {
    if (bindingError) {
      return (
        <div className="flex min-w-0 items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-normal text-destructive">
          <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2 min-w-0 flex-1">{bindingError}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-destructive hover:bg-destructive/10 hover:text-destructive"
            onClick={() => setBindingRevision((current) => current + 1)}
          >
            Retry
          </Button>
        </div>
      )
    }

    if (sendError || requestError) {
      return (
        <div className="flex min-w-0 items-center gap-2 border-b border-destructive/30 bg-destructive/5 px-4 py-3 text-xs leading-normal text-destructive">
          <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2 min-w-0 flex-1">{sendError ?? requestError}</span>
          <ProviderRemediationAction
            provider={selectedProvider}
            message={sendError ?? requestError}
            onResolved={() => setSendError(null)}
          />
        </div>
      )
    }

    if (configError && !config) {
      return (
        <div className="flex min-w-0 items-center gap-2 border-b border-border/60 bg-secondary/50 px-4 py-3 text-xs leading-normal text-muted-foreground">
          <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2 min-w-0 flex-1">{configError}</span>
        </div>
      )
    }

    return null
  })()

  return {
    chatTitle,
    showTitleSpinner,
    diffDialog,
    closeDiffDialog: () => {
      setDiffDialog(null)
    },
    handleDeleteThread,
    artifacts,
    artifactMedia,
    surfaceProps: {
      dockComposerOnHover: true,
      isRuntimeReady,
      isChatReady,
      runtimeErrorMessage,
      workspaceId: input.workspaceId,
      workspaceRoot: resolvedWorkspaceRoot,
      thread: visibleThread,
      providerSnapshot,
      isRunning,
      isBinding: visibleBindingState,
      isConfigLoading,
      bindingError,
      timelineRef,
      pendingApprovals,
      pendingUserInputs,
      activeRequestKey,
      userInputDrafts,
      activeContextWindow,
      composerStatus,
      composer,
      composerCursor,
      composerImages,
      terminalContexts: [],
      onRemoveTerminalContext: () => {},
      isSending: isSending || isTurnStartPending,
      pendingTurnStartStartedAtIso,
      isInterrupting,
      isForceStopAvailable,
      isRevertingCheckpoint,
      selectedProvider,
      selectedModelSelection,
      selectedRuntimeMode,
      selectedInteractionMode,
      providers: config?.providers ?? [],
      modelOptionsByProvider,
      modelOptionDescriptors: selectedModelOptionDescriptors,
      onProviderModelChange: (provider, model, instanceId) => {
        if (provider !== selectedProvider || (instanceId && instanceId !== selectedProviderInstanceId)) {
          void handleProviderChange(provider, model, instanceId)
          return
        }
        void handleModelChange(model)
      },
      onModelOptionChange: (id, value) => {
        void handleModelOptionChange(id, value)
      },
      onToggleInteractionMode: () => {
        void toggleInteractionMode()
      },
      onToggleRuntimeMode: () => {
        void toggleRuntimeMode()
      },
      onComposerChange: handleComposerChange,
      onComposerCommandKey: handleComposerCommandKey,
      onComposerPaste: handleComposerPaste,
      onAttachFiles: addComposerImages,
      onRemoveComposerImage: removeComposerImage,
      onSend: () => {
        void handleSend()
      },
      onInterrupt: () => {
        void handleInterrupt()
      },
      onApprovalDecision: handleApprovalDecision,
      onUserInputDraftChange: handleUserInputDraftChange,
      onSubmitUserInput: handleSubmitUserInput,
      onOpenTurnDiff: handleOpenTurnDiff,
      onDismissThreadError: handleDismissThreadError,
      onRevertToTurnCount: handleRevertToTurnCount,
    },
  }
}
