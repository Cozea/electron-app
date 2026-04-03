import { useEffect, useMemo, useRef, useState, type ClipboardEventHandler } from "react"
import type {
  DockviewApi,
  DockviewPanelApi,
} from "dockview"
import {
  AlertCircle,
  Loader2,
} from "lucide-react"

import {
  ApprovalRequestId,
  DEFAULT_MODEL_BY_PROVIDER,
  DEFAULT_PROVIDER_INTERACTION_MODE,
  DEFAULT_RUNTIME_MODE,
  type ModelSelection,
  type OrchestrationGetTurnDiffResult,
  type ProviderApprovalDecision,
  type ProviderInteractionMode,
  type ProviderKind,
  type RuntimeMode,
  type ServerConfig,
  type ServerProvider,
  type TurnId,
} from "@cozea/assistant-contracts"
import {
  resolveModelSlugForProvider,
  resolveSelectableModel,
} from "@cozea/assistant-shared/model"
import { Button } from "@/components/ui/button"
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog"
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
import { ensureNativeApi } from "@/lib/nativeApi"
import {
  onServerConfigUpdated,
  onServerProvidersUpdated,
} from "@/lib/wsNativeApi"
import { useStore } from "@/stores/assistant-store"
import {
  buildWorkbenchScopeKey,
  type WorkbenchAssistantChatTile as WorkbenchAssistantChatTileRecord,
  useProjectWorkbenchStore,
} from "@/stores/useProjectWorkbenchStore"
import { WorkbenchTileChrome } from "@/features/projects/components/workbench/WorkbenchTileChrome"
import {
  refreshAssistantRuntimeSnapshot,
  useAssistantRuntimeSync,
} from "@/features/projects/components/workbench/useAssistantRuntimeSync"
import { useAssistantRuntimeStatus } from "@/features/projects/components/workbench/useAssistantRuntimeStatus"

interface WorkbenchAssistantChatTileProps {
  projectId: string
  laneId: string
  projectPath: string | null
  tile: WorkbenchAssistantChatTileRecord
  panelApi: DockviewPanelApi
  containerApi: DockviewApi
  onDuplicate: (tileId: string) => void
}

interface DiffDialogState {
  title: string
  diff: string
  error: string | null
  isLoading: boolean
}

const workspaceBindingQueue = new Map<string, Promise<void>>()

function basenameFromPath(value: string | null): string {
  if (!value) {
    return "Workspace"
  }

  const segments = value.split(/[\\/]/).filter(Boolean)
  return segments.at(-1) ?? value
}

function toErrorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }

  if (typeof error === "string" && error.trim()) {
    return error
  }

  return "Something went wrong while talking to the local assistant runtime."
}

function truncateTitle(text: string, maxLength = 50): string {
  const trimmed = text.trim()
  if (trimmed.length <= maxLength) {
    return trimmed
  }
  return `${trimmed.slice(0, maxLength)}...`
}

function getProviderSnapshot(
  config: ServerConfig | null,
  provider: ProviderKind,
): ServerProvider | null {
  return config?.providers.find((entry) => entry.provider === provider) ?? null
}

function getProviderModelOptions(
  config: ServerConfig | null,
  provider: ProviderKind,
): ReadonlyArray<{ slug: string; name: string }> {
  return (
    getProviderSnapshot(config, provider)?.models.map((model) => ({
      slug: model.slug,
      name: model.name,
    })) ?? []
  )
}

async function withWorkspaceBindingLock<T>(
  workspaceRoot: string,
  task: () => Promise<T>,
): Promise<T> {
  const previous = workspaceBindingQueue.get(workspaceRoot) ?? Promise.resolve()
  let release: () => void = () => {}
  const gate = new Promise<void>((resolve) => {
    release = resolve
  })
  const current = previous.finally(() => gate)

  workspaceBindingQueue.set(workspaceRoot, current)
  await previous

  try {
    return await task()
  } finally {
    release()
    if (workspaceBindingQueue.get(workspaceRoot) === current) {
      workspaceBindingQueue.delete(workspaceRoot)
    }
  }
}

