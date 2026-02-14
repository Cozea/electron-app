import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
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
  IconPaperclip,
  IconSquare,
  IconCheck,
  IconX,
} from '@tabler/icons-react'
import { Brain } from 'lucide-react'
import { useAuth } from '@/contexts/AuthContext'
import {
  CONNECTED_PROVIDER_DISPLAY_NAME,
  CONNECTED_PROVIDER_ORDER,
  isConnectedProvider,
  useConnectedProviders,
  type ConnectedProvider,
} from '@/hooks/useConnectedProviders'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { getContextWindowSize } from '@/components/assistant/ContextDisplay'
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
  ContextContentFooter,
} from '@/components/ai-elements/context'
import { TaskProgress, type TaskData } from '@/components/assistant/TaskProgress'
import { ToolDiffOutput, isFileEditTool } from '@/components/ai-elements/tool-diff-output'
import { PlanSelector, type PlanOption } from './PlanSelector'
import { BillingError, parseBillingError, type BillingErrorData } from '@/components/assistant/BillingError'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'
import { DEFAULT_MODELS, type ModelOption } from '@/lib/ai/defaultModels'
import { AI_API_URL, AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import { buildEncodedProviderAuthHeader, inferProviderFromModelId } from '@/lib/ai/providerAuth'
import { validateWebOnlyPlanConfig } from '@/lib/plan'
import type { ToolCallPayload, ToolMetaShape, ToolsApiResponse } from '@/lib/ai/toolTypes'

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

interface ModelApiModel {
  id: string
  displayName: string
  provider: string
  tier: string
  capabilities?: RuntimeModelCapabilities
}

interface ModelApiResponse {
  models: ModelApiModel[]
}

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
}

interface SourcePart {
  url?: string
  uri?: string
  title?: string
  favicon?: string
  source?: { url?: string; title?: string }
}

type ChatHookResult = ReturnType<typeof useChat>

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
  'present_plans'
])

// Model catalog (same as AIConversation)
const defaultModels: ModelOption[] = DEFAULT_MODELS

