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
  loadModelSettings,
  saveModelSettings,
} from '@/lib/modelSettingsStorage'
import {
  IconArrowUp,
  IconBolt,
  IconBrain,
  IconChevronDown,
  IconCircle,
  IconCircleDashed,
  IconPlus,
  IconPaperclip,
  IconProgress,
  IconRobot,
  IconSquare,
  IconUser,
  IconCheck,
  IconX,
} from '@tabler/icons-react'
import { useAuth } from '@/contexts/AuthContext'
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
import { PlanSelector, type PlanOption } from './PlanSelector'
import { BillingError, parseBillingError, type BillingErrorData } from '@/components/assistant/BillingError'

interface WizardConversationProps {
  projectId?: Id<"projects"> // Optional - project created when plan selected
  initialPrompt: string
  promptSettings: {
    model: string
    agentType: 'agent' | 'assistant'
    reasoningDepth: 'low' | 'medium' | 'high'
    thinkingEffort?: 'low' | 'medium' | 'high'
  }
  onPlanSelected: (plan: PlanOption) => void
  className?: string
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

// AI Gateway endpoint
const AI_API_URL = import.meta.env.VITE_AI_API_URL || 'http://localhost:3001/ai/chat'
const AI_BASE_URL = AI_API_URL.replace(/\/chat$/, '')

// Tools allowed during planning phase (read-only + display_plan)
const PLANNING_TOOLS = new Set([
  'read_file', 'list_dir', 'file_search', 'grep_search', 'present_plans'
])

// Model catalog (same as AIConversation)
const defaultModels = [
  { id: 'claude-haiku-4-5', name: 'Claude Haiku 4.5', chef: 'Anthropic', chefSlug: 'anthropic', tier: 'fast', providers: ['anthropic'] },
  { id: 'gemini-3-flash', name: 'Gemini 3 Flash', chef: 'Google', chefSlug: 'google', tier: 'fast', providers: ['google'] },
  { id: 'gpt-5.1', name: 'GPT-5.1', chef: 'OpenAI', chefSlug: 'openai', tier: 'standard', providers: ['openai'] },
  { id: 'gpt-5.1-mini', name: 'GPT-5.1 Mini', chef: 'OpenAI', chefSlug: 'openai', tier: 'standard', providers: ['openai'] },
  { id: 'claude-sonnet-4-5', name: 'Claude Sonnet 4.5', chef: 'Anthropic', chefSlug: 'anthropic', tier: 'standard', providers: ['anthropic'] },
  { id: 'gpt-5.2', name: 'GPT-5.2', chef: 'OpenAI', chefSlug: 'openai', tier: 'powerful', providers: ['openai'] },
  { id: 'claude-opus-4-5', name: 'Claude Opus 4.5', chef: 'Anthropic', chefSlug: 'anthropic', tier: 'powerful', providers: ['anthropic'] },
  { id: 'gemini-3-pro', name: 'Gemini 3 Pro', chef: 'Google', chefSlug: 'google', tier: 'powerful', providers: ['google'] },
]

export function WizardConversation({
  projectId,
  initialPrompt,
  promptSettings,
  onPlanSelected,
  className,
}: WizardConversationProps) {
  const navigate = useNavigate()
  const { accessToken, currentOrganization } = useAuth()

  // State
  const [input, setInput] = useState('')
  const [availableModels, setAvailableModels] = useState(defaultModels)
  const [model, setModel] = useState(promptSettings.model)
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [toolPolicy, setToolPolicy] = useState<{
    allowProviderTools: boolean
    allowWebSearch: boolean
    maxReasoningDepth: 'low' | 'medium' | 'high'
  } | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<'Agent' | 'Assistant'>(
    promptSettings.agentType === 'agent' ? 'Agent' : 'Assistant'
  )
  const [selectedPerformance, setSelectedPerformance] = useState<'High' | 'Medium' | 'Low'>(
    (promptSettings.reasoningDepth.charAt(0).toUpperCase() + promptSettings.reasoningDepth.slice(1)) as 'High' | 'Medium' | 'Low'
  )
  const [thinkingEffort, setThinkingEffort] = useState<'low' | 'medium' | 'high'>(
    promptSettings.thinkingEffort ?? 'medium'
  )
  const [modelSettings, setModelSettings] = useState<Record<string, { selectedAgent?: 'Agent' | 'Assistant'; selectedPerformance?: 'High' | 'Medium' | 'Low'; thinkingEffort?: 'low' | 'medium' | 'high' }>>(
    () => loadModelSettings()
  )
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, any>>({})
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [conversationId] = useState(() => crypto.randomUUID())
  const [planOptions, setPlanOptions] = useState<PlanOption[] | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const hasSentInitialMessageRef = useRef(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const addToolOutputRef = useRef<((args: any) => void | PromiseLike<void>) | null>(null)
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})

