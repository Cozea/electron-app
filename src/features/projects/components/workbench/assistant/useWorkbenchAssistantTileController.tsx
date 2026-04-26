import { useEffect, useMemo, useRef, useState, type ClipboardEventHandler, type ComponentProps } from "react"

import {

  type OrchestrationGetTurnDiffResult,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type TurnId,
} from "@cozea/assistant-contracts"
import {
  resolveModelSlugForProvider,
  resolveSelectableModel,
} from "@cozea/assistant-shared/model"

import {
  derivePendingApprovals,
  derivePendingUserInputs,
} from "@/features/projects/components/assistant/chat/pendingRequests"
import { inferCheckpointTurnCountByTurnId } from "@/features/projects/components/assistant/chat/turnDiffDerivations"
import {
  CozeaChatSurface,
  type ProviderModelOptionsByProvider,
} from "@/features/projects/components/assistant/chat/CozeaChatSurface"
import { deriveLatestContextWindowSnapshot } from "@/features/projects/components/assistant/lib/contextWindow"
import {
  newCommandId,
} from "@/features/projects/components/assistant/lib/utils"
import {
  refreshAssistantRuntimeSnapshot,
  useAssistantRuntimeSync,
} from "@/features/projects/components/workbench/useAssistantRuntimeSync"
import { useAssistantRuntimeStatus } from "@/features/projects/components/workbench/useAssistantRuntimeStatus"
import { ensureNativeApi } from "@/lib/nativeApi"
import {
  createAssistantProjectSelectorForTile,
  createAssistantThreadSelectorById,
  useStore,
} from "@/stores/assistant-store"
import {
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

import { useAssistantServerConfig } from "./useAssistantServerConfig"
import { useAssistantApprovals } from "./useAssistantApprovals"
import { useAssistantRequestSync } from "./useAssistantRequestSync"
import { useAssistantTileBinding } from "./useAssistantTileBinding"
import { useAssistantTurnSend } from "./useAssistantTurnSend"
import { useAssistantTurnLifecycle } from "./useAssistantTurnLifecycle"
import { useOptimisticThreadMessages } from "./useOptimisticThreadMessages"
import {
  type DiffDialogState,
  getProviderModelOptions,
  getProviderSnapshot,
  resolveInteractionMode,
  resolvePreferredModelSelection,
  resolveRuntimeMode,
  toErrorMessage,
  withModelSelectionModel,
} from "./workbenchAssistantShared"
import { WorkbenchAssistantComposerStatus } from "./WorkbenchAssistantComposerStatus"

interface UseWorkbenchAssistantTileControllerInput {
  projectId: string
  laneId: string
  projectPath: string | null
  tile: WorkbenchAssistantChatTileRecord
}

interface WorkbenchAssistantTileControllerResult {
  chatTitle: string
  showTitleSpinner: boolean
  diffDialog: DiffDialogState | null
  closeDiffDialog: () => void
  surfaceProps: ComponentProps<typeof CozeaChatSurface>
}

export function useWorkbenchAssistantTileController(
  input: UseWorkbenchAssistantTileControllerInput,
): WorkbenchAssistantTileControllerResult {
  const assistantRuntime = useAssistantRuntimeStatus()
  const isRuntimeReady = assistantRuntime.phase === "ready"
  const runtimeErrorMessage =
    assistantRuntime.phase === "error"
      ? assistantRuntime.lastError?.trim() || "Local chat runtime is unavailable."
      : null

  useAssistantRuntimeSync(isRuntimeReady)

  const {
    config,
    error: configError,
    isLoading: isConfigLoading,
  } = useAssistantServerConfig(isRuntimeReady)
  const [composer, setComposer] = useState("")
  const [composerCursor, setComposerCursor] = useState(0)
  const [sendError, setSendError] = useState<string | null>(null)
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false)
  const {
    activeRequestKey,
    requestError,
    runRequestSync: runMetaSync,
  } = useAssistantRequestSync()
  const [diffDialog, setDiffDialog] = useState<DiffDialogState | null>(null)
  const updateAssistantTile = useProjectWorkbenchStore((state) => state.actions.updateAssistantTile)
  const setThreadError = useStore((state) => state.setError)
  const timelineRef = useRef<HTMLDivElement | null>(null)

  const assistantProjectSelector = useMemo(
    () =>
      createAssistantProjectSelectorForTile({
        assistantProjectId: input.tile.assistantProjectId,
        projectPath: input.projectPath,
      }),
    [input.projectPath, input.tile.assistantProjectId],
  )
  const threadSelector = useMemo(
    () => createAssistantThreadSelectorById(input.tile.threadId),
    [input.tile.threadId],
  )
  const assistantProject = useStore(assistantProjectSelector)
  const thread = useStore(threadSelector)
  const {
    visibleThread,
    addOptimisticUserMessage,
    removeOptimisticUserMessage,
  } = useOptimisticThreadMessages(thread)
  const {
    userInputDrafts,
    handleApprovalDecision,
    handleUserInputDraftChange,
    handleSubmitUserInput,
  } = useAssistantApprovals({
    thread,
    runMetaSync,
  })

  const selectedModelSelection = useMemo(() => {
    return (
      thread?.modelSelection ??
      resolvePreferredModelSelection({
        config,
        tile: input.tile,
        projectModelSelection: assistantProject?.defaultModelSelection,
      })
    )
  }, [assistantProject?.defaultModelSelection, config, input.tile, thread?.modelSelection])
  const selectedDispatchModelSelection = useMemo(
    () => withModelSelectionModel(selectedModelSelection, selectedModelSelection.model),
    [selectedModelSelection],
  )

  const selectedRuntimeMode = thread?.runtimeMode ?? resolveRuntimeMode(input.tile)
  const selectedInteractionMode =
    thread?.interactionMode ?? resolveInteractionMode(input.tile)
  const selectedProvider = selectedModelSelection.provider
  const providerSnapshot = getProviderSnapshot(config, selectedProvider)
  const modelOptionsByProvider = useMemo<ProviderModelOptionsByProvider>(
    () => ({
      codex: getProviderModelOptions(config, "codex"),
      claudeAgent: getProviderModelOptions(config, "claudeAgent"),
      cursor: getProviderModelOptions(config, "cursor"),
      opencode: getProviderModelOptions(config, "opencode"),
    }),
    [config],
  )
  const providerModelOptions = useMemo(() => {
    const options = getProviderModelOptions(config, selectedProvider)
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
  }, [config, selectedModelSelection.model, selectedProvider])
  const latestTurnId = thread?.latestTurn?.turnId
  const pendingApprovals = useMemo(
    () => derivePendingApprovals(thread?.activities ?? []),
    [thread?.activities],
  )
  const pendingUserInputs = useMemo(
    () => derivePendingUserInputs(thread?.activities ?? []),
    [thread?.activities],
  )
  const activeContextWindow = useMemo(
    () => deriveLatestContextWindowSnapshot(thread?.activities ?? []),
    [thread?.activities],
  )
  const turnCountByTurnId = useMemo(
    () => inferCheckpointTurnCountByTurnId(thread?.turnDiffSummaries ?? []),
    [thread?.turnDiffSummaries],
  )
  const isRunning =
    thread?.session?.orchestrationStatus === "running" ||
    thread?.session?.orchestrationStatus === "starting"
  const hasBoundThread = Boolean(input.tile.threadId && thread)
  const {
    bindingError,
    isBinding,
    setBindingRevision,
  } = useAssistantTileBinding({
    projectId: input.projectId,
    laneId: input.laneId,
    projectPath: input.projectPath,
    tile: input.tile,
    config,
    isRuntimeReady,
    hasBoundThread,
    updateAssistantTile,
  })
  const visibleBindingState = isRuntimeReady && !hasBoundThread && isBinding
  const {
    isInterrupting,
    isForceStopAvailable,
    isTurnStartPending,
    isTurnBusy,
    clearPendingTurnStart,
    notePendingTurnStart,
    handleInterrupt,
  } = useAssistantTurnLifecycle({
    thread,
    isRuntimeReady,
    runtimeErrorMessage,
    isRunning,
    onError: setSendError,
  })
  const { isSending, handleSend } = useAssistantTurnSend({
    thread,
    composer,
    isRuntimeReady,
    runtimeErrorMessage,
    isTurnBusy,
    isBinding: visibleBindingState,
    isRevertingCheckpoint,
    providerSkills: providerSnapshot?.skills,
    selectedDispatchModelSelection,
    selectedRuntimeMode,
    selectedInteractionMode,
    updateAssistantTile,
    projectId: input.projectId,
    laneId: input.laneId,
    tileId: input.tile.id,
    projectPath: input.projectPath,
    onComposerReset: () => {
      setComposer("")
      setComposerCursor(0)
    },
    onComposerRestore: (value) => {
      setComposer(value)
      setComposerCursor(value.length)
    },
    onError: setSendError,
    addOptimisticUserMessage,
    removeOptimisticUserMessage,
    clearPendingTurnStart,
    notePendingTurnStart,
  })
  const chatTitle =
    thread?.title?.trim() ||
    input.tile.agentLabel?.trim() ||
    input.tile.title.trim() ||
    "AI Agent"
  const showTitleSpinner =
    isRunning ||
    assistantRuntime.phase === "starting" ||
    (visibleBindingState && !bindingError)

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

    updateAssistantTile(input.projectId, input.laneId, input.tile.id, patch, input.projectPath)
  }, [input.laneId, input.projectId, input.projectPath, input.tile, thread, updateAssistantTile])

  useEffect(() => {
    const timeline = timelineRef.current
    if (!timeline) {
      return
    }
    timeline.scrollTop = timeline.scrollHeight
  }, [
    latestTurnId,
    thread?.messages.length,
    pendingApprovals.length,
    pendingUserInputs.length,
  ])

  const handleProviderChange = async (
    nextProviderValue: string,
    nextModelValue?: string,
  ) => {
    const nextProvider = nextProviderValue as ProviderKind
    const preferredModelSelection = resolvePreferredModelSelection({
      config,
      tile: {
        ...input.tile,
        provider: nextProvider,
        model: nextModelValue ?? null,
      },
      projectModelSelection: assistantProject?.defaultModelSelection,
      provider: nextProvider,
    })
    const nextModelSelection = withModelSelectionModel(
      preferredModelSelection,
      (nextModelValue
        ? resolveSelectableModel(
            nextProvider,
            nextModelValue,
            getProviderModelOptions(config, nextProvider),
          ) ?? resolveModelSlugForProvider(nextProvider, nextModelValue)
        : null) ?? preferredModelSelection.model,
    )

    updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
      provider: nextModelSelection.provider,
      model: nextModelSelection.model,
    }, input.projectPath)

    if (!thread) {
      return
    }

    await runMetaSync(async () => {
      const api = ensureNativeApi()
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: thread.id,
        modelSelection: nextModelSelection,
      })
    })
  }

  const handleModelChange = async (nextModel: string) => {
    const nextModelSelection = withModelSelectionModel(
      selectedModelSelection,
      resolveSelectableModel(selectedProvider, nextModel, providerModelOptions) ??
        resolveModelSlugForProvider(selectedProvider, nextModel),
    )

    updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
      provider: nextModelSelection.provider,
      model: nextModelSelection.model,
    }, input.projectPath)

    if (!thread) {
      return
    }

    await runMetaSync(async () => {
      const api = ensureNativeApi()
      await api.orchestration.dispatchCommand({
        type: "thread.meta.update",
        commandId: newCommandId(),
        threadId: thread.id,
        modelSelection: nextModelSelection,
      })
    })
  }

  const handleRuntimeModeChange = async (nextValue: string) => {
    const nextRuntimeMode = nextValue as RuntimeMode
    updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
      runtimeMode: nextRuntimeMode,
    }, input.projectPath)

    if (!thread) {
      return
    }

    await runMetaSync(async () => {
      const api = ensureNativeApi()
      await api.orchestration.dispatchCommand({
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
    updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
      interactionMode: nextInteractionMode,
    }, input.projectPath)

    if (!thread) {
      return
    }

    await runMetaSync(async () => {
      const api = ensureNativeApi()
      await api.orchestration.dispatchCommand({
        type: "thread.interaction-mode.set",
        commandId: newCommandId(),
        threadId: thread.id,
        interactionMode: nextInteractionMode,
        createdAt: new Date().toISOString(),
      })
    })
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

  const handleComposerPaste: ClipboardEventHandler<HTMLElement> = () => {}

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
        const api = ensureNativeApi()
        return api.orchestration.getTurnDiff({
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
      await api.orchestration.dispatchCommand({
        type: "thread.checkpoint.revert",
        commandId: newCommandId(),
        threadId: thread.id,
        turnCount,
        createdAt: new Date().toISOString(),
      })
      await refreshAssistantRuntimeSnapshot()
    } catch (error) {
      setSendError(toErrorMessage(error))
    } finally {
      setIsRevertingCheckpoint(false)
    }
  }

  const composerStatus = (
    <WorkbenchAssistantComposerStatus
      runtimeErrorMessage={runtimeErrorMessage}
      bindingError={bindingError}
      sendError={sendError}
      requestError={requestError}
      threadError={thread?.error}
      configError={configError}
      hasConfig={Boolean(config)}
      onRetryBinding={() => setBindingRevision((current) => current + 1)}
      onDismissThreadError={handleDismissThreadError}
    />
  )

  return {
    chatTitle,
    showTitleSpinner,
    diffDialog,
    closeDiffDialog: () => {
      setDiffDialog(null)
    },
    surfaceProps: {
      dockComposerOnHover: true,
      isRuntimeReady,
      runtimeErrorMessage,
      projectPath: input.projectPath,
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
      isSending: isSending || isTurnStartPending,
      isInterrupting,
      isForceStopAvailable,
      isRevertingCheckpoint,
      selectedProvider,
      selectedModelSelection,
      selectedRuntimeMode,
      selectedInteractionMode,
      providers: config?.providers ?? [],
      modelOptionsByProvider,
      onProviderModelChange: (provider, model) => {
        if (provider !== selectedProvider) {
          void handleProviderChange(provider, model)
          return
        }
        void handleModelChange(model)
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
