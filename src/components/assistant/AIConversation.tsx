import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
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
import { ProviderOptions, type ProviderOptionsState } from './ProviderOptions'

// AI Elements components
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
import { Suggestions, Suggestion } from '@/components/ai-elements/suggestion'
import { Sources, SourcesTrigger, SourcesContent, Source } from '@/components/ai-elements/sources'
import { Loader } from '@/components/ai-elements/loader'
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentFooter,
} from '@/components/ai-elements/context'
import { ConfirmationDialog, type ConfirmationState } from '@/components/ai-elements/confirmation'

interface AIConversationProps {
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

export function AIConversation({ className }: AIConversationProps) {
  const { triggerClearChat } = useAssistantPanelStore()
  const { accessToken, currentOrganization } = useAuth()

  // Input State
  const [input, setInput] = useState("")
  const [availableModels, setAvailableModels] = useState(defaultModels)
  const [model, setModel] = useState<string>(defaultModels[0].id)
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [toolPolicy, setToolPolicy] = useState<{
    allowProviderTools: boolean
    allowWebSearch: boolean
    maxReasoningDepth: 'low' | 'medium' | 'high'
  } | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [selectedAgent, setSelectedAgent] = useState("Agent")
  const [selectedPerformance, setSelectedPerformance] = useState("High")
  const [toolsEnabled, setToolsEnabled] = useState(true)
  const [webSearchEnabled, setWebSearchEnabled] = useState(false)
  const [providerOptions, setProviderOptions] = useState<ProviderOptionsState>({})
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, any>>({})
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

  // Track previous provider to reset options when switching
  const prevProviderRef = useRef(selectedProvider)
  useEffect(() => {
    if (prevProviderRef.current !== selectedProvider) {
      setProviderOptions({}) // Reset on provider change
      prevProviderRef.current = selectedProvider
    }
  }, [selectedProvider])

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])

  // Memoize headers to avoid re-creating on every render
  const headers = useMemo((): Record<string, string> => {
    if (!accessToken) return {}
    return {
      Authorization: `Bearer ${accessToken}`,
    }
  }, [accessToken])

  const toolsByName = useMemo(() => {
    const map = new Map<string, ToolMeta>()
    for (const tool of availableTools) {
      map.set(tool.name, tool)
    }
    return map
  }, [availableTools])

  const canUseWebSearch = useMemo(() => {
    return availableTools.some((tool) =>
      tool.executionEnvironment === 'provider' &&
      (!tool.provider || tool.provider === selectedProvider)
    )
  }, [availableTools, selectedProvider])

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
      setSelectedPerformance(
        maxReasoningDepth.charAt(0).toUpperCase() + maxReasoningDepth.slice(1)
      )
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
    if (!canUseLocalTools && toolsEnabled) {
      setToolsEnabled(false)
    }
  }, [canUseLocalTools, toolsEnabled])

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
        if (mapped.length > 0) {
          setAvailableModels(mapped)
          if (!mapped.some((item: any) => item.id === model)) {
            setModel(mapped[0].id)
          }
        }
      })
      .catch((err) => {
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
          throw new Error('Failed to load tools')
        }
        return res.json()
      })
      .then((data) => {
        if (!data?.tools) return
        setAvailableTools(data.tools as ToolMeta[])
        setToolPolicy(data.policy ?? null)
      })
      .catch((err) => {
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
      }),
      prepareSendMessagesRequest: ({ body, messageId }) => {
        const actionType = requestConfigRef.current.actionType
        const api = actionType === 'agent' ? `${AI_BASE_URL}/agent` : `${AI_BASE_URL}/chat`
        const requestBody = body ?? {}
        const nextBody = messageId ? { ...requestBody, requestId: messageId } : requestBody
        return { api, body: nextBody }
      },
    })
  }, [])

  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: any }) => {
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const toolMeta = toolsByNameRef.current[toolCall.toolName]
    if (!toolMeta || toolMeta.executionEnvironment !== 'local') {
      return
    }

    if (toolMeta.requiresApproval) {
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
  }, [])

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
    },
  })

  addToolOutputRef.current = addToolOutput
  addToolApprovalResponseRef.current = addToolApprovalResponse

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
      await addToolOutput({
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
        await addToolOutput({
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
    })
    if (result.success) {
      await addToolOutput({
        tool: toolName,
        toolCallId,
        output: result.output,
      })
    } else {
      await addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: result.error || 'Tool failed',
      })
    }
  }, [addToolOutput, localRuntime, conversationId])

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
      await addToolOutput({
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

    await addToolOutput({
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
            {error && (
              <div className="text-sm text-destructive bg-destructive/10 p-3 rounded-lg">
                Error: {error.message || 'Something went wrong'}
              </div>
            )}
            <div ref={messagesEndRef} />
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>

      {/* Input Area - Compact AI Prompt */}
      <div className="px-3 pb-3 shrink-0 pt-2 mt-auto bg-background z-10 w-full max-w-2xl mx-auto">
        <div className="bg-muted/40 border border-border rounded-2xl overflow-hidden">
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

          {/* Context window usage display */}
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

          <div className="flex-1" />
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
    <div className="flex flex-col items-center justify-center h-full py-12 text-center gap-6">
      <div>
        <div className="rounded-full bg-primary/10 p-4 mb-4 mx-auto w-fit">
          <Sparkles className="h-8 w-8 text-primary" />
        </div>
        <h3 className="text-lg font-medium mb-2">AI Assistant</h3>
        <p className="text-sm text-muted-foreground max-w-[250px]">
          Ask questions, get help with code, or explore ideas together.
        </p>
      </div>
      {onSuggestionClick && (
        <Suggestions>
          {suggestions.map((text) => (
            <Suggestion
              key={text}
              suggestion={text}
              onClick={() => onSuggestionClick(text)}
            />
          ))}
        </Suggestions>
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

function formatToolPayload(value: unknown): string {
  if (typeof value === 'string') return value
  try {
    const serialized = JSON.stringify(value, null, 2)
    return serialized ?? String(value)
  } catch {
    return String(value)
  }
}

interface ExtractedSource {
  url: string
  title: string
  favicon?: string
}

function extractSourcesFromToolOutput(output: unknown, toolName: string): ExtractedSource[] {
  // Only extract sources from web search related tools
  const isWebSearchTool = toolName.toLowerCase().includes('search') ||
    toolName.toLowerCase().includes('web') ||
    toolName === 'tavily_search' ||
    toolName === 'brave_search' ||
    toolName === 'bing_search'

  if (!isWebSearchTool) return []

  const sources: ExtractedSource[] = []

  try {
    // Handle different output formats
    if (typeof output === 'string') {
      // Try to parse JSON string
      try {
        const parsed = JSON.parse(output)
        return extractSourcesFromToolOutput(parsed, toolName)
      } catch {
        // Extract URLs from plain text
        const urlRegex = /https?:\/\/[^\s<>"{}|\\^`[\]]+/g
        const urls = output.match(urlRegex) || []
        urls.forEach((url) => {
          try {
            const urlObj = new URL(url)
            sources.push({
              url,
              title: urlObj.hostname,
            })
          } catch {
            // Invalid URL, skip
          }
        })
      }
    } else if (Array.isArray(output)) {
      // Handle array of results (common format)
      output.forEach((item: any) => {
        if (item?.url) {
          sources.push({
            url: item.url,
            title: item.title || item.name || new URL(item.url).hostname,
            favicon: item.favicon || item.icon,
          })
        } else if (item?.link) {
          sources.push({
            url: item.link,
            title: item.title || item.name || new URL(item.link).hostname,
            favicon: item.favicon || item.icon,
          })
        }
      })
    } else if (typeof output === 'object' && output !== null) {
      // Handle object with results array
      const obj = output as Record<string, any>
      if (obj.results && Array.isArray(obj.results)) {
        return extractSourcesFromToolOutput(obj.results, toolName)
      }
      if (obj.sources && Array.isArray(obj.sources)) {
        return extractSourcesFromToolOutput(obj.sources, toolName)
      }
      if (obj.organic && Array.isArray(obj.organic)) {
        return extractSourcesFromToolOutput(obj.organic, toolName)
      }
      // Single result object
      if (obj.url) {
        sources.push({
          url: obj.url,
          title: obj.title || obj.name || new URL(obj.url).hostname,
          favicon: obj.favicon || obj.icon,
        })
      }
    }
  } catch {
    // Failed to extract sources, return empty array
  }

  // Deduplicate by URL
  const seen = new Set<string>()
  return sources.filter((source) => {
    if (seen.has(source.url)) return false
    seen.add(source.url)
    return true
  })
}

type ToolValidationResult = { valid: true } | { valid: false; error: string }

function validateInputAgainstSchema(schema: Record<string, any>, value: unknown): ToolValidationResult {
  if (!schema || typeof schema !== 'object') {
    return { valid: true }
  }

  const validation = validateSchemaNode(schema, value, 'input')
  return validation.valid ? { valid: true } : validation
}

function validateSchemaNode(
  schema: Record<string, any>,
  value: unknown,
  path: string
): ToolValidationResult {
  const alternates = Array.isArray(schema.anyOf)
    ? schema.anyOf
    : Array.isArray(schema.oneOf)
      ? schema.oneOf
      : null

  if (alternates) {
    for (const option of alternates) {
      const result = validateSchemaNode(option, value, path)
      if (result.valid) {
        return result
      }
    }
    return { valid: false, error: `${path} does not match any allowed schema` }
  }

  const expectedTypes = Array.isArray(schema.type)
    ? schema.type
    : schema.type
      ? [schema.type]
      : []

  if (expectedTypes.length > 0 && !expectedTypes.some((type) => matchesSchemaType(type, value))) {
    return { valid: false, error: `${path} should be ${expectedTypes.join(' or ')}` }
  }

  if (schema.type === 'object' || (!schema.type && schema.properties)) {
    if (!isPlainObject(value)) {
      return { valid: false, error: `${path} should be an object` }
    }

    const required = Array.isArray(schema.required) ? schema.required : []
    for (const key of required) {
      if ((value as Record<string, unknown>)[key] === undefined) {
        return { valid: false, error: `${path}.${key} is required` }
      }
    }

    const properties = schema.properties || {}
    for (const [key, propSchema] of Object.entries(properties)) {
      const propValue = (value as Record<string, unknown>)[key]
      if (propValue !== undefined && propSchema) {
        const propResult = validateSchemaNode(propSchema as Record<string, any>, propValue, `${path}.${key}`)
        if (!propResult.valid) {
          return propResult
        }
      }
    }
  }

  if (schema.type === 'array') {
    if (!Array.isArray(value)) {
      return { valid: false, error: `${path} should be an array` }
    }

    if (typeof schema.minItems === 'number' && value.length < schema.minItems) {
      return { valid: false, error: `${path} must contain at least ${schema.minItems} items` }
    }

    if (schema.items) {
      for (let index = 0; index < value.length; index += 1) {
        const itemResult = validateSchemaNode(schema.items as Record<string, any>, value[index], `${path}[${index}]`)
        if (!itemResult.valid) {
          return itemResult
        }
      }
    }
  }

  return { valid: true }
}

function matchesSchemaType(type: string, value: unknown): boolean {
  switch (type) {
    case 'string':
      return typeof value === 'string'
    case 'number':
      return typeof value === 'number' && !Number.isNaN(value)
    case 'integer':
      return typeof value === 'number' && Number.isInteger(value)
    case 'boolean':
      return typeof value === 'boolean'
    case 'array':
      return Array.isArray(value)
    case 'object':
      return isPlainObject(value)
    default:
      return true
  }
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function MessageBubble({
  message,
  toolsByName,
  status,
  onApproveTool,
  onDenyTool,
}: {
  message: UIMessage
  toolsByName: Map<string, ToolMeta>
  status: 'ready' | 'submitted' | 'streaming' | 'error'
  onApproveTool: (toolName: string, toolCallId: string, input: any, approvalId?: string) => void
  onDenyTool: (toolName: string, toolCallId: string, approvalId?: string) => void
}) {
  const isStreaming = status === 'streaming'

  return (
    <Message from={message.role}>
      <MessageContent>
            {message.parts.map((part, index) => {
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

              if (part.type === 'dynamic-tool' || part.type.startsWith('tool-')) {
                const toolPart = part as any
                const toolName = part.type === 'dynamic-tool'
                  ? toolPart.toolName
                  : part.type.replace(/^tool-/, '')
                const toolMeta = toolsByName.get(toolName)
                const requiresApproval = toolMeta?.requiresApproval ?? true

                // Map internal state to ToolState type expected by AI Elements
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

                      {requiresApproval && (
                        <ConfirmationDialog
                          state={
                            (toolPart.state === 'input-available' || toolPart.state === 'approval-requested')
                              ? 'pending'
                              : toolPart.state === 'output-denied'
                                ? 'rejected'
                                : toolPart.state === 'output-available'
                                  ? 'approved'
                                  : 'pending' as ConfirmationState
                          }
                          toolName={toolMeta?.displayName || toolName}
                          toolCallId={toolPart.toolCallId}
                          description="This tool requires your approval to execute."
                          onApprove={() => onApproveTool(toolName, toolPart.toolCallId, toolPart.input, toolPart.approval?.id)}
                          onReject={() => onDenyTool(toolName, toolPart.toolCallId, toolPart.approval?.id)}
                        />
                      )}

                      {toolPart.state === 'output-available' && (
                        <>
                          <ToolOutput output={formatToolPayload(toolPart.output)} />
                          {(() => {
                            const sources = extractSourcesFromToolOutput(toolPart.output, toolName)
                            if (sources.length === 0) return null
                            return (
                              <div className="px-4 pb-4">
                                <Sources>
                                  <SourcesTrigger count={sources.length} />
                                  <SourcesContent>
                                    {sources.map((source, idx) => (
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
                            )
                          })()}
                        </>
                      )}

                      {toolPart.state === 'output-error' && (
                        <ToolOutput output={null} errorText={toolPart.errorText} />
                      )}

                      {toolPart.state === 'output-denied' && (
                        <ToolOutput output={null} errorText="Tool execution denied" />
                      )}
                    </ToolContent>
                  </Tool>
                )
              }

              return null
            })}
        </MessageContent>
    </Message>
  )
}
