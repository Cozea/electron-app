import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai'
import { Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import {
  loadModelSettings,
  saveModelSettings,
  type StoredModelSettings,
} from '@/lib/modelSettingsStorage'
import {
  IconArrowUp,
  IconBolt,
  IconBrain,
  IconChevronDown,
  IconCircle,
  IconCircleDashed,
  IconCode,
  IconHistory,
  IconPaperclip,
  IconPlus,
  IconProgress,
  IconRobot,
  IconSquare,
  IconUser,
  IconWorld,
  IconCheck,
  IconX,
} from '@tabler/icons-react'
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
import { useAssistantPanelStore } from '@/stores/useAssistantPanelStore'
import { useAuth } from '@/contexts/AuthContext'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { validateInputAgainstSchema } from '@/components/assistant/toolSchemaValidation'
import { ProviderOptions, type ProviderOptionsState } from './ProviderOptions'
import { MessageBubble, type MessageToolMeta } from '@/components/assistant/MessageBubble'

// AI Elements components
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion'
import { Loader } from '@/components/ai-elements/loader'
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentFooter,
} from '@/components/ai-elements/context'
import { BillingError, parseBillingError, type BillingErrorData } from './BillingError'

interface AIConversationProps {
  className?: string
  projectPath?: string | null
  projectName?: string | null
  projectSlug?: string | null
}

interface ToolMeta {
  name: string
  displayName: string
  description: string
  inputSchema: Record<string, unknown>
  requiresApproval: boolean
  riskLevel: 'safe' | 'moderate' | 'dangerous'
  executionEnvironment: 'local' | 'server' | 'provider'
  provider?: 'anthropic' | 'openai' | 'google'
  toolType?: 'function' | 'provider' | 'dynamic'
  providerToolId?: string
  providerToolArgs?: Record<string, unknown>
  supportsDeferredResults?: boolean
}

// AI Gateway endpoint - Railway server
const AI_API_URL = import.meta.env.VITE_AI_API_URL || 'http://localhost:3001/ai/chat'
const AI_BASE_URL = AI_API_URL.replace(/\/chat$/, '')

// Model catalog per CrossCode Pricing Spec v3
// Tiers: Fast (1/2 credits), Standard (5/10 credits), Powerful (25/50 credits)
const defaultModels = [
  // ============================================
  // FAST TIER - 1 input / 2 output credits per 1K tokens
  // ============================================
  {
    id: 'claude-haiku-4-5',
    name: 'Claude Haiku 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'fast',
    providers: ['anthropic'],
  },
  {
    id: 'gemini-3-flash',
    name: 'Gemini 3 Flash',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'fast',
    providers: ['google'],
  },
  // ============================================
  // STANDARD TIER - 5 input / 10 output credits per 1K tokens
  // ============================================
  {
    id: 'gpt-5.1',
    name: 'GPT-5.1',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'standard',
    providers: ['openai'],
  },
  {
    id: 'gpt-5.1-mini',
    name: 'GPT-5.1 Mini',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'standard',
    providers: ['openai'],
  },
  {
    id: 'claude-sonnet-4-5',
    name: 'Claude Sonnet 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'standard',
    providers: ['anthropic'],
  },
  // ============================================
  // POWERFUL TIER - 25 input / 50 output credits per 1K tokens
  // ============================================
  {
    id: 'gpt-5.2',
    name: 'GPT-5.2',
    chef: 'OpenAI',
    chefSlug: 'openai',
    tier: 'powerful',
    providers: ['openai'],
  },
  {
    id: 'claude-opus-4-5',
    name: 'Claude Opus 4.5',
    chef: 'Anthropic',
    chefSlug: 'anthropic',
    tier: 'powerful',
    providers: ['anthropic'],
  },
  {
    id: 'gemini-3-pro',
    name: 'Gemini 3 Pro',
    chef: 'Google',
    chefSlug: 'google',
    tier: 'powerful',
    providers: ['google'],
  },
]