  const selectedModelData = availableModels.find((m) => m.id === model)
  const selectedModelCapabilities = useMemo(() => modelCapabilities[model] ?? null, [model, modelCapabilities])

  // Determine which controls to show based on model capabilities
  const showPerformanceControl = useMemo(() => {
    if (!selectedModelCapabilities) return true // Default to showing
    // Show for effort-based models (OpenAI) OR models with supportsEffortParameter (Opus 4.5)
    return selectedModelCapabilities.reasoningType === 'effort' ||
      selectedModelCapabilities.supportsEffortParameter === true
  }, [selectedModelCapabilities])

  const showThinkingControl = useMemo(() => {
    if (!selectedModelCapabilities) return false // Don't show by default
    return selectedModelCapabilities.supportsExtendedThinking === true
  }, [selectedModelCapabilities])

  const initialModelDefaults = useMemo(
    () => ({
      selectedAgent: promptSettings.agentType === 'agent' ? 'Agent' : 'Assistant',
      selectedPerformance:
        promptSettings.reasoningDepth.charAt(0).toUpperCase() +
        promptSettings.reasoningDepth.slice(1),
      thinkingEffort: promptSettings.thinkingEffort ?? 'medium',
    }),
    [promptSettings]
  )
  const fallbackDefaults = useMemo(
    () => ({
      selectedAgent: 'Agent' as const,
      selectedPerformance: 'High' as const,
      thinkingEffort: 'medium' as const,
    }),
    []
  )
  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const isAgentMode = selectedAgent.toLowerCase() === 'agent'

  const modelSettingsRef = useRef(modelSettings)
  useEffect(() => {
    modelSettingsRef.current = modelSettings
  }, [modelSettings])

  useEffect(() => {
    const stored = modelSettingsRef.current[model]
    const defaults = model === promptSettings.model ? initialModelDefaults : fallbackDefaults
    const next = stored ?? defaults
    setSelectedAgent(next.selectedAgent ?? 'Agent')
    setSelectedPerformance(next.selectedPerformance ?? 'High')
    setThinkingEffort(next.thinkingEffort ?? 'medium')
  }, [model, promptSettings.model, initialModelDefaults, fallbackDefaults])

  useEffect(() => {
    const nextSettings = {
      selectedAgent,
      selectedPerformance,
      thinkingEffort,
    }
    setModelSettings((prev) => {
      const updated = { ...prev, [model]: nextSettings }
      saveModelSettings(updated)
      return updated
    })
  }, [model, selectedAgent, selectedPerformance, thinkingEffort])

