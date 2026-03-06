import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useViewTransitionNavigate } from '@/lib/navigation'
import { useCozeaChat } from '@/hooks/useCozeaChat'
import {
  type UIMessage,
} from 'ai'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import {
  ModelSelector,
  ModelSelectorContent,
  ModelSelectorEmpty,
  ModelSelectorGroup,
  ModelSelectorInput,
  ModelSelectorItem,
  ModelSelectorList,
  ModelSelectorLogo,
  ModelSelectorLogoGroup,
  ModelSelectorName,
  ModelSelectorTrigger,
} from '@/components/ai/model-selector'
import { cn } from '@/lib/utils'
import {
  loadGlobalModelSettings,
  loadModelSettings,
  saveModelSettings,
  type StoredModelSettings,
  updateGlobalModelSettings,
  writeStoredModelSettings,
} from '@/lib/modelSettingsStorage'
import { AI_MODEL_SELECTOR_CONFIG } from '@/lib/ai/modelConfig'
import {
  VARIANT_DEFINITIONS,
  getSupportedVariantsForModel,
  normalizeVariantForModel,
  type RuntimeModelCapabilities,
  type RuntimeProvider,
} from '@/lib/ai/runtimeProfiles'
import {
  IconArrowUp,
  IconChevronDown,
  IconPlus,
  IconSquare,
  IconCheck,
  IconX,
} from '@tabler/icons-react'
import { Brain } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  getProviderDisplayName,
  isConnectedProvider,
  useConnectedProviders,
  type ConnectedProvider,
} from '@/hooks/useConnectedProviders'
import {
  buildAttachmentRejectionMessage,
  chatComposerAttachmentToFilePart,
  fileListToChatComposerAttachments,
  getChatAttachmentAccept,
  hasFilesInDataTransfer,
  resolveChatAttachmentSupport,
  type ChatComposerAttachment,
} from '@/lib/ai/chatAttachments'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { ScreenshotAttachments } from '@/components/assistant/ScreenshotAttachment'
import { getContextWindowSize } from '@/components/assistant/ContextDisplay'
import { ChatAttachmentCard } from '@/components/assistant/ChatAttachmentCard'
import type { Id } from '../../../convex/_generated/dataModel'

