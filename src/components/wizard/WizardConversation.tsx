import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useNavigate } from 'react-router-dom'
import { useChat } from '@ai-sdk/react'
import {
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
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
import { AI_MODEL_SELECTOR_CONFIG } from '@/lib/ai/modelConfig'
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
import { Loader } from '@/components/ai-elements/loader'
import {
  Context,
  ContextTrigger,
  ContextContent,
  ContextContentHeader,
  ContextContentFooter,
} from '@/components/ai-elements/context'
import { PlanSelector, type PlanOption } from './PlanSelector'
import { WizardMessageBubble } from './WizardMessageBubble'
import { usePlanOptionsExtraction } from './usePlanOptionsExtraction'
import { BillingError, parseBillingError, type BillingErrorData } from '@/components/assistant/BillingError'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'
import { DEFAULT_MODELS, type ModelOption } from '@/lib/ai/defaultModels'
import { usePersistedModelPreferences } from '@/lib/ai/usePersistedModelPreferences'
import { useAiGatewayCatalog } from '@/lib/ai/useAiGatewayCatalog'
import { useAiChatTransport } from '@/lib/ai/useAiChatTransport'
import { useAccumulatedUsage } from '@/lib/ai/useAccumulatedUsage'
import type { ToolCallPayload, ToolMetaShape } from '@/lib/ai/toolTypes'

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

type ToolMeta = ToolMetaShape

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

type ChatHookResult = ReturnType<typeof useChat>

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

// Tools allowed during planning phase (read-only + display_plan)
const PLANNING_TOOLS = new Set([
  'read_file', 'list_dir', 'file_search', 'grep_search', 'present_plans'
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
  const organizationId = currentOrganization?.organizationId

  // State
  const [input, setInput] = useState('')
  const [model, setModel] = useState(promptSettings.model)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const {
    selectedAgent,
    setSelectedAgent,
    selectedPerformance,
    setSelectedPerformance,
    thinkingEffort,
    setThinkingEffort,
  } = usePersistedModelPreferences({
    model,
    resolveDefaults: useCallback((candidateModel: string) => {
      if (candidateModel === promptSettings.model) {
        return {
          selectedAgent: promptSettings.agentType === 'agent' ? 'Agent' : 'Assistant',
          selectedPerformance: (promptSettings.reasoningDepth.charAt(0).toUpperCase() + promptSettings.reasoningDepth.slice(1)) as 'High' | 'Medium' | 'Low',
          thinkingEffort: promptSettings.thinkingEffort ?? 'medium',
        }
      }

      return {
        selectedAgent: 'Agent',
        selectedPerformance: 'High',
        thinkingEffort: 'medium',
      }
    }, [promptSettings.agentType, promptSettings.model, promptSettings.reasoningDepth, promptSettings.thinkingEffort]),
  })
  const {
    availableModels,
    availableTools,
    toolPolicy,
    modelCapabilities,
    modelsError,
    toolsError,
  } = useAiGatewayCatalog<ToolMeta>({
    accessToken,
    organizationId,
    selectedModelId: model,
    initialModels: defaultModels,
    onModelFallback: setModel,
  })
  const [conversationId] = useState(() => crypto.randomUUID())
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const hasSentInitialMessageRef = useRef(false)

  const fileInputRef = useRef<HTMLInputElement>(null)
  const addToolOutputRef = useRef<ChatHookResult['addToolOutput'] | null>(null)
  const cancelledToolCallsRef = useRef<Set<string>>(new Set())
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})

  const selectedModelData = availableModels.find((m) => m.id === model)
  const allowCrossProviderSwitching = AI_MODEL_SELECTOR_CONFIG.allowCrossProviderSwitching
  const activeProvider = selectedModelData?.chefSlug
  const visibleChefs =
    allowCrossProviderSwitching || !selectedModelData
      ? ['Anthropic', 'OpenAI', 'Google']
      : [selectedModelData.chef]
  const visibleModels =
    allowCrossProviderSwitching || !activeProvider
      ? availableModels
      : availableModels.filter((m) => m.chefSlug === activeProvider)
  const visibleModelsByChef = useMemo(() => {
    const grouped = new Map<string, ModelOption[]>()
    for (const candidate of visibleModels) {
      const bucket = grouped.get(candidate.chef)
      if (bucket) {
        bucket.push(candidate)
      } else {
        grouped.set(candidate.chef, [candidate])
      }
    }
    return grouped
  }, [visibleModels])
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

  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const isAgentMode = selectedAgent.toLowerCase() === 'agent'

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
  }, [maxReasoningDepth, selectedPerformance, setSelectedPerformance])

  // Sync tools
  useEffect(() => {
    toolsByNameRef.current = Object.fromEntries(
      availableTools.map((tool) => [tool.name, tool])
    )
  }, [availableTools])
  const chatTransport = useAiChatTransport({
    accessToken,
    organizationId,
    model,
    conversationId,
    feature: 'project-wizard',
    actionType: selectedAgent.toLowerCase(),
    reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
    thinkingEffort,
    enableTools: true,
    enableWebSearch: true,
    extraBody: projectId ? { projectId } : undefined,
  })

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
  const planOptions = usePlanOptionsExtraction(messages)
  const accumulatedUsage = useAccumulatedUsage(messages)

  const isLoading = status === 'streaming' || status === 'submitted'

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault()
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
              <WizardMessageBubble
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
                        {(visibleModelsByChef.get(chef) ?? [])
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
              ? reasoningRange.filter((level): level is string => typeof level === 'string')
              : ['low', 'medium', 'high'] // Default for effort-based models
            const normalizedSupportedLevels = supportedLevels.length > 0
              ? supportedLevels
              : ['low', 'medium', 'high']

            // Ensure current selection is valid, otherwise use highest available
            const effectiveLevel = normalizedSupportedLevels.includes(thinkingEffort)
              ? thinkingEffort
              : normalizedSupportedLevels[normalizedSupportedLevels.length - 1] || 'high'

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
                    {[...normalizedSupportedLevels].reverse().map((level) => {
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