export function AIConversation({ className, projectPath, projectName, projectSlug }: AIConversationProps) {
  const navigate = useNavigate()
  const { triggerClearChat } = useAssistantPanelStore()
  const { accessToken, currentOrganization } = useAuth()

  // Input State
  const [input, setInput] = useState("")
  const [availableModels, setAvailableModels] = useState(defaultModels)
  const [model, setModel] = useState<string>(defaultModels[0].id)
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [toolsLoaded, setToolsLoaded] = useState(false)
  const [toolPolicy, setToolPolicy] = useState<{
    allowProviderTools: boolean
    allowWebSearch: boolean
    maxReasoningDepth: 'low' | 'medium' | 'high'
  } | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<"Agent" | "Assistant">("Agent")
  const [selectedPerformance, setSelectedPerformance] = useState<"High" | "Medium" | "Low">("High")
  const [toolsEnabled, setToolsEnabled] = useState(true)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [providerOptions, setProviderOptions] = useState<ProviderOptionsState>({})
  const [modelSettings, setModelSettings] = useState<Record<string, StoredModelSettings>>(
    () => loadModelSettings()
  )
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, any>>({})
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [conversationId] = useState(() => crypto.randomUUID())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const addToolOutputRef = useRef<((args: any) => void | PromiseLike<void>) | null>(null)
  const addToolApprovalResponseRef = useRef<((args: any) => void | PromiseLike<void>) | null>(null)
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})
  const recordedApprovalIdsRef = useRef<Set<string>>(new Set())

  const selectedModelData = availableModels.find((m) => m.id === model)
  const selectedProvider = selectedModelData?.chefSlug

  // Get capabilities for the selected model
  const selectedModelCapabilities = useMemo(() => {
    return modelCapabilities[model] ?? null
  }, [model, modelCapabilities])

  const modelSettingsRef = useRef(modelSettings)
  useEffect(() => {
    modelSettingsRef.current = modelSettings
  }, [modelSettings])

  useEffect(() => {
    const stored = modelSettingsRef.current[model]
    if (stored) {
      setSelectedAgent(stored.selectedAgent ?? "Agent")
      setSelectedPerformance(stored.selectedPerformance ?? "High")
      setToolsEnabled(stored.toolsEnabled ?? true)
      setWebSearchEnabled(stored.webSearchEnabled ?? false)
      setProviderOptions(stored.providerOptions ?? {})
      return
    }
    setSelectedAgent("Agent")
    setSelectedPerformance("High")
    setToolsEnabled(true)
    setWebSearchEnabled(false)
    setProviderOptions({})
  }, [model])

  useEffect(() => {
    const nextSettings: StoredModelSettings = {
      selectedAgent,
      selectedPerformance,
      toolsEnabled,
      webSearchEnabled,
      providerOptions,
    }
    setModelSettings((prev) => {
      const updated = { ...prev, [model]: nextSettings }
      saveModelSettings(updated)
      return updated
    })
  }, [model, selectedAgent, selectedPerformance, toolsEnabled, webSearchEnabled, providerOptions])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const isAgentMode = selectedAgent.toLowerCase() === 'agent'

  // Memoize headers to avoid re-creating on every render
  const headers = useMemo((): Record<string, string> => {
    if (!accessToken) return {}
    return {
      Authorization: `Bearer ${accessToken}`,
    }
  }, [accessToken])

  useEffect(() => {
    if (accessToken && currentOrganization?.organizationId) return
    setModelsError(null)
    setToolsError(null)
  }, [accessToken, currentOrganization?.organizationId])

  const toolsByName = useMemo(() => {
    const map = new Map<string, ToolMeta>()
    for (const tool of availableTools) {
      map.set(tool.name, tool)
    }
    return map
  }, [availableTools])

  const canUseWebSearch = useMemo(() => {
    if (!toolPolicy?.allowProviderTools || !toolPolicy.allowWebSearch) return false
    return Boolean(selectedModelCapabilities?.supportsWebSearch)
  }, [toolPolicy, selectedModelCapabilities])

  const canUseLocalTools = useMemo(() => {
    return availableTools.some((tool) => tool.executionEnvironment === 'local')
  }, [availableTools])

  const maxReasoningDepth = toolPolicy?.maxReasoningDepth ?? 'medium'

  // Map performance labels for display and server
  const performanceToDisplay: Record<string, string> = {
    'High': 'x3',
    'Medium': 'x2',
    'Low': 'x1',
  }

  useEffect(() => {
    const order = { low: 0, medium: 1, high: 2 }
    const current = selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high'
    if (order[current] > order[maxReasoningDepth]) {
      const capitalized = maxReasoningDepth.charAt(0).toUpperCase() + maxReasoningDepth.slice(1) as "High" | "Medium" | "Low"
      setSelectedPerformance(capitalized)
    }
  }, [maxReasoningDepth, selectedPerformance])

  useEffect(() => {
    toolsByNameRef.current = Object.fromEntries(
      availableTools.map((tool) => [tool.name, tool])
    )
  }, [availableTools])

  useEffect(() => {
    if (!canUseWebSearch && webSearchEnabled) {
      setWebSearchEnabled(false)
    }
  }, [canUseWebSearch, webSearchEnabled])

  useEffect(() => {
    // Only disable tools after we've loaded the tools list
    // This prevents the race condition where tools are disabled before the API returns
    if (toolsLoaded && !canUseLocalTools && toolsEnabled) {
      setToolsEnabled(false)
    }
  }, [toolsLoaded, canUseLocalTools, toolsEnabled])


  // Fetch allowed models from AI Gateway
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
      .then((data) => {
        if (!data?.models) return
        const mapped = data.models.map((m: any) => ({
          id: m.id,
          name: m.displayName,
          chef: m.provider === 'openai' ? 'OpenAI' : m.provider === 'anthropic' ? 'Anthropic' : 'Google',
          chefSlug: m.provider,
          tier: m.tier,
          providers: [m.provider],
        }))
        // Store capabilities by model ID
        const caps: Record<string, any> = {}
        for (const m of data.models) {
          if (m.capabilities) {
            caps[m.id] = m.capabilities
          }
        }
        setModelCapabilities(caps)
        setModelsError(null)
        if (mapped.length > 0) {
          setAvailableModels(mapped)
          if (!mapped.some((item: any) => item.id === model)) {
            setModel(mapped[0].id)
          }
        }
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        const message = err instanceof Error && err.message ? err.message : 'Failed to load models'
        setModelsError(message)
        console.warn('Failed to fetch models:', err)
      })

    return () => controller.abort()
  }, [accessToken, currentOrganization?.organizationId, headers, model])

  // Fetch enabled tools from AI Gateway
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
      .then((data) => {
        if (!data?.tools) return
        setAvailableTools(data.tools as ToolMeta[])
        setToolPolicy(data.policy ?? null)
        setToolsError(null)
        setToolsLoaded(true)
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        const message = err instanceof Error && err.message ? err.message : 'Failed to load tools'
        setToolsError(message)
        setToolsLoaded(true)
        console.warn('Failed to fetch tools:', err)
      })

    return () => controller.abort()
  }, [accessToken, currentOrganization?.organizationId, headers])

  const requestConfigRef = useRef({
    accessToken,
    organizationId: currentOrganization?.organizationId || null,
    model,
    conversationId,
    actionType: selectedAgent.toLowerCase(),
    toolsEnabled,
    webSearchEnabled,
    reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
    providerOptions,
    // Project context for AI awareness
    projectContext: projectName && projectSlug ? {
      name: projectName,
      slug: projectSlug,
      localPath: projectPath ?? undefined,
    } : null,
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: currentOrganization?.organizationId || null,
      model,
      conversationId,
      actionType: selectedAgent.toLowerCase(),
      toolsEnabled,
      webSearchEnabled,
      reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
      providerOptions,
      // Project context for AI awareness
      projectContext: projectName && projectSlug ? {
        name: projectName,
        slug: projectSlug,
        localPath: projectPath ?? undefined,
      } : null,
    }
  }, [
    accessToken,
    currentOrganization?.organizationId,
    model,
    conversationId,
    selectedAgent,
    selectedPerformance,
    toolsEnabled,
    webSearchEnabled,
    providerOptions,
    projectName,
    projectSlug,
    projectPath,
  ])

  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: AI_API_URL,
      headers: (): Record<string, string> => {
        const token = requestConfigRef.current.accessToken
        return token ? { Authorization: `Bearer ${token}` } : {}
      },
      body: () => ({
        model: requestConfigRef.current.model,
        organizationId: requestConfigRef.current.organizationId,
        conversationId: requestConfigRef.current.conversationId,
        feature: 'assistant',
        actionType: requestConfigRef.current.actionType,
        enableTools: requestConfigRef.current.toolsEnabled,
        enableWebSearch: requestConfigRef.current.webSearchEnabled,
        reasoningDepth: requestConfigRef.current.reasoningDepth,
        // Provider-specific options
        providerOptions: requestConfigRef.current.providerOptions,
        // Project context for AI awareness
        projectContext: requestConfigRef.current.projectContext,
      }),
      prepareSendMessagesRequest: ({ messages, body, messageId }) => {
        const actionType = requestConfigRef.current.actionType
        const api = actionType === 'agent' ? `${AI_BASE_URL}/agent` : `${AI_BASE_URL}/chat`
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

  const shouldRequireLocalApproval = useCallback((toolMeta?: MessageToolMeta) => {
    if (!toolMeta) return false
    if (toolMeta.executionEnvironment !== 'local') return false
    if (isAgentMode) return false
    return toolMeta.requiresApproval ?? false
  }, [isAgentMode])

  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: any }) => {
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const toolMeta = toolsByNameRef.current[toolCall.toolName]
    if (!toolMeta || toolMeta.executionEnvironment !== 'local') {
      return
    }

    if (shouldRequireLocalApproval(toolMeta)) {
      return
    }

    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const validation = validateInputAgainstSchema(toolMeta.inputSchema, toolCall.input)
    if (!validation.valid) {
      void addToolOutput({
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        errorText: validation.error,
      })
      return
    }

    try {
      const result = await localRuntime.requestToolExecution(conversationId, {
        toolName: toolCall.toolName,
        input: toolCall.input,
        toolCallId: toolCall.toolCallId,
        projectPath: projectPath ?? undefined,
      })

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
      void addToolOutput({
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        errorText: err instanceof Error ? err.message : 'Tool failed',
      })
    }
  }, [shouldRequireLocalApproval, localRuntime, conversationId, projectPath])

  // Chat hook with auth transport
  const {
    messages,
    status,
    error,
    sendMessage,
    stop,
    setMessages,
    addToolOutput,
    addToolApprovalResponse,
  } = useChat({
    transport: chatTransport,
    sendAutomaticallyWhen: ({ messages }) =>
      lastAssistantMessageIsCompleteWithToolCalls({ messages }) ||
      lastAssistantMessageIsCompleteWithApprovalResponses({ messages }),
    onToolCall: handleToolCall,
    onError: (err: any) => {
      console.error('Chat error:', err)
      // Try to parse as billing error for nice display
      const billingErr = parseBillingError(err)
      if (billingErr) {
        setBillingError(billingErr)
      }
    },
  })

  addToolOutputRef.current = addToolOutput
  addToolApprovalResponseRef.current = addToolApprovalResponse

  const genericErrorMessage = useMemo(() => {
    if (!error || billingError) return null
    const message = (error as { message?: string }).message
    if (typeof message === 'string' && message.trim()) return message
    const errorStr = error as unknown
    if (typeof errorStr === 'string' && errorStr.trim()) return errorStr
    return 'Something went wrong'
  }, [error, billingError])

  const serviceErrorMessage = modelsError || toolsError
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

  // Compute accumulated token usage from all messages
  // This follows the official AI SDK pattern of reading custom data-* parts from the stream
  const accumulatedUsage = useMemo(() => {
    let inputTokens = 0
    let outputTokens = 0
    let reasoningTokens = 0
    let cachedInputTokens = 0

    for (const message of messages) {
      for (const part of message.parts) {
        if (part.type === 'data-usage') {
          const data = (part as any).data as {
            promptTokens?: number
            completionTokens?: number
            totalTokens?: number
            reasoningTokens?: number
            cachedInputTokens?: number
          } | undefined
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
      // LanguageModelUsage format for the Context component
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

  const recordToolApprovalRequest = useCallback(async (params: {
    approvalId: string
    toolName: string
    toolInput: unknown
    messageId: string
  }) => {
    if (!accessToken || !currentOrganization?.organizationId) return

    try {
      await fetch(`${AI_BASE_URL}/tools/request`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          organizationId: currentOrganization.organizationId,
          toolName: params.toolName,
          toolInput: params.toolInput,
          approvalId: params.approvalId,
          conversationId,
          messageId: params.messageId,
        }),
      })
    } catch (err) {
      console.warn('Failed to record tool approval request:', err)
    }
  }, [accessToken, currentOrganization?.organizationId, conversationId])

  const persistToolApproval = useCallback(async (
    approvalId: string,
    approved: boolean,
    rejectionReason?: string
  ) => {
    if (!accessToken) return

    try {
      await fetch(`${AI_BASE_URL}/tools/approve`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          approvalId,
          approved,
          rejectionReason,
        }),
      })
    } catch (err) {
      console.warn('Failed to persist tool approval:', err)
    }
  }, [accessToken])

  const runLocalTool = useCallback(async (toolName: string, toolCallId: string, input: any) => {
    const toolMeta = toolsByNameRef.current[toolName]
    if (toolMeta && toolMeta.executionEnvironment !== 'local') {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: 'Tool is not available locally',
      })
      return
    }

    if (toolMeta?.inputSchema) {
      const validation = validateInputAgainstSchema(toolMeta.inputSchema, input)
      if (!validation.valid) {
        void addToolOutput({
          state: 'output-error',
          tool: toolName,
          toolCallId,
          errorText: validation.error,
        })
        return
      }
    }

    const result = await localRuntime.requestToolExecution(conversationId, {
      toolName,
      input,
      toolCallId,
      projectPath: projectPath ?? undefined,
    })
    if (result.success) {
      void addToolOutput({
        tool: toolName,
        toolCallId,
        output: result.output,
      })
    } else {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: result.error || 'Tool failed',
      })
    }
  }, [addToolOutput, localRuntime, conversationId, projectPath])

  const handleApprovedTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    input: any,
    approvalId?: string
  ) => {
    try {
      const toolMeta = toolsByNameRef.current[toolName]
      const isLocal = !toolMeta || toolMeta.executionEnvironment === 'local'

      if (approvalId && addToolApprovalResponseRef.current && !isLocal) {
        await addToolApprovalResponseRef.current({ id: approvalId, approved: true })
        void persistToolApproval(approvalId, true)
      }

      if (isLocal) {
        await runLocalTool(toolName, toolCallId, input)
      }
    } catch (err) {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: err instanceof Error ? err.message : 'Tool failed',
      })
    }
  }, [addToolOutput, persistToolApproval, runLocalTool])

  const handleDeniedTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    approvalId?: string
  ) => {
    const toolMeta = toolsByNameRef.current[toolName]
    const isLocal = !toolMeta || toolMeta.executionEnvironment === 'local'

    if (approvalId && addToolApprovalResponseRef.current && !isLocal) {
      await addToolApprovalResponseRef.current({ id: approvalId, approved: false })
      void persistToolApproval(approvalId, false)
      return
    }

    void addToolOutput({
      state: 'output-error',
      tool: toolName,
      toolCallId,
      errorText: 'User denied tool execution',
    })
  }, [addToolOutput, persistToolApproval])

  const isLoading = status === 'streaming' || status === 'submitted'

  // Clear chat when triggered from panel
  useEffect(() => {
    if (triggerClearChat > 0) {
      setMessages([])
      useAssistantPanelStore.getState().setChatTitle("New Chat")
    }
  }, [triggerClearChat, setMessages])

  // Update chat title based on first message
  useEffect(() => {
    if (messages.length > 0) {
      const firstMessage = messages[0]
      if (firstMessage.role === 'user') {
        const text = getMessageText(firstMessage)
        if (text) {
          const title = text.slice(0, 30) + (text.length > 30 ? '...' : '')
          useAssistantPanelStore.getState().setChatTitle(title)
        }
      }
    } else {
      useAssistantPanelStore.getState().setChatTitle("New Chat")
    }
  }, [messages])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [messages])

  useEffect(() => {
    if (!currentOrganization?.organizationId || !accessToken) return

    const pendingApprovals: Array<{
      approvalId: string
      toolName: string
      toolInput: unknown
      messageId: string
    }> = []

    for (const message of messages) {
      if (message.role !== 'assistant') continue

      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
          continue
        }

        const toolPart = part as any
        if (toolPart.state !== 'approval-requested') {
          continue
        }

        const approvalId = toolPart.approval?.id
        if (!approvalId || recordedApprovalIdsRef.current.has(approvalId)) {
          continue
        }

        recordedApprovalIdsRef.current.add(approvalId)
        pendingApprovals.push({
          approvalId,
          toolName: part.type === 'dynamic-tool'
            ? toolPart.toolName
            : part.type.replace(/^tool-/, ''),
          toolInput: toolPart.input,
          messageId: message.id,
        })
      }
    }

    if (!pendingApprovals.length) return

    for (const approval of pendingApprovals) {
      void recordToolApprovalRequest(approval)
    }
  }, [messages, accessToken, currentOrganization?.organizationId, recordToolApprovalRequest])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!input.trim()) return;

    // Clear any previous billing error when trying again
    setBillingError(null)
    await sendMessage({ text: input })
    setInput("")
  };

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault()
    stop()
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      {/* Messages Area */}
      <div className="flex-1 min-h-0 relative">
        {/* Top fade */}
        <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />
        <Conversation className="h-full">
          <ConversationContent className={cn(messages.length === 0 && "h-full p-0")}>
            {messages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center">
                <EmptyState onSuggestionClick={(text) => {
                  setInput(text)
                }} />
              </div>
            ) : (
              messages.map((message) => (
                <MessageBubble
                  key={message.id}
                  message={message}
                  toolsByName={toolsByName}
                  status={status}
                  shouldRequireLocalApproval={shouldRequireLocalApproval}
                  onApproveTool={handleApprovedTool}
                  onDenyTool={handleDeniedTool}
                />
              ))
            )}
            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground">
                <Loader className="h-4 w-4" />
                <span className="text-sm">Thinking...</span>
              </div>
            )}
            {billingError && (
              <BillingError
                error={billingError}
                onAction={(href) => {
                  setBillingError(null)
                  navigate(href)
                }}
                className="max-w-md mx-auto"
              />
            )}
            <div ref={messagesEndRef} />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Input Area - Compact AI Prompt */}
      <div
        className={cn(
          "px-3 pb-3 shrink-0 mt-auto bg-background z-10 w-full max-w-2xl mx-auto",
          messages.length === 0 ? "pt-1" : "pt-2"
        )}
      >
        <div className="bg-muted/40 border border-border rounded-2xl overflow-hidden">
          {showGenericError && surfaceErrorMessage && (
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
            onChange={(e) => {
              // Handle file selection
              console.log(e.target.files)
            }}
          />

          <div className="px-3 pt-3 pb-2 grow">
            <form onSubmit={handleSubmit}>
              <Textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything"
                className="w-full bg-transparent! p-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder-muted-foreground resize-none border-none outline-none text-sm min-h-5 max-h-[25vh]"
                rows={1}
                onInput={(e) => {
                  const target = e.target as HTMLTextAreaElement;
                  target.style.height = "auto";
                  target.style.height = target.scrollHeight + "px";
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

                <DropdownMenuContent
                  align="start"
                  className="max-w-xs rounded-2xl p-1.5"
                >
                  <DropdownMenuGroup className="space-y-1">
                    <DropdownMenuItem
                      className="rounded-[calc(1rem-6px)] text-xs"
                      onClick={() => fileInputRef.current?.click()}
                    >
                      <IconPaperclip size={16} className="opacity-60" />
                      Attach Files
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="rounded-[calc(1rem-6px)] text-xs"
                      onClick={() => setToolsEnabled((prev) => !prev)}
                      disabled={!canUseLocalTools}
                    >
                      <IconCode size={16} className="opacity-60" />
                      <span className="flex-1">Tool Access</span>
                      {toolsEnabled && <IconCheck className="size-3 opacity-60" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="rounded-[calc(1rem-6px)] text-xs"
                      onClick={() => setWebSearchEnabled((prev) => !prev)}
                      disabled={!canUseWebSearch}
                    >
                      <IconWorld size={16} className="opacity-60" />
                      <span className="flex-1">Web Search</span>
                      {webSearchEnabled && <IconCheck className="size-3 opacity-60" />}
                    </DropdownMenuItem>
                    <DropdownMenuItem
                      className="rounded-[calc(1rem-6px)] text-xs"
                      onClick={() => { }}
                    >
                      <IconHistory size={16} className="opacity-60" />
                      Chat History
                    </DropdownMenuItem>
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>

              <ModelSelector
                onOpenChange={setModelSelectorOpen}
                open={modelSelectorOpen}
              >
                <ModelSelectorTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-7 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
                  >
                    {selectedModelData?.chefSlug && (
                      <ModelSelectorLogo
                        provider={selectedModelData.chefSlug}
                      />
                    )}
                    {selectedModelData?.name && (
                      <ModelSelectorName className="ml-1">
                        {selectedModelData.name}
                      </ModelSelectorName>
                    )}
                    <IconChevronDown className="size-3 ml-1" />
                  </Button>
                </ModelSelectorTrigger>
                <ModelSelectorContent>
                  <ModelSelectorInput placeholder="Search models..." />
                  <ModelSelectorList>
                    <ModelSelectorEmpty>No models found.</ModelSelectorEmpty>
                    {['Anthropic', 'OpenAI', 'Google'].map((chef) => (
                      <ModelSelectorGroup heading={chef} key={chef}>
                        {availableModels
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
                                  <ModelSelectorLogo
                                    key={provider}
                                    provider={provider}
                                  />
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

            <div>
              <Button
                type="submit"
                disabled={!input.trim() && !isLoading}
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
        </div>

        <div className="flex items-center gap-0 pt-2">


          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
              >
                <IconUser className="size-3" />
                <span>{selectedAgent}</span>
                <IconChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
            >
              <DropdownMenuGroup className="space-y-1">
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedAgent("Agent")}
                >
                  <IconUser size={16} className="opacity-60" />
                  Agent
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedAgent("Assistant")}
                >
                  <IconRobot size={16} className="opacity-60" />
                  Assistant
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                variant="ghost"
                size="sm"
                className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
              >
                <IconBolt className="size-3" />
                <span>{performanceToDisplay[selectedPerformance]}</span>
                <IconChevronDown className="size-3" />
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent
              align="start"
              className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
            >
              <DropdownMenuGroup className="space-y-1">
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedPerformance("High")}
                  disabled={maxReasoningDepth !== 'high'}
                >
                  <IconCircle size={16} className="opacity-60" />
                  High
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedPerformance("Medium")}
                  disabled={maxReasoningDepth === 'low'}
                >
                  <IconProgress size={16} className="opacity-60" />
                  Medium
                </DropdownMenuItem>
                <DropdownMenuItem
                  className="rounded-[calc(1rem-6px)] text-xs"
                  onClick={() => setSelectedPerformance("Low")}
                >
                  <IconCircleDashed size={16} className="opacity-60" />
                  Low
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Opus 4.5 Thinking Effort - only shows for Opus */}
          {selectedModelCapabilities?.supportsEffortParameter && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  variant="ghost"
                  size="sm"
                  className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
                >
                  <IconBrain className="size-3" />
                  <span>{providerOptions.thinkingEffort ? providerOptions.thinkingEffort.charAt(0).toUpperCase() + providerOptions.thinkingEffort.slice(1) : 'Medium'}</span>
                  <IconChevronDown className="size-3" />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="start"
                className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
              >
                <DropdownMenuGroup className="space-y-1">
                  <DropdownMenuItem
                    className="rounded-[calc(1rem-6px)] text-xs"
                    onClick={() => setProviderOptions({ ...providerOptions, thinkingEffort: 'high' })}
                  >
                    <IconCircle size={16} className="opacity-60" />
                    High (deeper reasoning)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-[calc(1rem-6px)] text-xs"
                    onClick={() => setProviderOptions({ ...providerOptions, thinkingEffort: 'medium' })}
                  >
                    <IconProgress size={16} className="opacity-60" />
                    Medium (balanced)
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-[calc(1rem-6px)] text-xs"
                    onClick={() => setProviderOptions({ ...providerOptions, thinkingEffort: 'low' })}
                  >
                    <IconCircleDashed size={16} className="opacity-60" />
                    Low (faster, fewer tokens)
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Provider-specific tool options */}
          {selectedProvider && selectedModelCapabilities && (
            <ProviderOptions
              provider={selectedProvider as 'anthropic' | 'openai' | 'google'}
              capabilities={selectedModelCapabilities}
              options={providerOptions}
              onChange={setProviderOptions}
              disabled={status === 'streaming'}
            />
          )}

          <div className="flex-1" />

          {/* Context window usage display - right aligned */}
          <Context
            maxTokens={200_000}
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
        </div>
      </div>
    </div>
  )
}

interface EmptyStateProps {
  onSuggestionClick?: (text: string) => void
}

function EmptyState({ onSuggestionClick }: EmptyStateProps) {
  const suggestions = [
    "Help me understand this codebase",
    "Find and fix bugs in my code",
    "Explain how authentication works",
    "Write tests for the API routes",
  ]

  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 flex flex-col items-center justify-center py-12 text-center gap-6">
        <div className="rounded-full bg-primary/10 p-4 mb-4 mx-auto w-fit">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-lg font-medium mb-2">AI Assistant</h3>
        <p className="text-sm text-muted-foreground max-w-[250px]">
          Ask questions, get help with code, or explore ideas together.
        </p>
      </div>
      {onSuggestionClick && (
        <div className="w-full max-w-2xl mx-auto px-3 pb-1">
          <Suggestions>
            {suggestions.map((text) => (
              <Suggestion
                key={text}
                suggestion={text}
                onClick={() => onSuggestionClick(text)}
              />
            ))}
          </Suggestions>
        </div>
      )}
    </div>
  )
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}