// AI Elements components (same as AIConversation)
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import {
  Message,
  MessageContent,
  MessageResponse,
} from '@/components/ai-elements/message'
import {
  Tool,
  ToolStatic,
  ToolHeader,
  ToolContent,
  ToolInput,
  ToolOutput,
} from '@/components/ai-elements/tool'
import {
  Reasoning,
  ReasoningTrigger,
  ReasoningContent,
} from '@/components/ai-elements/reasoning'
import { Sources, SourcesTrigger, SourcesContent, Source } from '@/components/ai-elements/sources'
import { Loader } from '@/components/ai-elements/loader'
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
} from '@/components/ai-elements/context'
import { TaskProgress, type TaskData } from '@/components/assistant/TaskProgress'
import { ToolDiffOutput, isFileEditTool } from '@/components/ai-elements/tool-diff-output'
import { PlanSelector, type PlanOption } from './PlanSelector'
import { BillingError } from '@/components/assistant/BillingError'
import { AiSurfaceErrorCard } from '@/components/assistant/AiSurfaceErrorCard'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'
import type { ModelOption } from '@/lib/ai/modelOptions'
import { AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import {
  getModelCatalog,
  type ModelApiModel,
  type ModelApiResponse,
} from '@/lib/ai/modelCatalogClient'
import { getRetryHintMessage } from '@/lib/ai/retryHints'
import { getRetryHintSurfaceError } from '@/lib/ai/surfaceErrors'
import {
  buildEncodedProviderAuthHeader,
  inferProviderFromModelId,
  isManagedProvider,
} from '@/lib/ai/providerAuth'
import { validateWebOnlyPlanConfig } from '@/lib/plan'
import type { ToolCallPayload, ToolMetaShape, ToolsApiResponse } from '@/lib/ai/toolTypes'
import { fetchWithAbort } from '@/lib/abort'

interface WizardConversationProps {
  projectId?: Id<"projects"> // Optional - project created when plan selected
  initialPrompt: string
  promptSettings: {
    model: string
    agentId: 'plan' | 'build' | 'assistant_general' | 'assistant_project' | 'explore' | 'review'
    surface: 'wizard' | 'builder' | 'assistant_panel' | 'assistant_project'
    variantId?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
  }
  onPlanSelected: (plan: PlanOption) => void
  className?: string
}

type ToolMeta = ToolMetaShape

type ToolResponse = ToolsApiResponse<ToolMeta>

interface ToolPart {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
  result?: unknown
  args?: unknown
  plans?: unknown
  errorText?: string
}

interface ReasoningPart {
  duration?: number
  text?: string
}

interface UsageData {
  model?: string
  provider?: string
  trackedUnits?: number
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
  cacheWriteTokens?: number
  spendCents?: number
  runtime?: 'local' | 'remote'
  durationMs?: number
  finishReason?: string
  rawFinishReason?: string
}

interface AgentLedgerData {
  kind?: 'run_started' | 'step' | 'budget_exceeded' | 'run_completed'
  runId?: string
  costUsd?: number
  billedUsd?: number
}

interface SourcePart {
  url?: string
  uri?: string
  title?: string
  favicon?: string
  source?: { url?: string; title?: string }
}

interface FilePart {
  type: 'file'
  mediaType: string
  filename?: string
  url: string
}

type ChatHookResult = ReturnType<typeof useCozeaChat>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type ToolState =
  | 'input-streaming'
  | 'input-available'
  | 'approval-requested'
  | 'approval-responded'
  | 'output-available'
  | 'output-error'
  | 'output-denied'

const TOOL_STATES: ToolState[] = [
  'input-streaming',
  'input-available',
  'approval-requested',
  'approval-responded',
  'output-available',
  'output-error',
  'output-denied',
]

function getToolName(part: ToolPart): string | null {
  if (part.type === 'dynamic-tool') {
    return typeof part.toolName === 'string' && part.toolName.length > 0 ? part.toolName : null
  }
  if (part.type.startsWith('tool-')) {
    const derived = part.type.replace(/^tool-/, '')
    return derived.length > 0 ? derived : null
  }
  return null
}

function getToolState(state: string | undefined): ToolState {
  if (state && TOOL_STATES.includes(state as ToolState)) {
    return state as ToolState
  }
  return 'input-streaming'
}

// Local tools allowed during planning.
// Web search is executed server/provider-side and does not run through local runtime.
const PLANNING_TOOLS = new Set([
  'plan_write'
])

export function WizardConversation({
  projectId,
  initialPrompt,
  promptSettings,
  onPlanSelected,
  className,
}: WizardConversationProps) {
  const navigate = useViewTransitionNavigate()
  const { accessToken, currentOrganization } = useAuth()
  const { connectedProviders, providerAuthAvailable, providerStatusLoaded } = useConnectedProviders()
  const initialGlobalModelSettings = useMemo(() => loadGlobalModelSettings(), [])

  // State
  const [input, setInput] = useState('')
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [model, setModel] = useState(
    initialGlobalModelSettings.model || promptSettings.model || ''
  )
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [providerAuthHeader, setProviderAuthHeader] = useState<string | null>(null)
  const [providerAuthLoading, setProviderAuthLoading] = useState(false)
  const [providerAuthError, setProviderAuthError] = useState<string | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [variantId, setVariantId] = useState<StoredModelSettings['variantId']>(initialGlobalModelSettings.variantId ?? promptSettings?.variantId)
  const [modelSettings, setModelSettings] = useState<Record<string, StoredModelSettings>>(
    () => loadModelSettings()
  )
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, RuntimeModelCapabilities>>({})
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [pendingAttachments, setPendingAttachments] = useState<ChatComposerAttachment[]>([])
  const [attachmentError, setAttachmentError] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const initialConversationIdRef = useRef<string>(
    projectId ? `wizard:${projectId}` : crypto.randomUUID()
  )
  const conversationId = initialConversationIdRef.current
  const [planOptions, setPlanOptions] = useState<PlanOption[] | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const hasSentInitialMessageRef = useRef(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const dragDepthRef = useRef(0)
  const addToolOutputRef = useRef<ChatHookResult['addToolOutput'] | null>(null)
  const cancelledToolCallsRef = useRef<Set<string>>(new Set())
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})

  const providerScopedModels = useMemo(() => {
    const supportedModels = availableModels.filter((m) => isConnectedProvider(m.chefSlug))
    if (!providerAuthAvailable || !providerStatusLoaded) return supportedModels
    if (connectedProviders.length === 0) return []
    const connectedSet = new Set(connectedProviders)
    return supportedModels.filter((m) => connectedSet.has(m.chefSlug as ConnectedProvider))
  }, [availableModels, connectedProviders, providerAuthAvailable, providerStatusLoaded])

  const selectedModelData = providerScopedModels.find((m) => m.id === model)
  const allowCrossProviderSwitching = AI_MODEL_SELECTOR_CONFIG.allowCrossProviderSwitching
  const activeProvider = selectedModelData?.chefSlug
  const visibleModels =
    allowCrossProviderSwitching || !activeProvider
      ? providerScopedModels
      : providerScopedModels.filter((m) => m.chefSlug === activeProvider)
  const visibleChefs = useMemo(
    () => Array.from(new Set(visibleModels.map((m) => m.chef))),
    [visibleModels]
  )
  const hasSelectableModel = Boolean(selectedModelData)
  const selectedModelCapabilities = useMemo(() => modelCapabilities[model] ?? null, [model, modelCapabilities])
  const attachmentSupport = useMemo(
    () => resolveChatAttachmentSupport(selectedModelCapabilities),
    [selectedModelCapabilities]
  )
  const supportsAttachments = attachmentSupport.images || attachmentSupport.pdf
  const attachmentAccept = useMemo(
    () => getChatAttachmentAccept(attachmentSupport),
    [attachmentSupport]
  )
  const supportedVariants = useMemo(
    () =>
      getSupportedVariantsForModel({
        modelId: model,
        provider: selectedModelData?.chefSlug as RuntimeProvider | undefined,
        capabilities: selectedModelCapabilities,
      }),
    [model, selectedModelCapabilities, selectedModelData?.chefSlug]
  )
  const normalizedVariantId = useMemo(
    () =>
      normalizeVariantForModel(variantId, {
        modelId: model,
        provider: selectedModelData?.chefSlug as RuntimeProvider | undefined,
        capabilities: selectedModelCapabilities,
      }),
    [model, selectedModelCapabilities, selectedModelData?.chefSlug, variantId]
  )
  const selectedProviderForAuth = useMemo(() => {
    const selectedProvider = selectedModelData?.chefSlug
    if (selectedProvider && isConnectedProvider(selectedProvider)) {
      return selectedProvider
    }
    return inferProviderFromModelId(model)
  }, [model, selectedModelData?.chefSlug])
  const providerRequiresLocalAuth = Boolean(
    selectedProviderForAuth && !isManagedProvider(selectedProviderForAuth)
  )

  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const isAgentMode = false

  const removePendingAttachment = useCallback((index: number) => {
    setPendingAttachments((current) => current.filter((_, currentIndex) => currentIndex !== index))
  }, [])

  const clearPendingAttachments = useCallback(() => {
    setPendingAttachments([])
  }, [])

  const handleAttachmentSelection = useCallback(async (files: FileList | File[]) => {
    const { attachments, rejected } = await fileListToChatComposerAttachments(files, attachmentSupport)

    if (attachments.length > 0) {
      setPendingAttachments((current) => [...current, ...attachments])
    }
    setAttachmentError(buildAttachmentRejectionMessage(rejected, attachmentSupport) || null)
  }, [attachmentSupport])

  const modelSettingsRef = useRef(modelSettings)
  useEffect(() => {
    modelSettingsRef.current = modelSettings
  }, [modelSettings])

  useEffect(() => {
    const nextSettings: StoredModelSettings = {
      agentId: 'plan',
      surface: 'wizard',
    }
    setModelSettings((prev) => {
      const updated = writeStoredModelSettings(prev, model, 'wizard', nextSettings)
      saveModelSettings(updated)
      return updated
    })
  }, [model])

  useEffect(() => {
    if (!model) return
    updateGlobalModelSettings({
      model,
      variantId: variantId ?? normalizedVariantId,
    })
  }, [model, variantId, normalizedVariantId])

  useEffect(() => {
    if (providerScopedModels.length === 0) return
    if (!providerScopedModels.some((item) => item.id === model)) {
      setModel(providerScopedModels[0].id)
    }
  }, [providerScopedModels, model])

  const headers = useMemo((): Record<string, string> => {
    if (!accessToken) return {}
    return { Authorization: `Bearer ${accessToken}` }
  }, [accessToken])

  useEffect(() => {
    if (accessToken && currentOrganization?.organizationId) return
    setModelsError(null)
    setToolsError(null)
  }, [accessToken, currentOrganization?.organizationId])

  useEffect(() => {
    let cancelled = false
    const organizationId = currentOrganization?.organizationId
    if (!organizationId) {
      setProviderAuthLoading(false)
      setProviderAuthError(null)
      setProviderAuthHeader(null)
      return
    }

    const provider = selectedProviderForAuth
    if (!provider) {
      setProviderAuthLoading(false)
      setProviderAuthError(null)
      setProviderAuthHeader(null)
      return
    }
    if (isManagedProvider(provider)) {
      setProviderAuthLoading(false)
      setProviderAuthError(null)
      setProviderAuthHeader(null)
      return
    }

    setProviderAuthLoading(true)
    setProviderAuthError(null)
    setProviderAuthHeader(null)

    void (async () => {
      const result = await buildEncodedProviderAuthHeader({
        provider,
        modelId: model,
        organizationId,
      })
      if (cancelled) return
      setProviderAuthLoading(false)
      if (result.header) {
        setProviderAuthHeader(result.header)
        setProviderAuthError(null)
        return
      }

      setProviderAuthHeader(null)
      setProviderAuthError(result.error || 'Provider authentication is not ready on this device.')
    })()

    return () => {
      cancelled = true
    }
  }, [currentOrganization?.organizationId, model, selectedProviderForAuth])

  const toolsByName = useMemo(() => {
    const map = new Map<string, ToolMeta>()
    for (const tool of availableTools) {
      map.set(tool.name, tool)
    }
    return map
  }, [availableTools])

  // Sync tools
  useEffect(() => {
    toolsByNameRef.current = Object.fromEntries(
      availableTools.map((tool) => [tool.name, tool])
    )
  }, [availableTools])

  // Fetch models
  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId || !providerStatusLoaded) return
    let cancelled = false

    getModelCatalog({
      organizationId: currentOrganization.organizationId,
      accessToken,
      connectedProviders: providerAuthAvailable ? connectedProviders : undefined,
    })
      .then((data: ModelApiResponse) => {
        if (cancelled) return
        if (!data?.models) return
        const mapped = data.models
          .filter((m): m is ModelApiModel & { provider: ConnectedProvider } => isConnectedProvider(m.provider))
          .map((m) => ({
            id: m.id,
            name: m.displayName,
            chef: getProviderDisplayName(m.provider),
            chefSlug: m.provider,
            tier: m.tier,
            providers: [m.provider],
            limit: m.limit,
          }))
        const caps: Record<string, RuntimeModelCapabilities> = {}
        for (const m of data.models) {
          if (m.capabilities) caps[m.id] = m.capabilities
        }
        setModelCapabilities(caps)
        setModelsError(null)
        setAvailableModels(mapped)
      })
      .catch((err) => {
        if (cancelled) return
        const message = err instanceof Error && err.message ? err.message : 'Failed to load models'
        setModelsError(message)
        console.warn('Failed to fetch models:', err)
      })

    return () => {
      cancelled = true
    }
  }, [
    accessToken,
    connectedProviders,
    currentOrganization?.organizationId,
    providerAuthAvailable,
    providerStatusLoaded,
  ])

  // Fetch tools
  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId) return
    const controller = new AbortController()
    const query = new URLSearchParams({
      organizationId: currentOrganization.organizationId,
      model,
      agentId: 'plan',
      surface: 'wizard',
      hasProjectContext: '0',
    })

    fetchWithAbort(`${AI_BASE_URL}/tools?${query.toString()}`, {
      headers,
      signal: controller.signal,
    }, { signal: controller.signal, timeoutMs: 15000 })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Unauthorized. Please sign in again.')
          }
          throw new Error('Failed to load tools')
        }
        return res.json()
      })
      .then((data: ToolResponse) => {
        if (!data?.tools) return
        setAvailableTools(data.tools)
        setToolsError(null)
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        const message = err instanceof Error && err.message ? err.message : 'Failed to load tools'
        setToolsError(message)
        console.warn('Failed to fetch tools:', err)
      })

    return () => controller.abort()
  }, [accessToken, currentOrganization?.organizationId, headers, model])

  // Tool execution (same as AIConversation)
  const shouldRequireLocalApproval = useCallback((toolMeta?: ToolMeta) => {
    if (!toolMeta) return false
    if (toolMeta.executionEnvironment !== 'local') return false
    if (isAgentMode) return false
    return toolMeta.requiresApproval
  }, [isAgentMode])

  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: ToolCallPayload }) => {
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const toolMeta = toolsByNameRef.current[toolCall.toolName]
    if (!toolMeta || toolMeta.executionEnvironment !== 'local') return
    if (shouldRequireLocalApproval(toolMeta)) return

    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    // Planning-phase gating: local runtime only allows plan_write.
    if (!PLANNING_TOOLS.has(toolCall.toolName)) {
      void addToolOutput({
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        errorText: 'This tool is not available during planning.',
      })
      return
    }

    try {
      const normalizedInput = normalizeToolInput(toolCall.toolName, toolCall.input)
      if (!isRecord(normalizedInput)) {
        void addToolOutput({
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: 'Tool input must be an object.',
        })
        return
      }

      const result = await localRuntime.requestToolExecution(conversationId, {
        toolName: toolCall.toolName,
        input: normalizedInput,
        toolCallId: toolCall.toolCallId,
      })

      if (cancelledToolCallsRef.current.has(toolCall.toolCallId)) {
        return
      }

      if (result.success) {
        void addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: result.output,
        })
      } else {
        void addToolOutput({
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: result.error || 'Tool failed',
        })
      }
    } catch (err) {
      if (cancelledToolCallsRef.current.has(toolCall.toolCallId)) {
        return
      }
      void addToolOutput({
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        errorText: err instanceof Error ? err.message : 'Tool failed',
      })
    }
  }, [localRuntime, conversationId, shouldRequireLocalApproval])

  // useChat hook
  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    addToolOutput,
    dedupedMessages,
    retryHint,
    billingError,
    setBillingError,
  } = useCozeaChat({
    transportArgs: {
      accessToken,
      organizationId: currentOrganization?.organizationId,
      model,
      conversationId,
      agentId: 'plan',
      surface: 'wizard',
      variantId,
      enableTools: true,
      enableWebSearch: true,
      extraBody: {
        projectContext: {
          name: projectId || 'wizard-project',
          slug: (projectId || 'wizard-project').toLowerCase(),
          runtime: 'local',
        },
      },
      providerAuthHeader,
    },
    chatOptions: {
      onToolCall: handleToolCall,
    },
    onBillingError: (err) => setBillingError(err as any),
  })

  addToolOutputRef.current = addToolOutput

  const cancelPendingToolOutputs = useCallback(() => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const pendingToolCalls = new Map<string, { toolName: string; toolCallId: string }>()

    for (const message of dedupedMessages) {
      if (message.role !== 'assistant') continue
      if (!Array.isArray(message.parts)) continue

      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
          continue
        }

        const toolPart = part as ToolPart
        const toolCallId = toolPart.toolCallId
        if (!toolCallId) continue

        const state = toolPart.state || 'input-streaming'
        if (state === 'output-available' || state === 'output-error' || state === 'output-denied') {
          continue
        }

        const toolName = part.type === 'dynamic-tool'
          ? toolPart.toolName
          : part.type.replace(/^tool-/, '')
        if (!toolName) continue

        pendingToolCalls.set(toolCallId, { toolName, toolCallId })
        cancelledToolCallsRef.current.add(toolCallId)
      }
    }

    for (const pending of pendingToolCalls.values()) {
      void addToolOutput({
        state: 'output-error',
        tool: pending.toolName,
        toolCallId: pending.toolCallId,
        errorText: 'Cancelled by the current user.',
      })
    }
  }, [dedupedMessages])

  const genericErrorMessage = useMemo(() => {
    if (!error || billingError) return null
    const retryHintMessage = getRetryHintMessage(retryHint)
    if (retryHintMessage) return retryHintMessage
    const message = (error as { message?: string }).message
    if (typeof message === 'string' && message.trim()) return message
    if (typeof error === 'string' && (error as string).trim()) return error as string
    return 'Something went wrong'
  }, [error, billingError, retryHint])
  const retrySurfaceError = useMemo(() => getRetryHintSurfaceError(retryHint), [retryHint])
  const retrySurfaceErrorKey = useMemo(() => {
    if (!retrySurfaceError) return null
    return [
      retrySurfaceError.code,
      retrySurfaceError.title,
      retrySurfaceError.message,
      retrySurfaceError.action?.label ?? '',
      retrySurfaceError.action?.href ?? '',
    ].join('|')
  }, [retrySurfaceError])

  const serviceErrorMessage =
    modelsError ||
    toolsError ||
    (providerRequiresLocalAuth ? providerAuthError : null)
  const surfaceErrorMessage = retrySurfaceError ? serviceErrorMessage : (serviceErrorMessage || genericErrorMessage)

  const genericErrorRef = useRef<string | null>(null)
  useEffect(() => {
    const currentSurfaceKey = retrySurfaceErrorKey || surfaceErrorMessage
    if (!currentSurfaceKey) {
      genericErrorRef.current = null
      setDismissedError(null)
      return
    }
    if (currentSurfaceKey !== genericErrorRef.current) {
      genericErrorRef.current = currentSurfaceKey
      setDismissedError(null)
    }
  }, [retrySurfaceErrorKey, surfaceErrorMessage])

  const showGenericError = Boolean(
    surfaceErrorMessage && dismissedError !== surfaceErrorMessage
  )
  const showRetrySurfaceError = Boolean(
    retrySurfaceError && retrySurfaceErrorKey && dismissedError !== retrySurfaceErrorKey
  )

  const canSendMessage = Boolean(
    accessToken &&
    currentOrganization?.organizationId &&
    hasSelectableModel &&
    (!providerRequiresLocalAuth || (providerAuthHeader && !providerAuthLoading))
  )

  // Send initial message on mount (use ref to prevent duplicate sends)
  useEffect(() => {
    if (!hasSentInitialMessageRef.current && initialPrompt && canSendMessage) {
      hasSentInitialMessageRef.current = true
      void sendMessage({ text: initialPrompt })
    }
  }, [initialPrompt, canSendMessage, sendMessage])

  // Validate and filter plan options
  const validatePlans = (plans: unknown[]): PlanOption[] => {
    return plans
      .filter((plan): plan is PlanOption => {
        if (!plan || typeof plan !== 'object') return false
        const p = plan as Record<string, unknown>
        return (
          typeof p.tier === 'string' &&
          typeof p.name === 'string' &&
          typeof p.description === 'string' &&
          Array.isArray(p.features)
        )
      })
      .map((plan) => ({
        ...plan,
        tier: (plan.tier?.toLowerCase?.() || 'prototype') as 'prototype' | 'beta' | 'mvp',
        features: plan.features || [],
        config: plan.config || {},
      }))
      .filter((plan) => validateWebOnlyPlanConfig(plan.config).valid)
  }

  // Track how many plans we've extracted (need exactly 3 for complete extraction)
  const extractedPlanCountRef = useRef(0)

  // Check for plan options in messages (from plan_write tool call)
  useEffect(() => {
    // Skip if we already have all 3 plans
    if (extractedPlanCountRef.current >= 3) return

    for (const message of messages) {
      if (message.role !== 'assistant') continue

      for (const part of message.parts) {
        // Check for plan_write tool with output - handle various formats from different providers
        const partType = part.type as string
        const toolPart = part as ToolPart
        const isPresntPlans = partType === 'tool-plan_write' ||
          partType.includes('plan_write') ||
          toolPart.toolName === 'plan_write' ||
          (partType === 'tool-invocation' && toolPart.toolName === 'plan_write') ||
          (partType === 'tool-result' && toolPart.toolName === 'plan_write')

        if (isPresntPlans) {
          // Get output from various possible fields (different providers use different formats)
          const rawOutput = toolPart.output ?? toolPart.result
          const rawInput = toolPart.input ?? toolPart.args

          // Check if we have output (complete tool result)
          if ((toolPart.state === 'output-available' || toolPart.state === 'result') && rawOutput) {
            try {
              const output = typeof rawOutput === 'string' ? JSON.parse(rawOutput) : rawOutput
              if (isRecord(output) && Array.isArray(output.plans)) {
                const validPlans = validatePlans(output.plans)
                if (validPlans.length > extractedPlanCountRef.current) {
                  extractedPlanCountRef.current = validPlans.length
                  setPlanOptions(validPlans)
                  if (validPlans.length >= 3) return
                }
              }
            } catch (e) {
              console.warn('Failed to parse plan output:', e)
            }
          }
          // Also check input/args if output not yet available (streaming or Gemini format)
          else if (isRecord(rawInput) && Array.isArray(rawInput.plans)) {
            const validPlans = validatePlans(rawInput.plans)
            if (validPlans.length > extractedPlanCountRef.current) {
              extractedPlanCountRef.current = validPlans.length
              setPlanOptions(validPlans)
              if (validPlans.length >= 3) return
            }
          }
          // Direct plans field check (some providers put it at top level)
          else if (Array.isArray(toolPart.plans)) {
            const validPlans = validatePlans(toolPart.plans)
            if (validPlans.length > extractedPlanCountRef.current) {
              extractedPlanCountRef.current = validPlans.length
              setPlanOptions(validPlans)
              if (validPlans.length >= 3) return
            }
          }
        }
        // Legacy support for data-plan-options
        if (part.type === 'data-plan-options') {
          const data = (part as { data?: unknown }).data
          if (Array.isArray(data)) {
            const validPlans = validatePlans(data)
            if (validPlans.length > extractedPlanCountRef.current) {
              extractedPlanCountRef.current = validPlans.length
              setPlanOptions(validPlans)
              if (validPlans.length >= 3) return
            }
          }
        }
      }
    }
  }, [dedupedMessages])

  // Compute token usage
  const accumulatedUsage = useMemo(() => {
    let inputTokens = 0
    let outputTokens = 0
    let totalTokens = 0
    let reasoningTokens = 0
    let cachedInputTokens = 0
    let cacheWriteTokens = 0
    let usageSpendCents = 0
    const runCosts = new Map<string, number>()

    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === 'data-usage') {
          const data = (part as { data?: UsageData }).data
          if (data) {
            inputTokens += data.promptTokens ?? 0
            outputTokens += data.completionTokens ?? 0
            totalTokens += data.totalTokens ?? ((data.promptTokens ?? 0) + (data.completionTokens ?? 0))
            reasoningTokens += data.reasoningTokens ?? 0
            cachedInputTokens += data.cachedInputTokens ?? 0
            cacheWriteTokens += data.cacheWriteTokens ?? 0
            usageSpendCents += Math.max(0, data.spendCents ?? 0)
          }
        }
        if (part.type === 'data-agent-ledger') {
          const data = (part as { data?: AgentLedgerData }).data
          const runId = typeof data?.runId === 'string' ? data.runId : undefined
          if (!runId) continue
          if (data?.kind === 'step' && typeof data.costUsd === 'number' && Number.isFinite(data.costUsd)) {
            runCosts.set(runId, (runCosts.get(runId) ?? 0) + Math.max(0, data.costUsd))
          }
          if (data?.kind === 'run_completed' && typeof data.billedUsd === 'number' && Number.isFinite(data.billedUsd)) {
            runCosts.set(runId, Math.max(0, data.billedUsd))
          }
        }
      }
    }

    const totalCostUsd =
      runCosts.size > 0
        ? Array.from(runCosts.values()).reduce((sum, value) => sum + value, 0)
        : usageSpendCents / 100

    return {
      usedTokens: totalTokens,
      totalCostUsd,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        reasoningTokens: reasoningTokens || undefined,
        cachedInputTokens: cachedInputTokens || undefined,
        inputTokenDetails: {
          noCacheTokens: Math.max(0, inputTokens - cachedInputTokens - cacheWriteTokens),
          cacheReadTokens: cachedInputTokens || undefined,
          cacheWriteTokens: cacheWriteTokens || undefined,
        },
        outputTokenDetails: {
          textTokens: Math.max(0, outputTokens - reasoningTokens),
          reasoningTokens: reasoningTokens || undefined,
        },
      },
    }
  }, [messages])

  const isLoading = status === 'streaming' || status === 'submitted'

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSendMessage) return
    if (!input.trim() && pendingAttachments.length === 0) return

    const messageText = input.trim() || (pendingAttachments.length > 0 ? 'Analyze this attachment' : '')
    const fileParts = pendingAttachments.map(chatComposerAttachmentToFilePart)
    const messageOptions = fileParts.length > 0
      ? { text: messageText, files: fileParts }
      : { text: messageText }

    // Clear input immediately before sending (don't wait for response)
    setInput('')
    clearPendingAttachments()
    setAttachmentError(null)

    // Send message (don't await - let it stream in the background)
    void sendMessage(messageOptions)
  }

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault()
    cancelPendingToolOutputs()
    void localRuntime.cancelRun(conversationId)
    stop()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  const handleComposerDragEnter = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return
    e.preventDefault()
    if (!supportsAttachments) return
    dragDepthRef.current += 1
    setIsDragActive(true)
  }, [supportsAttachments])

  const handleComposerDragOver = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return
    e.preventDefault()
    if (!supportsAttachments) return
    e.dataTransfer.dropEffect = 'copy'
  }, [supportsAttachments])

  const handleComposerDragLeave = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return
    dragDepthRef.current = Math.max(0, dragDepthRef.current - 1)
    if (dragDepthRef.current === 0) {
      setIsDragActive(false)
    }
  }, [])

  const handleComposerDrop = useCallback((e: React.DragEvent<HTMLDivElement>) => {
    if (!hasFilesInDataTransfer(e.dataTransfer)) return
    e.preventDefault()
    dragDepthRef.current = 0
    setIsDragActive(false)
    if (!supportsAttachments) return

    if (e.dataTransfer.files.length > 0) {
      void handleAttachmentSelection(e.dataTransfer.files)
    }
  }, [handleAttachmentSelection, supportsAttachments])

  return (
    <div className={cn('flex flex-col overflow-hidden w-full h-full', className)}>
      {/* Messages Area */}
      <div className="flex-1 min-h-0 relative w-full">
        {/* Top fade */}
        <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />
        <Conversation className="h-full">
          <ConversationContent className="w-full max-w-none px-10 md:px-16 lg:px-24 xl:px-32 pt-8 pb-8">
            {messages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                toolsByName={toolsByName}
                status={status}
              />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground py-2">
                <Loader className="h-4 w-4" />
                <span className="text-sm">Generating...</span>
              </div>
            )}
            {/* Plan selector when AI generates plans */}
            {planOptions && (
              <PlanSelector
                plans={planOptions}
                onSelect={onPlanSelected}
              />
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Input Area */}
      <div className="shrink-0 pt-2 pb-3 px-3 bg-background w-full max-w-2xl mx-auto">
        <div
          className={cn(
            'bg-secondary rounded-2xl overflow-hidden transition-[background-color,box-shadow] duration-150',
            isDragActive && 'bg-secondary/90 ring-2 ring-primary/60 ring-offset-2 ring-offset-background'
          )}
          onDragEnter={handleComposerDragEnter}
          onDragOver={handleComposerDragOver}
          onDragLeave={handleComposerDragLeave}
          onDrop={handleComposerDrop}
        >
          {billingError ? (
            <BillingError
              error={billingError as any}
              onAction={(href) => navigate(href)}
              className="border-0 border-b rounded-none p-3"
            />
          ) : showRetrySurfaceError && retrySurfaceError ? (
            <AiSurfaceErrorCard
              error={retrySurfaceError}
              className="rounded-none p-3"
              onDismiss={() => setDismissedError(retrySurfaceErrorKey)}
            />
          ) : showGenericError && surfaceErrorMessage && (
            <div className="flex items-start gap-3 bg-destructive/10 text-destructive border-b border-destructive/30 px-3 py-2">
              <p className="text-xs leading-relaxed flex-1">
                {surfaceErrorMessage}
              </p>
              <button
                type="button"
                className="mt-0.5 text-destructive/70 hover:text-destructive"
                onClick={() => setDismissedError(surfaceErrorMessage)}
                aria-label="Dismiss error"
              >
                <IconX className="size-4" />
              </button>
            </div>
          )}
          <input
            ref={fileInputRef}
            type="file"
            multiple
            accept={attachmentAccept}
            className="sr-only"
            onChange={(e) => {
              if (e.target.files && e.target.files.length > 0) {
                void handleAttachmentSelection(e.target.files)
              }
              e.target.value = ''
            }}
          />

          <ScreenshotAttachments
            attachments={pendingAttachments}
            onRemove={removePendingAttachment}
          />
          {attachmentError ? (
            <div className="px-3 pb-2 text-xs text-destructive">
              {attachmentError}
            </div>
          ) : null}

          <div className="px-3 pt-3 pb-2 grow">
            <form onSubmit={handleSubmit}>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Continue the conversation..."
                className="w-full !bg-transparent rounded-none p-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder-muted-foreground resize-none border-none outline-none text-sm min-h-5 max-h-[25vh]"
                rows={1}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement
                  target.style.height = 'auto'
                  target.style.height = target.scrollHeight + 'px'
                }}
              />
            </form>
          </div>

          <div className="mb-2 px-2 flex items-center justify-between">
            <div className="flex items-center gap-1">
              <Button
                variant="ghost"
                size="sm"
                className="h-7 w-7 p-0 rounded-full border border-border hover:bg-accent"
                onClick={() => fileInputRef.current?.click()}
                disabled={!supportsAttachments}
                title={supportsAttachments ? 'Attach files' : 'Attachments unavailable'}
              >
                <IconPlus className="size-3" />
              </Button>

              {hasSelectableModel && (
                <ModelSelector onOpenChange={setModelSelectorOpen} open={modelSelectorOpen}>
                  <ModelSelectorTrigger asChild>
                    <Button
                      variant="ghost"
                      size="sm"
                      className="h-7 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
                    >
                      {selectedModelData?.chefSlug && (
                        <ModelSelectorLogo provider={selectedModelData.chefSlug} />
                      )}
                      {selectedModelData?.name && (
                        <ModelSelectorName className="ml-1">{selectedModelData.name}</ModelSelectorName>
                      )}
                      <IconChevronDown className="size-3 ml-1" />
                    </Button>
                  </ModelSelectorTrigger>
                  <ModelSelectorContent>
                    <ModelSelectorInput placeholder="Search models..." />
                    <ModelSelectorList>
                      <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                      {visibleChefs.map((chef) => (
                        <ModelSelectorGroup heading={chef} key={chef}>
                          {visibleModels
                            .filter((m) => m.chef === chef)
                            .map((m) => (
                              <ModelSelectorItem
                                key={m.id}
                                onSelect={() => {
                                  setModel(m.id)
                                  setModelSelectorOpen(false)
                                }}
                                value={m.id}
                              >
                                <ModelSelectorLogo provider={m.chefSlug} />
                                <ModelSelectorName>{m.name}</ModelSelectorName>
                                <ModelSelectorLogoGroup>
                                  {m.providers.map((provider) => (
                                    <ModelSelectorLogo key={provider} provider={provider} />
                                  ))}
                                </ModelSelectorLogoGroup>
                                {model === m.id ? (
                                  <IconCheck className="ml-auto size-4" />
                                ) : (
                                  <div className="ml-auto size-4" />
                                )}
                              </ModelSelectorItem>
                            ))}
                        </ModelSelectorGroup>
                      ))}
                    </ModelSelectorList>
                  </ModelSelectorContent>
                </ModelSelector>
              )}
            </div>

            <Button
              type="submit"
              disabled={(!canSendMessage || (!input.trim() && pendingAttachments.length === 0)) && !isLoading}
              className="size-7 p-0 rounded-full bg-primary disabled:opacity-50 disabled:cursor-not-allowed"
              onClick={(e) => isLoading ? handleStop(e) : handleSubmit(e)}
            >
              {isLoading ? (
                <IconSquare className="size-3 fill-primary-foreground text-primary-foreground" />
              ) : (
                <IconArrowUp className="size-4 text-primary-foreground" />
              )}
            </Button>
          </div>
        </div>
        {!hasSelectableModel && providerStatusLoaded && providerAuthAvailable && (
          <p className="pt-2 text-xs text-amber-600">
            Connect an AI provider in Workspace AI settings to continue planning.
          </p>
        )}
        {hasSelectableModel && providerRequiresLocalAuth && providerAuthLoading && (
          <p className="pt-2 text-xs text-muted-foreground">
            Preparing provider authentication...
          </p>
        )}

        {/* Options row */}
        <div className="flex items-center gap-0 pt-2">
          {hasSelectableModel && (
            <>
              <div
                className={cn(
                  "grid overflow-hidden transition-all duration-200 ease-out",
                  supportedVariants.length > 1
                    ? "grid-cols-[1fr] opacity-100 translate-y-0"
                    : "grid-cols-[0fr] opacity-0 -translate-y-1 pointer-events-none"
                )}
              >
                <div className="min-w-0">
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        variant="ghost"
                        size="sm"
                        className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
                      >
                        <Brain className="size-3" />
                        <span>{VARIANT_DEFINITIONS[normalizedVariantId]?.label ?? normalizedVariantId}</span>
                        <IconChevronDown className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start" className="max-w-xs rounded-2xl p-1.5 bg-secondary border-border">
                      <DropdownMenuGroup className="space-y-1">
                        {supportedVariants.map((variant) => (
                          <DropdownMenuItem
                            key={variant}
                            className="rounded-[calc(1rem-6px)] text-xs"
                            onClick={() => setVariantId(variant)}
                          >
                            <Brain size={16} className="opacity-60" />
                            {VARIANT_DEFINITIONS[variant]?.label ?? variant}
                          </DropdownMenuItem>
                        ))}
                      </DropdownMenuGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
              </div>
              <div
                className={cn(
                  "grid overflow-hidden transition-all duration-200 ease-out",
                  supportedVariants.length <= 1
                    ? "grid-cols-[1fr] opacity-100 translate-y-0"
                    : "grid-cols-[0fr] opacity-0 -translate-y-1 pointer-events-none"
                )}
              >
                <div className="min-w-0 h-6 px-2 flex items-center rounded-full border border-transparent text-muted-foreground text-xs">
                  <Brain className="size-3 mr-1" />
                  <span>{VARIANT_DEFINITIONS[normalizedVariantId]?.label ?? normalizedVariantId}</span>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <Context
                  maxTokens={selectedModelData?.limit?.context ?? getContextWindowSize(model)}
                  usedTokens={accumulatedUsage.usedTokens}
                  usage={accumulatedUsage.usage}
                  modelId={model}
                >
                  <ContextTrigger />
                  <ContextContent>
                    <ContextContentHeader />
                  </ContextContent>
                </Context>
              </div>
            </>
          )}

          <div className="flex-1" />
        </div>
      </div>
    </div>
  )
}