function getLiveAssistantTile(
  projectId: string,
  laneId: string,
  tileId: string,
): WorkbenchAssistantChatTileRecord | null {
  const workbench =
    useProjectWorkbenchStore.getState().workbenches[buildWorkbenchScopeKey(projectId, laneId)]
  const tile = workbench?.tiles[tileId]
  return tile?.type === "assistantChat" ? tile : null
}

function resolvePreferredProvider(input: {
  config: ServerConfig | null
  tile: WorkbenchAssistantChatTileRecord
  projectModelSelection: ModelSelection | null | undefined
}): ProviderKind {
  if (input.tile.provider) {
    return input.tile.provider
  }

  if (input.projectModelSelection?.provider) {
    return input.projectModelSelection.provider
  }

  if (input.config?.settings.textGenerationModelSelection.provider) {
    return input.config.settings.textGenerationModelSelection.provider
  }

  return "codex"
}

function resolvePreferredModelSelection(input: {
  config: ServerConfig | null
  tile: WorkbenchAssistantChatTileRecord
  projectModelSelection: ModelSelection | null | undefined
  provider?: ProviderKind
}): ModelSelection {
  const provider =
    input.provider ??
    resolvePreferredProvider({
      config: input.config,
      tile: input.tile,
      projectModelSelection: input.projectModelSelection,
    })
  const providerModelOptions = getProviderModelOptions(input.config, provider)
  const candidateModel =
    (input.tile.provider === provider ? input.tile.model : null) ??
    (input.projectModelSelection?.provider === provider
      ? input.projectModelSelection.model
      : null) ??
    (input.config?.settings.textGenerationModelSelection.provider === provider
      ? input.config.settings.textGenerationModelSelection.model
      : null)
  const resolvedModel =
    resolveSelectableModel(provider, candidateModel, providerModelOptions) ??
    providerModelOptions[0]?.slug ??
    resolveModelSlugForProvider(provider, candidateModel) ??
    DEFAULT_MODEL_BY_PROVIDER[provider]

  return {
    provider,
    model: resolvedModel,
  }
}

function resolveRuntimeMode(tile: WorkbenchAssistantChatTileRecord): RuntimeMode {
  return tile.runtimeMode ?? DEFAULT_RUNTIME_MODE
}

function resolveInteractionMode(tile: WorkbenchAssistantChatTileRecord): ProviderInteractionMode {
  return tile.interactionMode ?? DEFAULT_PROVIDER_INTERACTION_MODE
}

function useAssistantServerConfig(enabled: boolean) {
  const [config, setConfig] = useState<ServerConfig | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [isLoading, setIsLoading] = useState(enabled)
  const hasLoadedConfigRef = useRef(false)

  useEffect(() => {
    if (!enabled) {
      setIsLoading(false)
      setError(null)
      return
    }

    let cancelled = false

    const load = async (options?: { showLoading?: boolean }) => {
      if (options?.showLoading ?? true) {
        setIsLoading(true)
      }
      try {
        const api = ensureNativeApi()
        const nextConfig = await api.server.getConfig()
        if (cancelled) return
        hasLoadedConfigRef.current = true
        setConfig(nextConfig)
        setError(null)
      } catch (nextError) {
        if (cancelled) return
        const message = toErrorMessage(nextError)
        setError(message)
      } finally {
        if (!cancelled) {
          setIsLoading(false)
        }
      }
    }

    void load({ showLoading: !hasLoadedConfigRef.current })
    const unsubscribeConfig = onServerConfigUpdated((payload) => {
      if (cancelled) return
      let shouldReload = false
      setConfig((current) => {
        if (!current) {
          shouldReload = true
          return current
        }
        return {
          ...current,
          issues: payload.issues,
          settings: payload.settings ?? current.settings,
        }
      })
      if (shouldReload) {
        void load({ showLoading: false })
      }
      setError(null)
    })
    const unsubscribeProviders = onServerProvidersUpdated((payload) => {
      if (cancelled) return
      let shouldReload = false
      setConfig((current) => {
        if (!current) {
          shouldReload = true
          return current
        }
        return {
          ...current,
          providers: payload.providers,
        }
      })
      if (shouldReload) {
        void load({ showLoading: false })
      }
      setError(null)
    })

    return () => {
      cancelled = true
      unsubscribeConfig()
      unsubscribeProviders()
    }
  }, [enabled])

  return { config, error, isLoading }
}

