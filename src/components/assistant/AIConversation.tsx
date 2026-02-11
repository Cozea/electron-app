import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import {
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
  type UIMessage,
} from 'ai'
import { Button } from '@/components/ui/button'
import { Logo } from '@/components/Logo'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuGroup,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu'
import { cn } from '@/lib/utils'
import { AI_MODEL_SELECTOR_CONFIG } from '@/lib/ai/modelConfig'
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
import { useCollaborationActivityStore } from '@/stores/useCollaborationActivityStore'
import { ScreenshotAttachments } from '@/components/assistant/ScreenshotAttachment'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { validateInputAgainstSchema } from '@/components/assistant/toolSchemaValidation'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'
import { attachToolDiagnosticsToOutput, collectToolDiagnosticsSummary } from '@/lib/diagnostics/toolDiagnosticsPipeline'
import { MessageBubble, type MessageToolMeta } from '@/components/assistant/MessageBubble'
import { getContextWindowSize } from '@/components/assistant/ContextDisplay'
import { useConversationSync } from '@/components/assistant/useConversationSync'
import { DEFAULT_MODELS, type ModelOption } from '@/lib/ai/defaultModels'
import { AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import { usePersistedModelPreferences } from '@/lib/ai/usePersistedModelPreferences'
import { useAiGatewayCatalog } from '@/lib/ai/useAiGatewayCatalog'
import { useAiChatTransport } from '@/lib/ai/useAiChatTransport'
import { useAccumulatedUsage } from '@/lib/ai/useAccumulatedUsage'
import type { ToolCallPayload, ToolMetaShape } from '@/lib/ai/toolTypes'

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

type ToolMeta = ToolMetaShape

interface ToolPart {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: unknown
  output?: unknown
  errorText?: string
  approval?: { id?: string }
}

// Tool categories for context-based gating
const READ_ONLY_TOOLS = new Set([
  'read_file', 'list_dir', 'file_search', 'grep_search'
])

const WRITE_TOOLS = new Set([
  'create_file', 'create_directory', 'replace_string_in_file',
  'multi_replace_string_in_file', 'run_in_terminal', 'get_terminal_output', 'apply_patch'
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type ChatHookResult = ReturnType<typeof useChat>

// Model catalog per CrossCode Pricing Spec v3
// Tiers: Fast (1/2 credits), Standard (5/10 credits), Powerful (25/50 credits)
const defaultModels: ModelOption[] = DEFAULT_MODELS

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
    currentConversationId && projectSlug ? { id: currentConversationId } : "skip"
  )

  // Input State
  const [input, setInput] = useState("")
  const [model, setModel] = useState<string>('gemini-3-pro')
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const organizationId = currentOrganization?.organizationId
  const {
    selectedAgent,
    setSelectedAgent,
    selectedPerformance,
    setSelectedPerformance,
    thinkingEffort,
    setThinkingEffort,
  } = usePersistedModelPreferences({
    model,
    resolveDefaults: useCallback(() => ({
      selectedAgent: 'Agent',
      selectedPerformance: 'High',
      thinkingEffort: 'medium',
    }), []),
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
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [conversationId] = useState(() => crypto.randomUUID())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const addToolOutputRef = useRef<ChatHookResult['addToolOutput'] | null>(null)
  const addToolApprovalResponseRef = useRef<ChatHookResult['addToolApprovalResponse'] | null>(null)
  const cancelledToolCallsRef = useRef<Set<string>>(new Set())
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})
  const recordedApprovalIdsRef = useRef<Set<string>>(new Set())

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

  const messagesEndRef = useRef<HTMLDivElement>(null)
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
  }, [maxReasoningDepth, selectedPerformance, setSelectedPerformance])

  useEffect(() => {
    toolsByNameRef.current = Object.fromEntries(
      availableTools.map((tool) => [tool.name, tool])
    )
  }, [availableTools])

  // Fetch allowed models from AI Gateway
  const projectContext = useMemo(() => {
    if (!projectName || !projectSlug) return null

    return {
      name: projectName,
      slug: projectSlug,
      localPath: projectPath ?? undefined,
      currentPage: currentPage ?? undefined,
      inspectedElement: inspectedElement ?? undefined,
    }
  }, [projectName, projectSlug, projectPath, currentPage, inspectedElement])

  const chatTransport = useAiChatTransport({
    accessToken,
    organizationId,
    model,
    conversationId,
    feature: 'assistant',
    actionType: selectedAgent.toLowerCase(),
    reasoningDepth: selectedPerformance.toLowerCase() as 'low' | 'medium' | 'high',
    thinkingEffort,
    enableTools: true,
    enableWebSearch: true,
    extraBody: { projectContext },
  })

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

  const getToolFilePaths = useCallback((toolName: string, input: Record<string, unknown> | null | undefined): string[] => {
    if (!input) return []

    if (toolName === 'create_file' || toolName === 'replace_string_in_file' || toolName === 'read_file') {
      const filePath = input.filePath
      return typeof filePath === 'string' && filePath.trim() ? [filePath] : []
    }

    if (toolName === 'multi_replace_string_in_file') {
      const replacements = Array.isArray(input.replacements) ? input.replacements : []
      return replacements
        .filter(isRecord)
        .map((r) => r.filePath)
        .filter((p): p is string => typeof p === 'string' && p.trim().length > 0)
    }

    return []
  }, [])

  const enrichToolOutputWithDiagnostics = useCallback(async (
    toolName: string,
    input: Record<string, unknown>,
    output: unknown
  ) => {
    if (!projectPath || !WRITE_TOOLS.has(toolName)) return output
    const filePaths = getToolFilePaths(toolName, input)
    if (filePaths.length === 0) return output

    const summary = await collectToolDiagnosticsSummary({
      projectPath,
      filePaths,
    })

    return attachToolDiagnosticsToOutput(output, summary)
  }, [getToolFilePaths, projectPath])

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

  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: ToolCallPayload }) => {
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

    const normalizedInput = normalizeToolInput(toolCall.toolName, toolCall.input)

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

    const toolInput = isRecord(normalizedInput) ? normalizedInput : null
    if (!toolInput) {
      void addToolOutput({
        state: 'output-error',
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        errorText: 'Tool input must be an object.',
      })
      return
    }

    try {
      const toolFilePaths = getToolFilePaths(toolCall.toolName, toolInput)
      const run = () =>
        localRuntime.requestToolExecution(conversationId, {
          toolName: toolCall.toolName,
          input: toolInput,
          toolCallId: toolCall.toolCallId,
          projectPath: projectPath ?? undefined,
        })

      const result =
        toolFilePaths.length > 0 && WRITE_TOOLS.has(toolCall.toolName)
          ? await withFileLocks(toolFilePaths, run)
          : await run()

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
    onError: (err: unknown) => {
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

  const uniqueMessages = useMemo(() => {
    if (messages.length <= 1) return messages
    const seen = new Set<string>()
    return messages.filter((message) => {
      if (!message.id) return true
      if (seen.has(message.id)) return false
      seen.add(message.id)
      return true
    })
  }, [messages])

  const { markConversationInitialized } = useConversationSync({
    projectSlug,
    currentConversationId,
    project,
    storedConversation,
    setCurrentConversationId,
    setMessages,
    uniqueMessages,
    status,
    saveConversationMessages,
  })

  const hasPendingToolCalls = useMemo(() => {
    for (const message of uniqueMessages) {
      if (message.role !== 'assistant') continue
      if (!Array.isArray(message.parts)) continue

      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
          continue
        }

        const toolPart = part as ToolPart
        const state = toolPart.state || 'input-streaming'
        if (state === 'output-available' || state === 'output-error' || state === 'output-denied') {
          continue
        }

        return true
      }
    }

    return false
  }, [uniqueMessages])

  const cancelPendingToolOutputs = useCallback(() => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const pendingToolCalls = new Map<string, { toolName: string; toolCallId: string }>()

    for (const message of uniqueMessages) {
      if (message.role !== 'assistant') continue
      if (!Array.isArray(message.parts)) continue

      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
          continue
        }

        const toolPart = part as ToolPart
        const toolCallId = toolPart.toolCallId as string | undefined
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
  }, [uniqueMessages])

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

  const accumulatedUsage = useAccumulatedUsage(uniqueMessages)

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

  const runLocalTool = useCallback(async (toolName: string, toolCallId: string, input: unknown) => {
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

    const normalizedInput = normalizeToolInput(toolName, input)

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

    const toolInput = isRecord(normalizedInput) ? normalizedInput : null
    if (!toolInput) {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: 'Tool input must be an object.',
      })
      return
    }

    const toolFilePaths = getToolFilePaths(toolName, toolInput)
    const run = () =>
      localRuntime.requestToolExecution(conversationId, {
        toolName,
        input: toolInput,
        toolCallId,
        projectPath: projectPath ?? undefined,
      })
    const result =
      toolFilePaths.length > 0 && WRITE_TOOLS.has(toolName)
        ? await withFileLocks(toolFilePaths, run)
        : await run()

    if (cancelledToolCallsRef.current.has(toolCallId)) {
      return
    }

    if (result.success) {
      const enrichedOutput = await enrichToolOutputWithDiagnostics(
        toolName,
        toolInput,
        result.output
      )
      void addToolOutput({
        tool: toolName,
        toolCallId,
        output: enrichedOutput,
      })
    } else {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: result.error || 'Tool failed',
      })
    }
  }, [
    addToolOutput,
    conversationId,
    getToolFilePaths,
    enrichToolOutputWithDiagnostics,
    isToolAllowedInContext,
    localRuntime,
    projectPath,
    withFileLocks,
  ])

  const handleApprovedTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    input: unknown,
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

  const isLoading = status === 'streaming' || status === 'submitted' || hasPendingToolCalls
  const pingAiTyping = useCollaborationActivityStore(
    (state) => state.actions.pingAiTyping
  )
  const setAgentWorking = useCollaborationActivityStore(
    (state) => state.actions.setAgentWorking
  )

  useEffect(() => {
    setAgentWorking(isLoading)
    return () => {
      setAgentWorking(false)
    }
  }, [isLoading, setAgentWorking])

  // Clear chat when triggered from panel
  useEffect(() => {
    if (triggerClearChat > 0) {
      setMessages([])
      useAssistantPanelStore.getState().setChatTitle("New Chat")
    }
  }, [triggerClearChat, setMessages])

  // Update chat title based on first message
  useEffect(() => {
    if (uniqueMessages.length > 0) {
      const firstMessage = uniqueMessages[0]
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
  }, [uniqueMessages])

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    const target = messagesEndRef.current
    if (!target) return

    // During token streaming, avoid repeated smooth-scroll animations.
    const behavior: ScrollBehavior =
      status === 'streaming' || status === 'submitted' ? 'auto' : 'smooth'

    const frame = window.requestAnimationFrame(() => {
      target.scrollIntoView({ behavior, block: 'end' })
    })

    return () => window.cancelAnimationFrame(frame)
  }, [uniqueMessages, status])

  useEffect(() => {
    if (!currentOrganization?.organizationId || !accessToken) return

    const pendingApprovals: Array<{
      approvalId: string
      toolName: string
      toolInput: unknown
      messageId: string
    }> = []

    for (const message of uniqueMessages) {
      if (message.role !== 'assistant') continue

      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
          continue
        }

        const toolPart = part as ToolPart
        if (toolPart.state !== 'approval-requested') {
          continue
        }

        const approvalId = toolPart.approval?.id
        if (!approvalId || recordedApprovalIdsRef.current.has(approvalId)) {
          continue
        }

        recordedApprovalIdsRef.current.add(approvalId)
        const derivedToolName = part.type === 'dynamic-tool'
          ? toolPart.toolName
          : part.type.replace(/^tool-/, '')
        if (!derivedToolName) {
          continue
        }
        pendingApprovals.push({
          approvalId,
          toolName: derivedToolName,
          toolInput: toolPart.input,
          messageId: message.id,
        })
      }
    }

    if (!pendingApprovals.length) return

    for (const approval of pendingApprovals) {
      void recordToolApprovalRequest(approval)
    }
  }, [uniqueMessages, accessToken, currentOrganization?.organizationId, recordToolApprovalRequest])

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
        markConversationInitialized(newConversationId)
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
    cancelPendingToolOutputs()
    void localRuntime.cancelRun(conversationId)
    stop()
  }

  const resizeComposerTextarea = useCallback((target: HTMLTextAreaElement) => {
    target.style.height = 'auto'
    const maxHeight = Math.floor(window.innerHeight * 0.25)
    const nextHeight = Math.min(target.scrollHeight, maxHeight)
    target.style.height = `${nextHeight}px`
    target.style.overflowY = target.scrollHeight > maxHeight ? 'auto' : 'hidden'
  }, [])

  useEffect(() => {
    if (!composerTextareaRef.current) return
    resizeComposerTextarea(composerTextareaRef.current)
  }, [input, resizeComposerTextarea])

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
        <div className="assistant-scroll-fade-top absolute top-0 left-0 right-0 h-8 z-10 pointer-events-none" />
          {/* Bottom fade */}
        <div className="assistant-scroll-fade-bottom absolute bottom-0 left-0 right-0 h-8 z-10 pointer-events-none" />
        <Conversation className="h-full">
          <ConversationContent className={cn(uniqueMessages.length === 0 && "h-full p-0")}>
            {uniqueMessages.length === 0 ? (
              <div className="h-full flex flex-col items-center justify-center">
                <EmptyState />
              </div>
            ) : (
              uniqueMessages.map((message) => (
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
                <span className="text-sm">Generating...</span>
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
          "px-3 pb-3 shrink-0 mt-auto z-10 w-full max-w-2xl mx-auto",
          uniqueMessages.length === 0 ? "pt-1" : "pt-2"
        )}
        style={{ backgroundColor: 'var(--assistant-surface, var(--background))' }}
      >
        <div className="bg-muted/40 border border-border rounded-2xl">
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
              <textarea
                ref={composerTextareaRef}
                value={input}
                onChange={(e) => {
                  setInput(e.target.value)
                  if (e.target.value.length > 0) {
                    pingAiTyping()
                  }
                }}
                onKeyDown={handleKeyDown}
                placeholder="Ask anything"
                className="w-full rounded-none border-0 bg-transparent p-0 text-sm leading-6 text-foreground placeholder:text-muted-foreground shadow-none outline-none resize-none focus-visible:ring-0 focus-visible:ring-offset-0 min-h-6 max-h-[25vh]"
                rows={1}
                onInput={(e) => {
                  resizeComposerTextarea(e.currentTarget)
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
                <DropdownMenuContent
                  align="start"
                  className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
                >
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