// Message bubble component (matching AIConversation)
interface MessageBubbleProps {
  message: UIMessage
  toolsByName: Map<string, ToolMeta>
  status: 'ready' | 'submitted' | 'streaming' | 'error'
}

function MessageBubble({ message, toolsByName, status }: MessageBubbleProps) {
  const isStreaming = status === 'streaming'
  const sourceItems = extractSourcesFromParts(message.parts)
  const hasStandaloneAttachments = message.role === 'user' && message.parts.some(isFilePart)

  return (
    <Message from={message.role}>
      <MessageContent
        className={cn(
          hasStandaloneAttachments && [
            'group-[.is-user]:w-full',
            'group-[.is-user]:bg-transparent',
            'group-[.is-user]:rounded-none',
            'group-[.is-user]:px-0',
            'group-[.is-user]:py-0',
          ]
        )}
      >
        {message.parts.map((part, index) => {
          if (part.type === 'step-start') {
            return (
              <div key={`${message.id}-step-${index}`} className="py-2">
                <div className="h-px bg-border" />
              </div>
            )
          }

          if (isFilePart(part)) {
            return (
              <div
                key={`${message.id}-file-${index}`}
                className={message.role === 'user' ? 'flex justify-end' : 'flex'}
              >
                <ChatAttachmentCard
                  mediaType={part.mediaType}
                  name={part.filename || defaultAttachmentName(part.mediaType)}
                  url={part.url}
                  size="message"
                />
              </div>
            )
          }

          if (part.type === 'text') {
            return (
              hasStandaloneAttachments && message.role === 'user'
                ? (
                  <div key={`${message.id}-text-${index}`} className="flex justify-end">
                    <div className="max-w-full rounded-3xl bg-secondary px-3.5 py-2.5 text-foreground">
                      <MessageResponse>{part.text}</MessageResponse>
                    </div>
                  </div>
                )
                : (
                  <MessageResponse key={`${message.id}-text-${index}`}>
                    {part.text}
                  </MessageResponse>
                )
            )
          }

          if (part.type === 'reasoning') {
            const reasoningPart = part as ReasoningPart
            return (
              <Reasoning
                key={`${message.id}-reasoning-${index}`}
                isStreaming={isStreaming}
                duration={reasoningPart.duration}
              >
                <ReasoningTrigger />
                <ReasoningContent>{reasoningPart.text || ''}</ReasoningContent>
              </Reasoning>
            )
          }

          if (part.type === 'data-usage') return null

          // Tool calls
          if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
            const toolPart = part as ToolPart
            const toolName = getToolName(toolPart)
            if (!toolName) return null
            const toolInput = isRecord(toolPart.input) ? toolPart.input : undefined

            // Skip plan_write tool - it's rendered as PlanSelector below messages
            if (toolName === 'plan_write') {
              return null
            }

            const toolMeta = toolsByName.get(toolName)
            const toolState = getToolState(toolPart.state)
            const isEditTool = isFileEditTool(toolName)
            // Special handling for web search tools (show only sources)
            const isWebSearchTool = toolName.toLowerCase().includes('search') ||
              toolName.toLowerCase().includes('web') ||
              toolName === 'tavily_search' ||
              toolName === 'brave_search' ||
              toolName === 'bing_search'

            // Non-expandable tools (output is not useful to display)
            const isStaticTool = toolName === 'read'

            // Render static (non-expandable) tools
            if (isStaticTool) {
              return (
                <ToolStatic
                  key={`${message.id}-tool-${index}`}
                  toolName={toolName}
                  input={toolInput}
                  type={toolMeta?.toolType || 'function'}
                  state={toolState}
                />
              )
            }

            return (
              <Tool key={`${message.id}-tool-${index}`}>
                <ToolHeader
                  toolName={toolName}
                  input={toolInput}
                  type={toolMeta?.toolType || 'function'}
                  state={toolState}
                />
                <ToolContent>
                  {/* For file edit tools, show Monaco diff viewer */}
                  {isEditTool && toolInput && (
                    <ToolDiffOutput
                      toolName={toolName}
                      input={toolInput}
                      maxHeight={300}
                    />
                  )}
                  {/* For non-edit/non-list/non-web_search tools, show raw input */}
                  {!isEditTool && !isWebSearchTool && toolName !== 'list' && toolInput && (
                    <ToolInput input={formatToolPayload(toolInput)} />
                  )}
                  {toolPart.state === 'output-available' && (
                    toolName === 'todowrite'
                      ? (() => {
                        const tasks = extractTasksFromToolOutput(toolPart.output)
                        if (tasks.length === 0) {
                          return <ToolOutput output={formatToolPayload(toolPart.output)} toolName={toolName} />
                        }
                        return <TaskProgress tasks={tasks} showSummary />
                      })()
                      : isEditTool
                        ? null // Diff viewer already shows the edit
                        : isWebSearchTool
                          ? null // Web search shows only sources, no raw output
                          : <ToolOutput output={formatToolPayload(toolPart.output)} toolName={toolName} />
                  )}
                  {toolPart.state === 'output-error' && (
                    <ToolOutput output={null} errorText={toolPart.errorText} toolName={toolName} />
                  )}
                </ToolContent>
              </Tool>
            )
          }

          return null
        })}
        {sourceItems.length > 0 && (
          <div className="px-2 pb-2">
            <Sources>
              <SourcesTrigger count={sourceItems.length} />
              <SourcesContent>
                {sourceItems.map((source, idx) => (
                  <Source
                    key={`${source.url}-${idx}`}
                    href={source.url}
                    title={source.title}
                    favicon={source.favicon}
                  />
                ))}
              </SourcesContent>
            </Sources>
          </div>
        )}
      </MessageContent>
    </Message>
  )
}

