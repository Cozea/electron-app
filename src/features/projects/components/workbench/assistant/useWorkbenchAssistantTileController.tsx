import { useEffect, useMemo, useRef, useState, type ClipboardEventHandler, type ComponentProps } from "react"

import {

  ApprovalRequestId,
  type OrchestrationGetTurnDiffResult,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type TurnId,
} from "@cozea/assistant-contracts"
import {
  resolveModelSlugForProvider,
  resolveSelectableModel,
} from "@cozea/assistant-shared/model"

import { Button } from "@/components/ui/button"
import {
  derivePendingApprovals,
  derivePendingUserInputs,
  inferCheckpointTurnCountByTurnId,
} from "@/features/projects/components/assistant/chat/session-logic"
import {
  CozeaChatSurface,
  type ProviderModelOptionsByProvider,
  type UserInputAnswerDrafts,
} from "@/features/projects/components/assistant/chat/CozeaChatSurface"
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
import { ensureNativeApi } from "@/lib/nativeApi"
import {
  createAssistantProjectSelectorForTile,
  createAssistantThreadSelectorById,
  selectAssistantProjectByCwd,
  selectAssistantProjectById,
  selectAssistantThreadById,
  useStore,
} from "@/stores/assistant-store"
import type { ChatMessage } from "@/stores/types"
import {
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"

import { useAssistantServerConfig } from "./useAssistantServerConfig"
import {
  type DiffDialogState,
  basenameFromPath,
  getLiveAssistantTile,
  getProviderModelOptions,
  getProviderSnapshot,
  resolveInteractionMode,
  resolvePreferredModelSelection,
  resolveRuntimeMode,
  toErrorMessage,
  truncateTitle,
  withWorkspaceBindingLock,
  withModelSelectionModel,
} from "./workbenchAssistantShared"

import { HugeiconsIcon } from '@hugeicons/react'
import { AlertCircleIcon as __AlertCircleHugeIcon } from '@hugeicons/core-free-icons'

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
  const [bindingError, setBindingError] = useState<string | null>(null)
  const [isBinding, setIsBinding] = useState(false)
  const [bindingRevision, setBindingRevision] = useState(0)
  const [isSending, setIsSending] = useState(false)
  const [isInterrupting, setIsInterrupting] = useState(false)
  const [isRevertingCheckpoint, setIsRevertingCheckpoint] = useState(false)
  const [activeRequestKey, setActiveRequestKey] = useState<string | null>(null)
  const [requestError, setRequestError] = useState<string | null>(null)
  const [diffDialog, setDiffDialog] = useState<DiffDialogState | null>(null)
  const [userInputDrafts, setUserInputDrafts] = useState<UserInputAnswerDrafts>({})
  const [optimisticUserMessages, setOptimisticUserMessages] = useState<ChatMessage[]>([])
  const updateAssistantTile = useProjectWorkbenchStore((state) => state.actions.updateAssistantTile)
  const setThreadError = useStore((state) => state.setError)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const bindingInFlightRef = useRef(false)
  const sendInFlightRef = useRef(false)

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
  const visibleBindingState = isRuntimeReady && !hasBoundThread && isBinding
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

  useEffect(() => {
    if (!isRuntimeReady || !input.projectPath) {
      return
    }
    const workspaceRoot = input.projectPath
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
        await withWorkspaceBindingLock(workspaceRoot, async () => {
          const api = ensureNativeApi()
          const liveTile = () =>
            getLiveAssistantTile(input.projectId, input.laneId, input.tile.id, input.projectPath) ?? input.tile
          const liveConfig = config ?? (await api.server.getConfig().catch(() => null))

          await refreshAssistantRuntimeSnapshot()

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
            const defaultModelSelection = resolvePreferredModelSelection({
              config: liveConfig,
              tile: currentTile,
              projectModelSelection: null,
            })
            await api.orchestration.dispatchCommand({
              type: "project.create",
              commandId: newCommandId(),
              projectId,
              title: basenameFromPath(workspaceRoot),
              workspaceRoot,
              defaultModelSelection,
              createdAt: new Date().toISOString(),
            })
            await refreshAssistantRuntimeSnapshot()
            const nextAssistantState = useStore.getState()
            nextProject =
              selectAssistantProjectById(nextAssistantState, projectId) ??
              selectAssistantProjectByCwd(nextAssistantState, workspaceRoot) ??
              null
          }

          if (!nextProject) {
            throw new Error("Unable to create an assistant project for this workspace.")
          }

          const resolvedTile = liveTile()
          let nextThread =
            (resolvedTile.threadId
              ? selectAssistantThreadById(useStore.getState(), resolvedTile.threadId)
              : null) ?? null

          if (!nextThread || nextThread.projectId !== nextProject.id) {
            const threadId = newThreadId()
            const modelSelection = resolvePreferredModelSelection({
              config: liveConfig,
              tile: resolvedTile,
              projectModelSelection: nextProject.defaultModelSelection,
            })
            await api.orchestration.dispatchCommand({
              type: "thread.create",
              commandId: newCommandId(),
              threadId,
              projectId: nextProject.id,
              title: resolvedTile.agentLabel?.trim() || resolvedTile.title.trim() || "AI Agent",
              modelSelection,
              runtimeMode: resolveRuntimeMode(resolvedTile),
              interactionMode: resolveInteractionMode(resolvedTile),
              branch: null,
              worktreePath: null,
              createdAt: new Date().toISOString(),
            })
            await refreshAssistantRuntimeSnapshot()
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
            updateAssistantTile(input.projectId, input.laneId, input.tile.id, patch, input.projectPath)
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
    input.projectPath,
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
      await refreshAssistantRuntimeSnapshot()
    } catch (error) {
      setRequestError(toErrorMessage(error))
    } finally {
      if (options?.requestKey) {
        setActiveRequestKey(null)
      }
    }
  }

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

  const handleSend = async () => {
    if (sendInFlightRef.current) {
      return
    }

    if (!isRuntimeReady) {
      setSendError(runtimeErrorMessage ?? "Local chat runtime is still starting.")
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
    setSendError(null)
    setComposer("")
    setComposerCursor(0)
    setOptimisticUserMessages((current) => [...current, optimisticMessage])

    try {
      const api = ensureNativeApi()
      if (isFirstUserMessage && nextThreadTitle) {
        updateAssistantTile(input.projectId, input.laneId, input.tile.id, {
          title: nextThreadTitle,
        }, input.projectPath)

        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: thread.id,
          title: nextThreadTitle,
        })
      }

      const SKILL_TOKEN_REGEX = /(^|\\s)\\$([a-zA-Z][a-zA-Z0-9:_-]*)(?=\\s|$)/g
      const extractedSkillNames = Array.from(nextPrompt.matchAll(SKILL_TOKEN_REGEX)).map((m) => m[2])
      const skills = providerSnapshot?.skills?.filter((s) => extractedSkillNames.includes(s.name)) ?? []

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
      await refreshAssistantRuntimeSnapshot()
    } catch (error) {
      setOptimisticUserMessages((current) =>
        current.filter((message) => message.id !== messageId),
      )
      setComposer(nextPrompt)
      setComposerCursor(nextPrompt.length)
      setSendError(toErrorMessage(error))
    } finally {
      sendInFlightRef.current = false
      setIsSending(false)
    }
  }

  const handleInterrupt = async () => {
    if (!isRuntimeReady) {
      setSendError(runtimeErrorMessage ?? "Local chat runtime is unavailable.")
      return
    }

    if (!thread) {
      return
    }

    setIsInterrupting(true)
    setSendError(null)

    try {
      const api = ensureNativeApi()
      await api.orchestration.dispatchCommand({
        type: "thread.turn.interrupt",
        commandId: newCommandId(),
        threadId: thread.id,
        turnId: thread.session?.activeTurnId,
        createdAt: new Date().toISOString(),
      })
      await refreshAssistantRuntimeSnapshot()
    } catch (error) {
      setSendError(toErrorMessage(error))
    } finally {
      setIsInterrupting(false)
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
        const api = ensureNativeApi()
        await api.orchestration.dispatchCommand({
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
  ) => {
    setUserInputDrafts((current) => ({
      ...current,
      [requestId]: {
        ...current[requestId],
        [questionId]: value,
      },
    }))
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
        const api = ensureNativeApi()
        await api.orchestration.dispatchCommand({
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

  const composerStatus = (() => {
    if (runtimeErrorMessage) {
      return (
        <div className="line-clamp-2 min-w-0 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-normal text-destructive">
          {runtimeErrorMessage}
        </div>
      )
    }

    if (bindingError) {
      return (
        <div className="flex min-w-0 items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-normal text-destructive">
          <HugeiconsIcon icon={__AlertCircleHugeIcon} className="h-3.5 w-3.5 shrink-0" />
          <span className="line-clamp-2 min-w-0 flex-1">{bindingError}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 shrink-0 px-2 text-destructive"
            onClick={() => setBindingRevision((current) => current + 1)}
          >
            Retry
          </Button>
        </div>
      )
    }

    if (sendError || requestError) {
      return (
        <div className="line-clamp-2 min-w-0 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs leading-normal text-destructive">
          {sendError ?? requestError}
        </div>
      )
    }

    if (configError && !config) {
      return (
        <div className="line-clamp-2 min-w-0 rounded-2xl border border-border/60 bg-secondary/50 px-3 py-2 text-xs leading-normal text-muted-foreground">
          {configError}
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
      isSending,
      isInterrupting,
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