export function WorkbenchAssistantChatTile(props: WorkbenchAssistantChatTileProps) {
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
  const updateAssistantTile = useProjectWorkbenchStore((state) => state.actions.updateAssistantTile)
  const setThreadError = useStore((state) => state.setError)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const bindingInFlightRef = useRef(false)

  const assistantProject = useStore((state) => {
    if (props.tile.assistantProjectId) {
      return state.projects.find((project) => project.id === props.tile.assistantProjectId) ?? null
    }
    if (props.projectPath) {
      return state.projects.find((project) => project.cwd === props.projectPath) ?? null
    }
    return null
  })
  const thread = useStore((state) => {
    if (!props.tile.threadId) {
      return null
    }
    return state.threads.find((entry) => entry.id === props.tile.threadId) ?? null
  })

  const selectedModelSelection = useMemo(() => {
    return (
      thread?.modelSelection ??
      resolvePreferredModelSelection({
        config,
        tile: props.tile,
        projectModelSelection: assistantProject?.defaultModelSelection,
      })
    )
  }, [assistantProject?.defaultModelSelection, config, props.tile, thread?.modelSelection])

  const selectedRuntimeMode = thread?.runtimeMode ?? resolveRuntimeMode(props.tile)
  const selectedInteractionMode =
    thread?.interactionMode ?? resolveInteractionMode(props.tile)
  const selectedProvider = selectedModelSelection.provider
  const providerSnapshot = getProviderSnapshot(config, selectedProvider)
  const modelOptionsByProvider = useMemo<ProviderModelOptionsByProvider>(
    () => ({
      codex: getProviderModelOptions(config, "codex"),
      claudeAgent: getProviderModelOptions(config, "claudeAgent"),
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
  const hasBoundThread = Boolean(props.tile.threadId && thread)
  const visibleBindingState = isRuntimeReady && !hasBoundThread && isBinding
  const chatTitle =
    thread?.title?.trim() ||
    props.tile.agentLabel?.trim() ||
    props.tile.title.trim() ||
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

    if (props.tile.assistantProjectId !== thread.projectId) {
      patch.assistantProjectId = thread.projectId
    }
    if (props.tile.threadId !== thread.id) {
      patch.threadId = thread.id
    }
    if (props.tile.title !== thread.title) {
      patch.title = thread.title
    }
    if (props.tile.provider !== thread.modelSelection.provider) {
      patch.provider = thread.modelSelection.provider
    }
    if (props.tile.model !== thread.modelSelection.model) {
      patch.model = thread.modelSelection.model
    }
    if (props.tile.runtimeMode !== thread.runtimeMode) {
      patch.runtimeMode = thread.runtimeMode
    }
    if (props.tile.interactionMode !== thread.interactionMode) {
      patch.interactionMode = thread.interactionMode
    }

    if (Object.keys(patch).length === 0) {
      return
    }

    updateAssistantTile(props.projectId, props.laneId, props.tile.id, patch)
  }, [props.laneId, props.projectId, props.tile, thread, updateAssistantTile])

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
    if (!isRuntimeReady || !props.projectPath) {
      return
    }
    const workspaceRoot = props.projectPath
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
          const liveTile = () => getLiveAssistantTile(props.projectId, props.laneId, props.tile.id) ?? props.tile
          const liveConfig = config ?? (await api.server.getConfig().catch(() => null))

          await refreshAssistantRuntimeSnapshot()

          const currentTile = liveTile()
          let nextProject =
            (currentTile.assistantProjectId
              ? useStore
                  .getState()
                  .projects.find((entry) => entry.id === currentTile.assistantProjectId)
              : null) ??
            useStore
              .getState()
              .projects.find((entry) => entry.cwd === workspaceRoot) ??
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
            nextProject =
              useStore.getState().projects.find((entry) => entry.id === projectId) ??
              useStore.getState().projects.find((entry) => entry.cwd === workspaceRoot) ??
              null
          }

          if (!nextProject) {
            throw new Error("Unable to create an assistant project for this workspace.")
          }

          const resolvedTile = liveTile()
          let nextThread =
            (resolvedTile.threadId
              ? useStore.getState().threads.find((entry) => entry.id === resolvedTile.threadId)
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
              useStore.getState().threads.find((entry) => entry.id === threadId) ?? null
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
            updateAssistantTile(props.projectId, props.laneId, props.tile.id, patch)
          }

          if (!cancelled) {
            setBindingError(null)
          }
        })
      } catch (error) {
        if (!cancelled) {
          const message = toErrorMessage(error)
          setBindingError(message)
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
    props.laneId,
    isRuntimeReady,
    props.projectId,
    props.projectPath,
    props.tile.id,
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
        ...props.tile,
        provider: nextProvider,
        model: nextModelValue ?? null,
      },
      projectModelSelection: assistantProject?.defaultModelSelection,
      provider: nextProvider,
    })
    const nextModelSelection = {
      ...preferredModelSelection,
      model:
        (nextModelValue
          ? resolveSelectableModel(
              nextProvider,
              nextModelValue,
              getProviderModelOptions(config, nextProvider),
            ) ?? resolveModelSlugForProvider(nextProvider, nextModelValue)
          : null) ?? preferredModelSelection.model,
    } satisfies ModelSelection

    updateAssistantTile(props.projectId, props.laneId, props.tile.id, {
      provider: nextModelSelection.provider,
      model: nextModelSelection.model,
    })

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
    const nextModelSelection = {
      provider: selectedProvider,
      model:
        resolveSelectableModel(selectedProvider, nextModel, providerModelOptions) ??
        resolveModelSlugForProvider(selectedProvider, nextModel),
    } satisfies ModelSelection

    updateAssistantTile(props.projectId, props.laneId, props.tile.id, {
      provider: nextModelSelection.provider,
      model: nextModelSelection.model,
    })

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
    updateAssistantTile(props.projectId, props.laneId, props.tile.id, {
      runtimeMode: nextRuntimeMode,
    })

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
    updateAssistantTile(props.projectId, props.laneId, props.tile.id, {
      interactionMode: nextInteractionMode,
    })

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

    setIsSending(true)
    setSendError(null)
    setComposer("")
    setComposerCursor(0)

    try {
      const api = ensureNativeApi()
      if (isFirstUserMessage && nextThreadTitle) {
        updateAssistantTile(props.projectId, props.laneId, props.tile.id, {
          title: nextThreadTitle,
        })

        await api.orchestration.dispatchCommand({
          type: "thread.meta.update",
          commandId: newCommandId(),
          threadId: thread.id,
          title: nextThreadTitle,
        })
      }

      await api.orchestration.dispatchCommand({
        type: "thread.turn.start",
        commandId: newCommandId(),
        threadId: thread.id,
        message: {
          messageId: newMessageId(),
          role: "user",
          text: nextPrompt,
          attachments: [],
        },
        modelSelection: selectedModelSelection,
        runtimeMode: selectedRuntimeMode,
        interactionMode: selectedInteractionMode,
        createdAt: new Date().toISOString(),
      })
      await refreshAssistantRuntimeSnapshot()
    } catch (error) {
      setComposer(nextPrompt)
      setComposerCursor(nextPrompt.length)
      setSendError(toErrorMessage(error))
    } finally {
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

  const openDiffDialog = async (input: {
    title: string
    request: () => Promise<OrchestrationGetTurnDiffResult>
  }) => {
    setDiffDialog({
      title: input.title,
      diff: "",
      error: null,
      isLoading: true,
    })

    try {
      const result = await input.request()
      setDiffDialog({
        title: input.title,
        diff: result.diff,
        error: null,
        isLoading: false,
      })
    } catch (error) {
      setDiffDialog({
        title: input.title,
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

  const renderComposerStatus = () => {
    if (runtimeErrorMessage) {
      return (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {runtimeErrorMessage}
        </div>
      )
    }

    if (bindingError) {
      return (
        <div className="flex items-center gap-2 rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          <AlertCircle className="h-4 w-4" />
          <span className="min-w-0 flex-1">{bindingError}</span>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            className="h-7 px-2 text-destructive"
            onClick={() => setBindingRevision((current) => current + 1)}
          >
            Retry
          </Button>
        </div>
      )
    }

    if (sendError || requestError) {
      return (
        <div className="rounded-2xl border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          {sendError ?? requestError}
        </div>
      )
    }

    if (configError && !config) {
      return (
        <div className="rounded-2xl border border-border/70 bg-secondary/50 px-3 py-2 text-xs text-muted-foreground">
          {configError}
        </div>
      )
    }

    return null
  }

  return (
    <>
      <WorkbenchTileChrome
        title={chatTitle}
        panelApi={props.panelApi}
        containerApi={props.containerApi}
        controls={
          <div className="flex min-w-0 items-center gap-2">
            {showTitleSpinner ? (
              <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin text-muted-foreground" />
            ) : null}
            <span className="truncate text-xs text-foreground" title={chatTitle}>
              {chatTitle}
            </span>
          </div>
        }
      >
        <CozeaChatSurface
          isRuntimeReady={isRuntimeReady}
          runtimeErrorMessage={runtimeErrorMessage}
          projectPath={props.projectPath}
          thread={thread}
          providerSnapshot={providerSnapshot}
          isRunning={isRunning}
          isBinding={visibleBindingState}
          isConfigLoading={isConfigLoading}
          bindingError={bindingError}
          timelineRef={timelineRef}
          pendingApprovals={pendingApprovals}
          pendingUserInputs={pendingUserInputs}
          activeRequestKey={activeRequestKey}
          userInputDrafts={userInputDrafts}
          activeContextWindow={activeContextWindow}
          composerStatus={renderComposerStatus()}
          composer={composer}
          composerCursor={composerCursor}
          isSending={isSending}
          isInterrupting={isInterrupting}
          isRevertingCheckpoint={isRevertingCheckpoint}
          selectedProvider={selectedProvider}
          selectedModelSelection={selectedModelSelection}
          selectedRuntimeMode={selectedRuntimeMode}
          selectedInteractionMode={selectedInteractionMode}
          providers={config?.providers ?? []}
          modelOptionsByProvider={modelOptionsByProvider}
          onProviderModelChange={(provider, model) => {
            if (provider !== selectedProvider) {
              void handleProviderChange(provider, model)
              return
            }
            void handleModelChange(model)
          }}
          onToggleInteractionMode={() => {
            void toggleInteractionMode()
          }}
          onToggleRuntimeMode={() => {
            void toggleRuntimeMode()
          }}
          onComposerChange={handleComposerChange}
          onComposerCommandKey={handleComposerCommandKey}
          onComposerPaste={handleComposerPaste}
          onSend={() => {
            void handleSend()
          }}
          onInterrupt={() => {
            void handleInterrupt()
          }}
          onApprovalDecision={handleApprovalDecision}
          onUserInputDraftChange={handleUserInputDraftChange}
          onSubmitUserInput={handleSubmitUserInput}
          onOpenTurnDiff={handleOpenTurnDiff}
          onDismissThreadError={handleDismissThreadError}
          onRevertToTurnCount={handleRevertToTurnCount}
        />
      </WorkbenchTileChrome>

      <Dialog
        open={Boolean(diffDialog)}
        onOpenChange={(open) => {
          if (!open) {
            setDiffDialog(null)
          }
        }}
      >
        <DialogContent className="h-[min(84vh,56rem)] max-w-[min(72rem,calc(100%-2rem))] overflow-hidden p-0">
          <DialogHeader className="border-b border-border/70 px-6 py-4">
            <DialogTitle>{diffDialog?.title ?? "Diff"}</DialogTitle>
            <DialogDescription>
              Review the unified diff captured for this local assistant thread.
            </DialogDescription>
          </DialogHeader>

          <div className="min-h-0 flex-1 overflow-auto p-6">
            {diffDialog?.isLoading ? (
              <div className="flex h-full items-center justify-center gap-2 text-sm text-muted-foreground">
                <Loader2 className="h-4 w-4 animate-spin" />
                Loading diff…
              </div>
            ) : diffDialog?.error ? (
              <div className="rounded-3xl border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive">
                {diffDialog.error}
              </div>
            ) : (
              <pre className="overflow-x-auto rounded-3xl bg-secondary/70 p-4 text-xs leading-6 text-foreground">
                <code>{diffDialog?.diff || "No diff content was returned."}</code>
              </pre>
            )}
          </div>
        </DialogContent>
      </Dialog>
    </>
  )
}