function formatToolPayload(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    return JSON.stringify(value, null, 2) ?? String(value)
  } catch {
    return String(value)
  }
}

function defaultAttachmentName(mediaType: string): string {
  if (mediaType.toLowerCase() === 'application/pdf') {
    return 'Attachment.pdf'
  }

  if (mediaType.toLowerCase().startsWith('image/')) {
    return 'Image attachment'
  }

  return 'Attachment'
}

function isFilePart(part: UIMessage['parts'][number]): part is FilePart {
  return (
    part.type === 'file' &&
    typeof (part as FilePart).mediaType === 'string' &&
    typeof (part as FilePart).url === 'string'
  )
}

function extractTasksFromToolOutput(output: unknown): TaskData[] {
  let payload: unknown = output
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return []
    }
  }

  if (!isRecord(payload)) return []
  const tasks = Array.isArray(payload.tasks) ? payload.tasks : []
  return tasks
    .filter((task): task is Record<string, unknown> => isRecord(task))
    .map((task) => {
      const status = typeof task.status === 'string' ? task.status : 'pending'
      return {
        id: String(task.id ?? crypto.randomUUID()),
        title: String(task.title ?? 'Untitled task'),
        status: status as TaskData['status'],
        files: Array.isArray(task.files) ? task.files.map((file) => String(file)) : undefined,
        details: task.details ? String(task.details) : undefined,
      }
    })
}

function extractSourcesFromParts(parts: UIMessage['parts']) {
  const sources: Array<{ url: string; title: string; favicon?: string }> = []
  for (const part of parts) {
    if (part.type !== 'source-url') continue
    const sourcePart = part as SourcePart
    const url = sourcePart.url || sourcePart.uri || sourcePart.source?.url
    if (!url) continue
    sources.push({
      url,
      title: sourcePart.title || sourcePart.source?.title || url,
      favicon: sourcePart.favicon,
    })
  }
  return sources
}