export function WizardConversation({
  projectId,
  initialPrompt,
  promptSettings,
  onPlanSelected,
  className,
}: WizardConversationProps) {
  const navigate = useNavigate()
  const { accessToken, currentOrganization } = useAuth()
  const { connectedProviders, providerAuthAvailable, providerStatusLoaded } = useConnectedProviders()
  const initialGlobalModelSettings = useMemo(() => loadGlobalModelSettings(), [])

  // State
  const [input, setInput] = useState('')
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(defaultModels)
  const [model, setModel] = useState(
    initialGlobalModelSettings.model || promptSettings.model || defaultModels[0]?.id || ''
  )
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [providerAuthHeader, setProviderAuthHeader] = useState<string | null>(null)
  const [providerAuthLoading, setProviderAuthLoading] = useState(false)
  const [providerAuthError, setProviderAuthError] = useState<string | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [variantId, setVariantId] = useState<StoredModelSettings['variantId']>(
    initialGlobalModelSettings.variantId ?? promptSettings.variantId ?? 'medium'
  )
  const [modelSettings, setModelSettings] = useState<Record<string, StoredModelSettings>>(
    () => loadModelSettings()
  )
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, RuntimeModelCapabilities>>({})
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [conversationId] = useState(() => crypto.randomUUID())
  const [planOptions, setPlanOptions] = useState<PlanOption[] | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const hasSentInitialMessageRef = useRef(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
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
    () =>
      CONNECTED_PROVIDER_ORDER
        .map((provider) => CONNECTED_PROVIDER_DISPLAY_NAME[provider])
        .filter((chef) => visibleModels.some((modelOption) => modelOption.chef === chef)),
    [visibleModels]
  )
  const hasSelectableModel = Boolean(selectedModelData)
  const selectedModelCapabilities = useMemo(() => modelCapabilities[model] ?? null, [model, modelCapabilities])
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

  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const isAgentMode = false

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

    const selectedProvider = selectedModelData?.chefSlug
    const provider = (selectedProvider && isConnectedProvider(selectedProvider))
      ? selectedProvider
      : inferProviderFromModelId(model)
    if (!provider) {
      setProviderAuthLoading(false)
      setProviderAuthError('Unable to determine provider auth for the selected model.')
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
  }, [model, selectedModelData?.chefSlug, currentOrganization?.organizationId])

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
    if (!accessToken || !currentOrganization?.organizationId) return
    const controller = new AbortController()

    fetch(`${AI_BASE_URL}/models?organizationId=${encodeURIComponent(currentOrganization.organizationId)}`, {
      headers,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) {
          if (res.status === 401 || res.status === 403) {
            throw new Error('Unauthorized. Please sign in again.')
          }
          throw new Error('Failed to load models')
        }
        return res.json()
      })
      .then((data: ModelApiResponse) => {
        if (!data?.models) return
        const mapped = data.models
          .filter((m): m is ModelApiModel & { provider: ConnectedProvider } => isConnectedProvider(m.provider))
          .map((m) => ({
            id: m.id,
            name: m.displayName,
            chef: CONNECTED_PROVIDER_DISPLAY_NAME[m.provider],
            chefSlug: m.provider,
            tier: m.tier,
            providers: [m.provider],
          }))
        const caps: Record<string, RuntimeModelCapabilities> = {}
        for (const m of data.models) {
          if (m.capabilities) caps[m.id] = m.capabilities
        }
        setModelCapabilities(caps)
        setModelsError(null)
        if (mapped.length > 0) {
          setAvailableModels(mapped)
        }
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        const message = err instanceof Error && err.message ? err.message : 'Failed to load models'
        setModelsError(message)
        console.warn('Failed to fetch models:', err)
      })

    return () => controller.abort()
  }, [accessToken, currentOrganization?.organizationId, headers])

  // Fetch tools
  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId) return
    const controller = new AbortController()

    fetch(`${AI_BASE_URL}/tools?organizationId=${encodeURIComponent(currentOrganization.organizationId)}`, {
      headers,
      signal: controller.signal,
    })
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
  }, [accessToken, currentOrganization?.organizationId, headers])

  // Request config ref (projectId is optional - may not exist during planning phase)
  const requestConfigRef = useRef({
    accessToken,
    organizationId: currentOrganization?.organizationId || null,
    projectId: projectId || null,
    model,
    conversationId,
    agentId: 'plan' as const,
    surface: 'wizard' as const,
    variantId: normalizedVariantId,
    providerAuthHeader,
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: currentOrganization?.organizationId || null,
      projectId: projectId || null,
      model,
      conversationId,
      agentId: 'plan',
      surface: 'wizard',
      variantId: normalizedVariantId,
      providerAuthHeader,
    }
  }, [accessToken, currentOrganization?.organizationId, projectId, model, conversationId, normalizedVariantId, providerAuthHeader])

  // Chat transport (same pattern as AIConversation)
  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: AI_API_URL,
      headers: (): Record<string, string> => {
        const token = requestConfigRef.current.accessToken
        const providerHeader = requestConfigRef.current.providerAuthHeader
        const next: Record<string, string> = {}
        if (token) {
          next.Authorization = `Bearer ${token}`
        }
        if (providerHeader) {
          next['x-cozea-provider-auth'] = providerHeader
        }
        return next
      },
      body: () => ({
        model: requestConfigRef.current.model,
        organizationId: requestConfigRef.current.organizationId,
        // Only include projectId if it exists (project created when plan selected)
        ...(requestConfigRef.current.projectId && { projectId: requestConfigRef.current.projectId }),
        conversationId: requestConfigRef.current.conversationId,
        agentId: requestConfigRef.current.agentId,
        surface: requestConfigRef.current.surface,
        variantId: requestConfigRef.current.variantId,
        enableTools: true, // Always enabled - gated client-side based on planning phase
        enableWebSearch: true, // Always enabled
      }),
      prepareSendMessagesRequest: ({ messages, body, messageId }) => {
        const api = `${AI_BASE_URL}/chat`
        const requestBody = body ?? {}
        const nextBody = {
          ...requestBody,
          messages,
          ...(messageId ? { requestId: messageId } : {}),
        }
        return { api, body: nextBody }
      },
    })
  }, [])

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

    // Planning-phase gating: local runtime only allows present_plans.
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
  } = useChat({
    transport: chatTransport,
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }),
    onToolCall: handleToolCall,
    onError: (err: unknown) => {
      console.error('Chat error:', err)
      const billingErr = parseBillingError(err)
      if (billingErr) {
        setBillingError(billingErr)
      }
    },
  })

  addToolOutputRef.current = addToolOutput

  const cancelPendingToolOutputs = useCallback(() => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const pendingToolCalls = new Map<string, { toolName: string; toolCallId: string }>()

    for (const message of messages) {
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
  }, [messages])

  const genericErrorMessage = useMemo(() => {
    if (!error) return null
    const message = (error as { message?: string }).message
    if (typeof message === 'string' && message.trim()) return message
    if (typeof error === 'string' && (error as string).trim()) return error as string
    return 'Something went wrong'
  }, [error])

  const serviceErrorMessage = modelsError || toolsError || providerAuthError
  const surfaceErrorMessage = serviceErrorMessage || genericErrorMessage

  const genericErrorRef = useRef<string | null>(null)
  useEffect(() => {
    if (!surfaceErrorMessage) {
      genericErrorRef.current = null
      setDismissedError(null)
      return
    }
    if (surfaceErrorMessage !== genericErrorRef.current) {
      genericErrorRef.current = surfaceErrorMessage
      setDismissedError(null)
    }
  }, [surfaceErrorMessage])

  const showGenericError = Boolean(
    surfaceErrorMessage && dismissedError !== surfaceErrorMessage
  )

  const canSendMessage = Boolean(
    accessToken &&
    currentOrganization?.organizationId &&
    hasSelectableModel &&
    providerAuthHeader &&
    !providerAuthLoading
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

  // Check for plan options in messages (from present_plans tool call)
  useEffect(() => {
    // Skip if we already have all 3 plans
    if (extractedPlanCountRef.current >= 3) return

    for (const message of messages) {
      if (message.role !== 'assistant') continue

      for (const part of message.parts) {
        // Check for present_plans tool with output - handle various formats from different providers
        const partType = part.type as string
        const toolPart = part as ToolPart
        const isPresntPlans = partType === 'tool-present_plans' ||
          partType.includes('present_plans') ||
          toolPart.toolName === 'present_plans' ||
          (partType === 'tool-invocation' && toolPart.toolName === 'present_plans') ||
          (partType === 'tool-result' && toolPart.toolName === 'present_plans')

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
  }, [messages])

  // Compute token usage
  const accumulatedUsage = useMemo(() => {
    let inputTokens = 0
    let outputTokens = 0
    let reasoningTokens = 0
    let cachedInputTokens = 0

    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === 'data-usage') {
          const data = (part as { data?: UsageData }).data
          if (data) {
            inputTokens += data.promptTokens ?? 0
            outputTokens += data.completionTokens ?? 0
            reasoningTokens += data.reasoningTokens ?? 0
            cachedInputTokens += data.cachedInputTokens ?? 0
          }
        }
      }
    }

    const totalTokens = inputTokens + outputTokens

    return {
      usedTokens: totalTokens,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens,
        reasoningTokens: reasoningTokens || undefined,
        cachedInputTokens: cachedInputTokens || undefined,
        inputTokenDetails: {
          noCacheTokens: inputTokens - cachedInputTokens,
          cacheReadTokens: cachedInputTokens || undefined,
          cacheWriteTokens: undefined,
        },
        outputTokenDetails: {
          textTokens: outputTokens - reasoningTokens,
          reasoningTokens: reasoningTokens || undefined,
        },
      },
    }
  }, [messages])

  const isLoading = status === 'streaming' || status === 'submitted'

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!canSendMessage) return
    if (!input.trim()) return

    const messageText = input
    // Clear input immediately before sending (don't wait for response)
    setInput('')

    // Send message (don't await - let it stream in the background)
    void sendMessage({ text: messageText })
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
        <div className="bg-muted/40 border border-border rounded-2xl overflow-hidden">
          {billingError ? (
            <BillingError
              error={billingError}
              onAction={(href) => navigate(href)}
              className="border-0 border-b rounded-none p-3"
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
            className="sr-only"
            onChange={(e) => console.log(e.target.files)}
          />

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
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 w-7 p-0 rounded-full border border-border hover:bg-accent"
                  >
                    <IconPlus className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-xs rounded-2xl p-1.5">
                  <DropdownMenuGroup className="space-y-1">
                    <DropdownMenuItem
                      className="rounded-[calc(1rem-6px)] text-xs"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <IconPaperclip size={16} className="opacity-60" />
                      Attach Files
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>

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
            </div>

            <Button
              type="submit"
              disabled={(!canSendMessage || !input.trim()) && !isLoading}
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
        {hasSelectableModel && providerAuthLoading && (
          <p className="pt-2 text-xs text-muted-foreground">
            Preparing provider authentication...
          </p>
        )}

        {/* Options row */}
        <div className="flex items-center gap-0 pt-2">
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
                <DropdownMenuContent align="start" className="max-w-xs rounded-2xl p-1.5 bg-popover border-border">
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

          <Context
            maxTokens={getContextWindowSize(model)}
            usedTokens={accumulatedUsage.usedTokens}
            usage={accumulatedUsage.usage}
            modelId={model}
          >
            <ContextTrigger />
            <ContextContent>
              <ContextContentHeader />
              <ContextContentFooter />
            </ContextContent>
          </Context>

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

  return (
    <Message from={message.role}>
      <MessageContent>
        {message.parts.map((part, index) => {
          if (part.type === 'step-start') {
            return (
              <div key={`${message.id}-step-${index}`} className="py-2">
                <div className="h-px bg-border" />
              </div>
            )
          }

          if (part.type === 'text') {
            return (
              <MessageResponse key={`${message.id}-text-${index}`}>
                {part.text}
              </MessageResponse>
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

            // Skip present_plans tool - it's rendered as PlanSelector below messages
            if (toolName === 'present_plans') {
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
            const isStaticTool = toolName === 'read_file'

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
                  {/* For non-edit/non-list_dir/non-web_search tools, show raw input */}
                  {!isEditTool && !isWebSearchTool && toolName !== 'list_dir' && toolInput && (
                    <ToolInput input={formatToolPayload(toolInput)} />
                  )}
                  {toolPart.state === 'output-available' && (
                    toolName === 'todo_list'
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