  const headers = useMemo((): Record<string, string> => {
    if (!accessToken) return {}
    return { Authorization: `Bearer ${accessToken}` }
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

  const maxReasoningDepth = toolPolicy?.maxReasoningDepth ?? 'medium'

  const performanceToDisplay: Record<string, string> = {
    'High': 'x3',
    'Medium': 'x2',
    'Low': 'x1',
  }

  // Clamp performance to max allowed
  useEffect(() => {
    const order = { low: 0, medium: 1, high: 2 }
    const current = selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high'
    if (order[current] > order[maxReasoningDepth]) {
      const capped = (maxReasoningDepth.charAt(0).toUpperCase() + maxReasoningDepth.slice(1)) as 'High' | 'Medium' | 'Low'
      setSelectedPerformance(capped)
    }
  }, [maxReasoningDepth, selectedPerformance])

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
        const caps: Record<string, any> = {}
        for (const m of data.models) {
          if (m.capabilities) caps[m.id] = m.capabilities
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
      .then((data) => {
        if (!data?.tools) return
        setAvailableTools(data.tools as ToolMeta[])
        setToolPolicy(data.policy ?? null)
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
    actionType: selectedAgent.toLowerCase(),
    reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
    thinkingEffort,
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: currentOrganization?.organizationId || null,
      projectId: projectId || null,
      model,
      conversationId,
      actionType: selectedAgent.toLowerCase(),
      reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
      thinkingEffort,
    }
  }, [accessToken, currentOrganization?.organizationId, projectId, model, conversationId, selectedAgent, selectedPerformance, thinkingEffort])

  // Chat transport (same pattern as AIConversation)
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
        // Only include projectId if it exists (project created when plan selected)
        ...(requestConfigRef.current.projectId && { projectId: requestConfigRef.current.projectId }),
        conversationId: requestConfigRef.current.conversationId,
        feature: 'project-wizard',
        actionType: requestConfigRef.current.actionType,
        enableTools: true, // Always enabled - gated client-side based on planning phase
        enableWebSearch: true, // Always enabled
        reasoningDepth: requestConfigRef.current.reasoningDepth,
        thinkingEffort: requestConfigRef.current.thinkingEffort,
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

  // Tool execution (same as AIConversation)
  const shouldRequireLocalApproval = useCallback((toolMeta?: ToolMeta) => {
    if (!toolMeta) return false
    if (toolMeta.executionEnvironment !== 'local') return false
    if (isAgentMode) return false
    return toolMeta.requiresApproval
  }, [isAgentMode])

  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: any }) => {
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const toolMeta = toolsByNameRef.current[toolCall.toolName]
    if (!toolMeta || toolMeta.executionEnvironment !== 'local') return
    if (shouldRequireLocalApproval(toolMeta)) return

    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    // Planning-phase gating: only allow read-only tools and present_plans
    if (!PLANNING_TOOLS.has(toolCall.toolName)) {
      void addToolOutput({
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        errorText: 'This tool is not available during planning. Only search and read tools are available.',
      })
      return
    }

    try {
      const result = await localRuntime.requestToolExecution(conversationId, {
        toolName: toolCall.toolName,
        input: toolCall.input,
        toolCallId: toolCall.toolCallId,
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
    onError: (err: any) => {
      console.error('Chat error:', err)
      const billingErr = parseBillingError(err)
      if (billingErr) {
        setBillingError(billingErr)
      }
    },
  })

  addToolOutputRef.current = addToolOutput

  const genericErrorMessage = useMemo(() => {
    if (!error) return null
    const message = (error as { message?: string }).message
    if (typeof message === 'string' && message.trim()) return message
    if (typeof error === 'string' && (error as string).trim()) return error as string
    return 'Something went wrong'
  }, [error])

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

  // Send initial message on mount (use ref to prevent duplicate sends)
  useEffect(() => {
    if (!hasSentInitialMessageRef.current && initialPrompt && accessToken) {
      hasSentInitialMessageRef.current = true
      void sendMessage({ text: initialPrompt })
    }
  }, [initialPrompt, accessToken, sendMessage])

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
  }

  // Track how many plans we've extracted (need exactly 3 for complete extraction)
  const extractedPlanCountRef = useRef(0)

  // Check for plan options in messages (from present_plans tool call)
  useEffect(() => {
    // Skip if we already have all 3 plans
    if (extractedPlanCountRef.current >= 3) return

    for (const message of messages) {
      if (message.role !== 'assistant') continue

      // Debug: Log all part types to understand the structure
      console.log('[Wizard] Message parts:', message.parts.map((p: any) => ({
        type: p.type,
        toolName: p.toolName,
        state: p.state,
        hasOutput: !!p.output,
        hasInput: !!p.input,
      })))

      for (const part of message.parts) {
        // Check for present_plans tool with output - handle various formats from different providers
        const partType = part.type as string
        const toolPart = part as any
        const isPresntPlans = partType === 'tool-present_plans' ||
          partType.includes('present_plans') ||
          toolPart.toolName === 'present_plans' ||
          (partType === 'tool-invocation' && toolPart.toolName === 'present_plans') ||
          (partType === 'tool-result' && toolPart.toolName === 'present_plans')

        if (isPresntPlans) {
          console.log('[Wizard] Found present_plans tool part:', {
            type: part.type,
            toolName: toolPart.toolName,
            state: toolPart.state,
            hasOutput: !!toolPart.output,
            hasResult: !!toolPart.result,
            hasInput: !!toolPart.input,
            hasArgs: !!toolPart.args,
            currentExtracted: extractedPlanCountRef.current,
            rawPart: JSON.stringify(toolPart).substring(0, 500),
          })

          // Get output from various possible fields (different providers use different formats)
          const rawOutput = toolPart.output || toolPart.result
          const rawInput = toolPart.input || toolPart.args

          // Check if we have output (complete tool result)
          if ((toolPart.state === 'output-available' || toolPart.state === 'result') && rawOutput) {
            try {
              const output = typeof rawOutput === 'string' ? JSON.parse(rawOutput) : rawOutput
              console.log('[Wizard] Parsed output plans:', output?.plans?.length || 0, 'plans')
              if (output?.plans && Array.isArray(output.plans)) {
                const validPlans = validatePlans(output.plans)
                console.log('[Wizard] Valid plans after validation:', validPlans.length)
                if (validPlans.length > extractedPlanCountRef.current) {
                  extractedPlanCountRef.current = validPlans.length
                  setPlanOptions(validPlans)
                  console.log('[Wizard] Updated planOptions with', validPlans.length, 'plans')
                  if (validPlans.length >= 3) return
                }
              }
            } catch (e) {
              console.warn('Failed to parse plan output:', e)
            }
          }
          // Also check input/args if output not yet available (streaming or Gemini format)
          else if (rawInput?.plans && Array.isArray(rawInput.plans)) {
            const validPlans = validatePlans(rawInput.plans)
            console.log('[Wizard] Input plans (streaming):', rawInput.plans.length, 'raw,', validPlans.length, 'valid')
            if (validPlans.length > extractedPlanCountRef.current) {
              extractedPlanCountRef.current = validPlans.length
              setPlanOptions(validPlans)
              console.log('[Wizard] Updated planOptions with', validPlans.length, 'plans (from input)')
              if (validPlans.length >= 3) return
            }
          }
          // Direct plans field check (some providers put it at top level)
          else if (toolPart.plans && Array.isArray(toolPart.plans)) {
            const validPlans = validatePlans(toolPart.plans)
            console.log('[Wizard] Direct plans field:', toolPart.plans.length, 'raw,', validPlans.length, 'valid')
            if (validPlans.length > extractedPlanCountRef.current) {
              extractedPlanCountRef.current = validPlans.length
              setPlanOptions(validPlans)
              console.log('[Wizard] Updated planOptions with', validPlans.length, 'plans (direct)')
              if (validPlans.length >= 3) return
            }
          }
        }
        // Legacy support for data-plan-options
        if (part.type === 'data-plan-options') {
          const data = (part as any).data
          if (data && Array.isArray(data)) {
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
          const data = (part as any).data as {
            promptTokens?: number
            completionTokens?: number
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
    if (!input.trim()) return
    await sendMessage({ text: input })
    setInput('')
  }

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault()
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
          <ConversationContent className="w-full max-w-none px-6 pt-8 pb-8">
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
                <span className="text-sm">Thinking...</span>
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
                className="w-full !bg-transparent p-0 border-0 shadow-none focus-visible:ring-0 focus-visible:ring-offset-0 text-foreground placeholder-muted-foreground resize-none border-none outline-none text-sm min-h-5 max-h-[25vh]"
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

        {/* Options row */}
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
            <DropdownMenuContent align="start" className="max-w-xs rounded-2xl p-1.5 bg-popover border-border">
              <DropdownMenuGroup className="space-y-1">
                <DropdownMenuItem className="rounded-[calc(1rem-6px)] text-xs" onClick={() => setSelectedAgent('Agent')}>
                  <IconUser size={16} className="opacity-60" />
                  Agent
                </DropdownMenuItem>
                <DropdownMenuItem className="rounded-[calc(1rem-6px)] text-xs" onClick={() => setSelectedAgent('Assistant')}>
                  <IconRobot size={16} className="opacity-60" />
                  Assistant
                </DropdownMenuItem>
              </DropdownMenuGroup>
            </DropdownMenuContent>
          </DropdownMenu>

          {/* Performance Control - Show for OpenAI and Opus 4.5 */}
          {showPerformanceControl && (
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
              <DropdownMenuContent align="start" className="max-w-xs rounded-2xl p-1.5 bg-popover border-border">
                <DropdownMenuGroup className="space-y-1">
                  <DropdownMenuItem
                    className="rounded-[calc(1rem-6px)] text-xs"
                    onClick={() => setSelectedPerformance('High')}
                    disabled={maxReasoningDepth !== 'high'}
                  >
                    <IconCircle size={16} className="opacity-60" />
                    High
                  </DropdownMenuItem>
                  <DropdownMenuItem
                    className="rounded-[calc(1rem-6px)] text-xs"
                    onClick={() => setSelectedPerformance('Medium')}
                    disabled={maxReasoningDepth === 'low'}
                  >
                    <IconProgress size={16} className="opacity-60" />
                    Medium
                  </DropdownMenuItem>
                  <DropdownMenuItem className="rounded-[calc(1rem-6px)] text-xs" onClick={() => setSelectedPerformance('Low')}>
                    <IconCircleDashed size={16} className="opacity-60" />
                    Low
                  </DropdownMenuItem>
                </DropdownMenuGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          )}

          {/* Thinking Effort - shows for models with extended thinking */}
          {showThinkingControl && (() => {
            // Get supported levels from model capabilities
            const reasoningRange = selectedModelCapabilities?.reasoningRange
            const supportedLevels: string[] = Array.isArray(reasoningRange)
              ? reasoningRange
              : ['low', 'medium', 'high'] // Default for effort-based models

            // Ensure current selection is valid, otherwise use highest available
            const effectiveLevel = supportedLevels.includes(thinkingEffort)
              ? thinkingEffort
              : supportedLevels[supportedLevels.length - 1] || 'high'

            const levelLabels: Record<string, { label: string; icon: typeof IconCircle }> = {
              minimal: { label: 'Minimal (fastest)', icon: IconCircleDashed },
              low: { label: 'Low (faster)', icon: IconCircleDashed },
              medium: { label: 'Medium (balanced)', icon: IconProgress },
              high: { label: 'High (deeper reasoning)', icon: IconCircle },
            }

            return (
              <DropdownMenu>
                <DropdownMenuTrigger asChild>
                  <Button
                    variant="ghost"
                    size="sm"
                    className="h-6 px-2 rounded-full border border-transparent hover:bg-accent text-muted-foreground text-xs"
                  >
                    <IconBrain className="size-3" />
                    <span>{effectiveLevel.charAt(0).toUpperCase() + effectiveLevel.slice(1)}</span>
                    <IconChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent align="start" className="max-w-xs rounded-2xl p-1.5 bg-popover border-border">
                  <DropdownMenuGroup className="space-y-1">
                    {/* Show levels in reverse order (high first) */}
                    {[...supportedLevels].reverse().map((level) => {
                      const { label, icon: Icon } = levelLabels[level] || { label: level, icon: IconCircle }
                      return (
                        <DropdownMenuItem
                          key={level}
                          className="rounded-[calc(1rem-6px)] text-xs"
                          onClick={() => setThinkingEffort(level as 'low' | 'medium' | 'high')}
                        >
                          <Icon size={16} className="opacity-60" />
                          {label}
                        </DropdownMenuItem>
                      )
                    })}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            )
          })()}

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
            const reasoningPart = part as any
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

          if (part.type === 'data-usage') {
            const usage = (part as any).data as {
              model?: string
              provider?: string
              creditsUsed?: number
              promptTokens?: number
              completionTokens?: number
              totalTokens?: number
            } | undefined

            if (!usage) return null

            const stats: string[] = []
            if (usage.creditsUsed !== undefined) {
              stats.push(`${usage.creditsUsed} credits`)
            }
            if (usage.totalTokens !== undefined) {
              stats.push(`${usage.totalTokens} tokens`)
            } else if (
              usage.promptTokens !== undefined &&
              usage.completionTokens !== undefined
            ) {
              stats.push(`${usage.promptTokens + usage.completionTokens} tokens`)
            }
            if (usage.model) {
              stats.push(usage.model)
            }

            if (stats.length === 0) return null

            return (
              <div
                key={`${message.id}-usage-${index}`}
                className="rounded-md bg-background/70 px-2 py-1 text-[11px] text-muted-foreground"
              >
                Usage: {stats.join(' · ')}
              </div>
            )
          }

          // Tool calls
          if (part.type.startsWith('tool-') || part.type === 'dynamic-tool') {
            const toolPart = part as any
            const toolName = part.type === 'dynamic-tool'
              ? toolPart.toolName
              : part.type.replace(/^tool-/, '')

            // Skip present_plans tool - it's rendered as PlanSelector below messages
            if (toolName === 'present_plans') {
              return null
            }

            const toolMeta = toolsByName.get(toolName)
            const toolState = toolPart.state || 'input-streaming'

            return (
              <Tool key={`${message.id}-tool-${index}`}>
                <ToolHeader
                  title={toolMeta?.displayName || toolName}
                  type={toolMeta?.toolType || 'function'}
                  state={toolState}
                />
                <ToolContent>
                  {toolPart.input && (
                    <ToolInput input={formatToolPayload(toolPart.input)} />
                  )}
                  {toolPart.state === 'output-available' && (
                    toolName === 'todo_list'
                      ? (() => {
                        const tasks = extractTasksFromToolOutput(toolPart.output)
                        if (tasks.length === 0) {
                          return <ToolOutput output={formatToolPayload(toolPart.output)} />
                        }
                        return <TaskProgress tasks={tasks} showSummary />
                      })()
                      : <ToolOutput output={formatToolPayload(toolPart.output)} />
                  )}
                  {toolPart.state === 'output-error' && (
                    <ToolOutput output={null} errorText={toolPart.errorText} />
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
  let payload = output as any
  if (typeof payload === 'string') {
    try {
      payload = JSON.parse(payload)
    } catch {
      return []
    }
  }

  const tasks = Array.isArray(payload?.tasks) ? payload.tasks : []
  return tasks
    .filter((task: any) => task && typeof task === 'object')
    .map((task: any) => ({
      id: String(task.id ?? crypto.randomUUID()),
      title: String(task.title ?? 'Untitled task'),
      status: (task.status ?? 'pending') as TaskData['status'],
      files: Array.isArray(task.files) ? task.files.map((f: any) => String(f)) : undefined,
      details: task.details ? String(task.details) : undefined,
    }))
}

function extractSourcesFromParts(parts: UIMessage['parts']) {
  const sources: Array<{ url: string; title: string; favicon?: string }> = []
  for (const part of parts) {
    if (part.type !== 'source-url') continue
    const sourcePart = part as any
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
