import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
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
  IconCheck,
  IconChevronDown,
  IconCircle,
  IconCircleDashed,
  IconHistory,
  IconPaperclip,
  IconPlus,
  IconProgress,
  IconRobot,
  IconSquare,
  IconUser,
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
import { usePageContextStore } from '@/stores/usePageContextStore'
import { useAuth } from '@/contexts/AuthContext'
import { ScreenshotAttachments } from '@/components/assistant/ScreenshotAttachment'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { validateInputAgainstSchema } from '@/components/assistant/toolSchemaValidation'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'
import { MessageBubble, type MessageToolMeta } from '@/components/assistant/MessageBubble'
import { getContextWindowSize } from '@/components/assistant/ContextDisplay'

// AI Elements components
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'

import { Loader } from '@/components/ai-elements/loader'
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentFooter,
} from '@/components/ai-elements/context'
import { BillingError, parseBillingError, type BillingErrorData } from './BillingError'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

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

// Tool categories for context-based gating
const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_dir', 'file_search', 'grep_search'
])

const WRITE_TOOLS = new Set([
  'create_file', 'create_directory', 'replace_string_in_file',
  'multi_replace_string_in_file', 'run_in_terminal', 'get_terminal_output', 'apply_patch'
])

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
  const {
    triggerClearChat,
    pendingPrompt,
    setPendingPrompt,
    pendingAttachments,
    removePendingAttachment,
    clearPendingAttachments,
    currentConversationId,
    setCurrentConversationId,
  } = useAssistantPanelStore()
  const currentPage = usePageContextStore((state) => state.currentPage)
  const inspectedElement = usePageContextStore((state) => state.inspectedElement)
  const { accessToken, currentOrganization, convexUserId } = useAuth()

  // Context-based tool availability
  const hasProjectContext = !!projectPath

  const project = useQuery(
    api.projects.getBySlug,
    currentOrganization?.convexOrgId && projectSlug
      ? {
          organizationId: currentOrganization.convexOrgId as Id<'organizations'>,
          slug: projectSlug,
        }
      : 'skip'
  )

  const acquireFileLock = useMutation(api.projectFileLocks.acquireLock)
  const releaseFileLock = useMutation(api.projectFileLocks.releaseLock)

  // Conversation persistence
  const createConversation = useMutation(api.aiConversations.create)
  const saveConversationMessages = useMutation(api.aiConversations.saveMessages)
  const storedConversation = useQuery(
    api.aiConversations.get,
    currentConversationId ? { id: currentConversationId } : "skip"
  )

  // Input State
  const [input, setInput] = useState("")
  const [availableModels, setAvailableModels] = useState(defaultModels)
  const [model, setModel] = useState<string>('gemini-3-pro')
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [toolPolicy, setToolPolicy] = useState<{
    allowProviderTools: boolean
    allowWebSearch: boolean
    maxReasoningDepth: 'low' | 'medium' | 'high'
  } | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState<"Agent" | "Assistant">("Agent")
  const [selectedPerformance, setSelectedPerformance] = useState<"High" | "Medium" | "Low">("High")
  const [thinkingEffort, setThinkingEffort] = useState<"low" | "medium" | "high">("medium")
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
  const conversationInitializedRef = useRef<string | null>(null)
  const isSavingRef = useRef(false)

  const selectedModelData = availableModels.find((m) => m.id === model)

  // Apply pending prompt injections (e.g. from screenshot capture or inspector actions)
  useEffect(() => {
    if (!pendingPrompt) return
    setInput((prev) => (prev ? `${prev}\n\n${pendingPrompt}` : pendingPrompt))
    setPendingPrompt(null)
  }, [pendingPrompt, setPendingPrompt])

  // Get capabilities for the selected model
  const selectedModelCapabilities = useMemo(() => {
    return modelCapabilities[model] ?? null
  }, [model, modelCapabilities])

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

  const modelSettingsRef = useRef(modelSettings)
  useEffect(() => {
    modelSettingsRef.current = modelSettings
  }, [modelSettings])

  useEffect(() => {
    const stored = modelSettingsRef.current[model]
    if (stored) {
      setSelectedAgent(stored.selectedAgent ?? "Agent")
      setSelectedPerformance(stored.selectedPerformance ?? "High")
      setThinkingEffort(stored.thinkingEffort ?? "medium")
      return
    }
    setSelectedAgent("Agent")
    setSelectedPerformance("High")
    setThinkingEffort("medium")
  }, [model])

  useEffect(() => {
    const nextSettings: StoredModelSettings = {
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
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        const message = err instanceof Error && err.message ? err.message : 'Failed to load tools'
        setToolsError(message)
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
    reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
    thinkingEffort,
    // Project context for AI awareness
    projectContext: projectName && projectSlug ? {
      name: projectName,
      slug: projectSlug,
      localPath: projectPath ?? undefined,
      // Current page context (invisible to user, sent to AI)
      currentPage: currentPage ?? undefined,
      // Last inspected element context (invisible to user, sent to AI)
      inspectedElement: inspectedElement ?? undefined,
    } : null,
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: currentOrganization?.organizationId || null,
      model,
      conversationId,
      actionType: selectedAgent.toLowerCase(),
      reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
      thinkingEffort,
      // Project context for AI awareness
      projectContext: projectName && projectSlug ? {
        name: projectName,
        slug: projectSlug,
        localPath: projectPath ?? undefined,
        // Current page context (invisible to user, sent to AI)
        currentPage: currentPage ?? undefined,
        // Last inspected element context (invisible to user, sent to AI)
        inspectedElement: inspectedElement ?? undefined,
      } : null,
    }
  }, [
    accessToken,
    currentOrganization?.organizationId,
    model,
    conversationId,
    selectedAgent,
    selectedPerformance,
    thinkingEffort,
    projectName,
    projectSlug,
    projectPath,
    currentPage,
    inspectedElement,
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
        // Always enable tools and web search - context-based gating happens client-side
        enableTools: true,
        enableWebSearch: true,
        reasoningDepth: requestConfigRef.current.reasoningDepth,
        thinkingEffort: requestConfigRef.current.thinkingEffort,
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

  const normalizeRelativeFilePath = useCallback((filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/')
    const projectRoot = projectPath?.replace(/\\/g, '/')
    if (projectRoot && normalized.startsWith(projectRoot)) {
      const rel = normalized.slice(projectRoot.length).replace(/^\/+/, '')
      return rel
    }
    return normalized.replace(/^\/+/, '')
  }, [projectPath])

  const getToolFilePaths = useCallback((toolName: string, input: any): string[] => {
    if (!input) return []

    if (toolName === 'create_file' || toolName === 'replace_string_in_file' || toolName === 'read_file') {
      const filePath = input.filePath
      return typeof filePath === 'string' && filePath.trim() ? [filePath] : []
    }

    if (toolName === 'multi_replace_string_in_file') {
      const replacements = Array.isArray(input.replacements) ? input.replacements : []
      return replacements
        .map((r: any) => r?.filePath)
        .filter((p: any): p is string => typeof p === 'string' && p.trim().length > 0)
    }

    return []
  }, [])

  const formatLockConflictError = useCallback((
    filePath: string,
    details: { lockedByName?: string | null; expiresAt?: number | null; status?: string | null }
  ) => {
    const parts: string[] = []
    parts.push(`File is locked: ${filePath}`)
    if (details.status) parts.push(`status=${details.status}`)
    if (details.lockedByName) parts.push(`by ${details.lockedByName}`)
    if (details.expiresAt) {
      parts.push(`until ${new Date(details.expiresAt).toLocaleTimeString()}`)
    }
    parts.push('Wait, then re-read the file and retry your edit.')
    return parts.join(' ')
  }, [])

  const withFileLocks = useCallback(async <T,>(
    filePaths: string[],
    fn: () => Promise<T>
  ): Promise<T> => {
    if (!project?._id) {
      throw new Error('Cannot acquire file lock: project not loaded')
    }
    if (!convexUserId) {
      throw new Error('Cannot acquire file lock: not authenticated')
    }

    const uniquePaths = Array.from(
      new Set(filePaths.map(normalizeRelativeFilePath).filter(Boolean))
    ).sort()

    const acquired: string[] = []
    try {
      for (const filePath of uniquePaths) {
        const result = await acquireFileLock({
          projectId: project._id,
          filePath,
          userId: convexUserId,
        })
        if (!result.acquired) {
          throw new Error(
            formatLockConflictError(filePath, {
              lockedByName: result.lockedByName,
              expiresAt: result.expiresAt,
              status: result.status,
            })
          )
        }
        acquired.push(filePath)
      }

      return await fn()
    } finally {
      await Promise.allSettled(
        acquired.map((filePath) =>
          releaseFileLock({ projectId: project._id, filePath, userId: convexUserId })
        )
      )
    }
  }, [
    acquireFileLock,
    convexUserId,
    formatLockConflictError,
    normalizeRelativeFilePath,
    project?._id,
    releaseFileLock,
  ])

  // Check if a tool is allowed in the current context
  const isToolAllowedInContext = useCallback((toolName: string) => {
    // If we have project context, all tools are allowed
    if (hasProjectContext) return true
    // Without project context, only read-only tools are allowed
    return READ_ONLY_TOOLS.has(toolName) || !WRITE_TOOLS.has(toolName)
  }, [hasProjectContext])

  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: any }) => {
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const toolMeta = toolsByNameRef.current[toolCall.toolName]
    if (!toolMeta || toolMeta.executionEnvironment !== 'local') {
      return
    }

    // Context-based gating: block write tools when not in project context
    if (!isToolAllowedInContext(toolCall.toolName)) {
      const addToolOutput = addToolOutputRef.current
      if (addToolOutput) {
        void addToolOutput({
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: 'This tool requires a project context. Please open a project first.',
        })
      }
      return
    }

    if (shouldRequireLocalApproval(toolMeta)) {
      return
    }

    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const normalizedInput = normalizeToolInput(toolCall.toolName, toolCall.input) as any

    const validation = validateInputAgainstSchema(toolMeta.inputSchema, normalizedInput)
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
      const toolFilePaths = getToolFilePaths(toolCall.toolName, normalizedInput)
      const run = () =>
        localRuntime.requestToolExecution(conversationId, {
          toolName: toolCall.toolName,
          input: normalizedInput,
          toolCallId: toolCall.toolCallId,
          projectPath: projectPath ?? undefined,
        })

      const result =
        toolFilePaths.length > 0 && WRITE_TOOLS.has(toolCall.toolName)
          ? await withFileLocks(toolFilePaths, run)
          : await run()

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
  }, [
    conversationId,
    getToolFilePaths,
    isToolAllowedInContext,
    localRuntime,
    projectPath,
    shouldRequireLocalApproval,
    withFileLocks,
  ])

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

  // Load stored messages when conversation changes
  useEffect(() => {
    if (!storedConversation) return
    if (conversationInitializedRef.current === currentConversationId) return

    // Convert stored messages to UIMessage format
    const uiMessages: UIMessage[] = storedConversation.messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: [{ type: 'text' as const, text: msg.content }],
      createdAt: new Date(msg.createdAt),
    }))

    setMessages(uiMessages)
    conversationInitializedRef.current = currentConversationId

    // Update chat title
    if (storedConversation.title) {
      useAssistantPanelStore.getState().setChatTitle(storedConversation.title)
    }
  }, [storedConversation, currentConversationId, setMessages])

  // Reset initialization ref when conversation changes to null
  useEffect(() => {
    if (currentConversationId === null) {
      conversationInitializedRef.current = null
    }
  }, [currentConversationId])

  // Save messages to Convex when they change (debounced)
  useEffect(() => {
    if (!currentConversationId) return
    if (messages.length === 0) return
    if (isSavingRef.current) return
    if (status === 'streaming' || status === 'submitted') return

    const saveMessages = async () => {
      isSavingRef.current = true
      try {
        // Convert UIMessages to storage format
        const storedMessages = messages.map((msg) => {
          const textParts = msg.parts.filter((p) => p.type === 'text')
          const content = textParts.map((p) => (p as { text: string }).text).join('')

          return {
            id: msg.id,
            role: msg.role as 'user' | 'assistant' | 'system',
            content,
            createdAt: msg.createdAt?.getTime() ?? Date.now(),
          }
        })

        // Generate title from first user message
        const firstUserMessage = storedMessages.find((m) => m.role === 'user')
        const title = firstUserMessage
          ? firstUserMessage.content.slice(0, 50) + (firstUserMessage.content.length > 50 ? '...' : '')
          : 'New Conversation'

        await saveConversationMessages({
          conversationId: currentConversationId,
          messages: storedMessages,
          title,
        })
      } catch (err) {
        console.warn('Failed to save conversation messages:', err)
      } finally {
        isSavingRef.current = false
      }
    }

    // Debounce saves
    const timeoutId = setTimeout(saveMessages, 500)
    return () => clearTimeout(timeoutId)
  }, [messages, currentConversationId, status, saveConversationMessages])

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
    // Context-based gating
    if (!isToolAllowedInContext(toolName)) {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: 'This tool requires a project context. Please open a project first.',
      })
      return
    }

    const normalizedInput = normalizeToolInput(toolName, input) as any

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
      const validation = validateInputAgainstSchema(toolMeta.inputSchema, normalizedInput)
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
      input: normalizedInput,
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
  }, [addToolOutput, isToolAllowedInContext, localRuntime, conversationId, projectPath])

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
    if (!input.trim() && pendingAttachments.length === 0) return;

    // Clear any previous billing error when trying again
    setBillingError(null)

    // Create conversation on first message if we don't have one
    if (!currentConversationId && project?._id && convexUserId) {
      try {
        const newConversationId = await createConversation({
          projectId: project._id,
          userId: convexUserId,
          title: input.slice(0, 50) + (input.length > 50 ? '...' : '') || 'New Conversation',
        })
        setCurrentConversationId(newConversationId)
        conversationInitializedRef.current = newConversationId
      } catch (err) {
        console.warn('Failed to create conversation:', err)
      }
    }

    // Build message with optional attachments
    const messageOptions: { text: string; experimental_attachments?: Array<{ url: string; contentType: string }> } = {
      text: input || 'Analyze this screenshot',
    }

    // Include attachments if any
    if (pendingAttachments.length > 0) {
      messageOptions.experimental_attachments = pendingAttachments.map((attachment) => ({
        url: attachment.data,
        contentType: 'image/png',
      }))
    }

    // Clear input immediately before sending (don't wait for response)
    setInput("")
    clearPendingAttachments()

    // Send message (don't await - let it stream in the background)
    void sendMessage(messageOptions)
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
                <EmptyState />
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
          {billingError ? (
            <BillingError
              error={billingError}
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
            onChange={(e) => {
              // Handle file selection
              console.log(e.target.files)
            }}
          />

          {/* Pending screenshot attachments */}
          <ScreenshotAttachments
            attachments={pendingAttachments}
            onRemove={removePendingAttachment}
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
                disabled={!input.trim() && pendingAttachments.length === 0 && !isLoading}
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
                <DropdownMenuContent
                  align="start"
                  className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
                >
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

          <div className="flex-1" />

          {/* Context window usage display - right aligned */}
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
        </div>
      </div>
    </div>
  )
}

function EmptyState() {
  return (
    <div className="flex flex-col h-full w-full">
      <div className="flex-1 flex flex-col items-center justify-center py-12 text-center gap-6">
        <Logo size={32} className="mb-4" />
        <h3 className="text-lg font-medium mb-2">AI Assistant</h3>
        <p className="text-sm text-muted-foreground max-w-[250px]">
          Ask questions, get help with code, or explore ideas together.
        </p>
      </div>
    </div>
  )
}

function getMessageText(message: UIMessage): string {
  return message.parts
    .filter((part) => part.type === 'text')
    .map((part) => part.text)
    .join('')
}
