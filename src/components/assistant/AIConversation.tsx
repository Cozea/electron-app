import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useCozeaChat } from '@/hooks/useCozeaChat'
import {
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
import {
  loadGlobalModelSettings,
  loadModelSettings,
  readStoredModelSettings,
  saveModelSettings,
  type StoredModelSettings,
  updateGlobalModelSettings,
  writeStoredModelSettings,
} from '@/lib/modelSettingsStorage'
import { AI_MODEL_SELECTOR_CONFIG } from '@/lib/ai/modelConfig'
import {
  AGENT_PROFILES,
  DEFAULT_AGENT_BY_SURFACE,
  VARIANT_DEFINITIONS,
  getAvailableAgentsForSurface,
  isLocalToolAllowedForAgent,
  getSupportedVariantsForModel,
  normalizeAgentForSurface,
  normalizeVariantForModel,
  type AgentId,
  type RuntimeModelCapabilities,
  type RuntimeProvider,
} from '@/lib/ai/runtimeProfiles'
import {
  IconArrowUp,
  IconCheck,
  IconChevronDown,
  IconPlus,
  IconSquare,
  IconX,
} from '@tabler/icons-react'
import { AlertTriangle, Brain, MousePointer2, Terminal } from 'lucide-react'
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
import {
  getProviderDisplayName,
  isConnectedProvider,
  useConnectedProviders,
  type ConnectedProvider,
} from '@/hooks/useConnectedProviders'
import { useCollaborationActivityStore } from '@/stores/useCollaborationActivityStore'
import { ScreenshotAttachments } from '@/components/assistant/ScreenshotAttachment'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { validateInputAgainstSchema } from '@/components/assistant/toolSchemaValidation'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'
import { parseJsonArrayLoose } from '@/lib/ai/parseJsonLoose'
import {
  attachToolDiagnosticsToOutput,
  collectMutatingToolDiagnosticsSummary,
} from '@/lib/diagnostics/toolDiagnosticsPipeline'
import { getMutatingToolFilePaths, isFileMutatingTool } from '@/lib/diagnostics/mutatingTools'
import { MessageBubble, type MessageToolMeta } from '@/components/assistant/MessageBubble'
import {
  parseInjectedPromptForCompaction,
  type InjectedPromptPreview,
} from '@/components/assistant/injectedPromptCompaction'
import { getContextWindowSize } from '@/components/assistant/ContextDisplay'
import type { ModelOption } from '@/lib/ai/modelOptions'
import { AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import {
  getModelCatalog,
  type ModelApiModel,
} from '@/lib/ai/modelCatalogClient'
import { getRetryHintMessage } from '@/lib/ai/retryHints'
import {
  inferProviderFromModelId,
} from '@/lib/ai/providerAuth'
import type { ToolCallPayload, ToolMetaShape, ToolsApiResponse } from '@/lib/ai/toolTypes'
import { fetchWithAbort } from '@/lib/abort'
import { useSettingsDrawerStore } from '@/stores/useSettingsDrawerStore'
import { useProviderAuthResolution } from '@/hooks/useProviderAuthResolution'

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
import { BillingError } from './BillingError'
import { useMutation, useQuery } from 'convex/react'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'

interface AIConversationProps {
  className?: string
  projectPath?: string | null
  projectId?: Id<'projects'> | null
  projectName?: string | null
  projectSlug?: string | null
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
  errorText?: string
  approval?: { id?: string }
}

interface UsageData {
  model?: string
  provider?: string
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
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

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

type TodowriteTaskStatus = 'pending' | 'in_progress' | 'completed'

interface TodowriteTask {
  content: string
  activeForm: string
  status: TodowriteTaskStatus
  files?: string[]
}

function normalizeTodowriteTaskStatus(value: unknown): TodowriteTaskStatus | null {
  if (value === 'pending' || value === 'in_progress' || value === 'completed') {
    return value
  }
  if (value === 'in-progress' || value === 'inprogress' || value === 'active') {
    return 'in_progress'
  }
  if (value === 'complete' || value === 'done') {
    return 'completed'
  }
  return null
}

function normalizeTodowriteTaskList(value: unknown): TodowriteTask[] | null {
  if (!Array.isArray(value)) return null

  const tasks: TodowriteTask[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue

    const content = typeof entry.content === 'string' ? entry.content.trim() : ''
    const status = normalizeTodowriteTaskStatus(entry.status)
    if (!content || !status) continue

    const activeForm =
      typeof entry.activeForm === 'string' && entry.activeForm.trim().length > 0
        ? entry.activeForm.trim()
        : content

    const files = Array.isArray(entry.files)
      ? entry.files
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
      : undefined

    tasks.push({
      content,
      activeForm,
      status,
      ...(files && files.length > 0 ? { files } : {}),
    })
  }

  if (tasks.length === 0 && value.length > 0) {
    return null
  }

  return tasks
}

function parseTodowriteTasksPayload(input: Record<string, unknown>): TodowriteTask[] | null {
  const fromTasks = normalizeTodowriteTaskList(input.tasks)
  if (fromTasks !== null) return fromTasks

  const fromTodos = normalizeTodowriteTaskList(input.todos)
  if (fromTodos !== null) return fromTodos

  if (typeof input.tasks_json === 'string') {
    const parsed = parseJsonArrayLoose(input.tasks_json)
    const fromTasksJson = normalizeTodowriteTaskList(parsed)
    if (fromTasksJson !== null) return fromTasksJson
  }

  return null
}

function getMessageCreatedAt(message: UIMessage): number {
  const candidate = (message as UIMessage & { createdAt?: Date | string | number }).createdAt
  if (candidate instanceof Date) return candidate.getTime()
  if (typeof candidate === 'number' && Number.isFinite(candidate)) return candidate
  if (typeof candidate === 'string') {
    const parsed = Date.parse(candidate)
    if (!Number.isNaN(parsed)) return parsed
  }
  return Date.now()
}

type ChatHookResult = ReturnType<typeof useCozeaChat>

export function AIConversation({
  className,
  projectPath,
  projectId,
  projectName,
  projectSlug,
}: AIConversationProps) {
  const openSettingsDrawer = useSettingsDrawerStore((state) => state.openFromRoute)
  const assistantPanelMode = useAssistantPanelStore((state) => state.mode)
  const assistantPanelWidth = useAssistantPanelStore((state) => state.panelWidth)
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
  const { connectedProviders, providerAuthAvailable, providerStatusLoaded } = useConnectedProviders()

  // Context-based tool availability
  const hasProjectContext = !!projectPath

  const projectBySlugResolution = useQuery(
    api.projects.getAccessibleBySlug,
    !projectId && projectSlug && convexUserId
      ? {
        slug: projectSlug,
        userId: convexUserId,
        preferredOrganizationId: currentOrganization?.convexOrgId as Id<'organizations'> | undefined,
      }
      : 'skip'
  )
  const resolvedProjectId =
    projectId ??
    (projectBySlugResolution?.status === 'ok' ? projectBySlugResolution.project._id : null)

  const acquireFileLock = useMutation(api.projectFileLocks.acquireLock)
  const releaseFileLock = useMutation(api.projectFileLocks.releaseLock)

  // Conversation persistence
  const createConversation = useMutation(api.aiConversations.create)
  const saveConversationMessages = useMutation(api.aiConversations.saveMessages)
  const storedConversation = useQuery(
    api.aiConversations.get,
    currentConversationId && projectSlug ? { id: currentConversationId } : "skip"
  )
  const initialGlobalModelSettings = useMemo(() => loadGlobalModelSettings(), [])

  // Input State
  const [input, setInput] = useState("")
  const [availableModels, setAvailableModels] = useState<ModelOption[]>([])
  const [model, setModel] = useState<string>(
    initialGlobalModelSettings.model ?? ''
  )
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>(
    DEFAULT_AGENT_BY_SURFACE.assistant_panel
  )
  const [variantId, setVariantId] = useState<StoredModelSettings['variantId']>(initialGlobalModelSettings.variantId)
  const [modelSettings, setModelSettings] = useState<Record<string, StoredModelSettings>>(
    () => loadModelSettings()
  )
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, RuntimeModelCapabilities>>({})
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [pendingPromptContext, setPendingPromptContext] = useState<{
    raw: string
    preview: InjectedPromptPreview
  } | null>(null)
  const [ephemeralConversationId, setEphemeralConversationId] = useState(() => crypto.randomUUID())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const addToolOutputRef = useRef<ChatHookResult['addToolOutput'] | null>(null)
  const addToolApprovalResponseRef = useRef<ChatHookResult['addToolApprovalResponse'] | null>(null)
  const cancelledToolCallsRef = useRef<Set<string>>(new Set())
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})
  const conversationInitializedRef = useRef<string | null>(null)
  const isSavingRef = useRef(false)
  const lastProjectScopeRef = useRef<string | null>(null)
  const previousStoredConversationIdRef = useRef(currentConversationId)

  const projectScopeKey = resolvedProjectId ? String(resolvedProjectId) : (projectSlug ?? null)

  const transportConversationId = currentConversationId ?? ephemeralConversationId

  const providerScopedModels = useMemo(() => {
    const supportedModels = availableModels.filter((m) => isConnectedProvider(m.chefSlug))
    if (!providerAuthAvailable || !providerStatusLoaded) return supportedModels
    if (connectedProviders.length === 0) return []
    const connectedSet = new Set(connectedProviders)
    return supportedModels.filter((m) => connectedSet.has(m.chefSlug as ConnectedProvider))
  }, [availableModels, connectedProviders, providerAuthAvailable, providerStatusLoaded])

  const selectedModelData = providerScopedModels.find((m) => m.id === model)
  const selectedProviderForAuth = selectedModelData?.chefSlug
  const {
    header: providerAuthHeader,
    resolved: providerAuthResolved,
  } = useProviderAuthResolution({
    organizationId: currentOrganization?.organizationId,
    modelId: model,
    preferredProvider: selectedProviderForAuth && isConnectedProvider(selectedProviderForAuth)
      ? selectedProviderForAuth
      : null,
  })
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
  const surface = hasProjectContext ? 'assistant_project' : 'assistant_panel'
  const availableAgents = useMemo(
    () => getAvailableAgentsForSurface(surface, hasProjectContext),
    [surface, hasProjectContext]
  )

  // Apply pending prompt injections (e.g. from screenshot capture or inspector actions)
  useEffect(() => {
    if (!pendingPrompt) return
    const compacted = parseInjectedPromptForCompaction(pendingPrompt)
    if (compacted) {
      setPendingPromptContext({ raw: pendingPrompt, preview: compacted })
      setPendingPrompt(null)
      return
    }
    setInput((prev) => (prev ? `${prev}\n\n${pendingPrompt}` : pendingPrompt))
    setPendingPrompt(null)
  }, [pendingPrompt, setPendingPrompt])

  // Get capabilities for the selected model
  const selectedModelCapabilities = useMemo(() => {
    return modelCapabilities[model] ?? null
  }, [model, modelCapabilities])
  const supportsAttachments =
    !selectedModelCapabilities ||
    selectedModelCapabilities.supportsImageInput ||
    selectedModelCapabilities.supportsPdfInput
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
  const displayVariantId = useMemo(
    () => (selectedModelCapabilities ? normalizedVariantId : (variantId ?? normalizedVariantId)),
    [selectedModelCapabilities, normalizedVariantId, variantId]
  )
  const displaySupportedVariants = useMemo(() => {
    if (selectedModelCapabilities) return supportedVariants
    const fallback = variantId ?? normalizedVariantId
    return [fallback]
  }, [selectedModelCapabilities, supportedVariants, variantId, normalizedVariantId])
  const normalizedAgentId = useMemo(
    () => normalizeAgentForSurface(selectedAgentId, surface, hasProjectContext),
    [selectedAgentId, surface, hasProjectContext]
  )
  const selectedAgentProfile = AGENT_PROFILES[normalizedAgentId]
  const hasMultipleAgentProfiles = availableAgents.length > 1

  const modelSettingsRef = useRef(modelSettings)
  useEffect(() => {
    modelSettingsRef.current = modelSettings
  }, [modelSettings])

  useEffect(() => {
    if (!model) return
    const stored = readStoredModelSettings(modelSettingsRef.current, model, surface)
    const nextAgent = normalizeAgentForSurface(stored?.agentId, surface, hasProjectContext)
    setSelectedAgentId(nextAgent)
  }, [model, surface, hasProjectContext])

  useEffect(() => {
    if (!model) return
    const nextSettings: StoredModelSettings = {
      agentId: normalizedAgentId,
      surface,
    }
    setModelSettings((prev) => {
      const updated = writeStoredModelSettings(prev, model, surface, nextSettings)
      saveModelSettings(updated)
      return updated
    })
  }, [model, normalizedAgentId, surface])

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

  const messagesEndRef = useRef<HTMLDivElement>(null)
  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const autoApproveLocalTools = selectedAgentProfile?.autoApproveLocalTools ?? false

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

  useEffect(() => {
    toolsByNameRef.current = Object.fromEntries(
      availableTools.map((tool) => [tool.name, tool])
    )
  }, [availableTools])

  // Fetch allowed models from AI Gateway
  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId || !providerStatusLoaded) return

    let cancelled = false

    getModelCatalog({
      organizationId: currentOrganization.organizationId,
      accessToken,
      connectedProviders: providerAuthAvailable ? connectedProviders : undefined,
    })
      .then((data) => {
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
        // Store capabilities by model ID
        const caps: Record<string, RuntimeModelCapabilities> = {}
        for (const m of data.models) {
          if (m.capabilities) {
            caps[m.id] = m.capabilities
          }
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

  // Fetch enabled tools from AI Gateway
  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId) return

    const controller = new AbortController()
    const query = new URLSearchParams({
      organizationId: currentOrganization.organizationId,
      model,
      agentId: normalizedAgentId,
      surface,
      hasProjectContext: hasProjectContext ? '1' : '0',
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
        return (await res.json()) as ToolResponse
      })
      .then((data) => {
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
  }, [
    accessToken,
    currentOrganization?.organizationId,
    headers,
    model,
    normalizedAgentId,
    surface,
    hasProjectContext,
  ])

  const normalizedProjectSlug = useMemo(() => {
    const source = (projectSlug || projectName || 'active-project').trim().toLowerCase()
    const normalized = source
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
    return normalized || 'active-project'
  }, [projectSlug, projectName])

  const projectContextPayload = useMemo(() => {
    if (!projectPath) return null
    const fallbackName = (projectName || projectSlug || 'Active Project').trim() || 'Active Project'
    return {
      name: fallbackName,
      slug: normalizedProjectSlug,
      runtime: 'local' as const,
      localPath: projectPath ?? undefined,
      // Current page context (invisible to user, sent to AI)
      currentPage: currentPage ?? undefined,
      // Last inspected element context (invisible to user, sent to AI)
      inspectedElement: inspectedElement ?? undefined,
    }
  }, [projectPath, projectName, projectSlug, normalizedProjectSlug, currentPage, inspectedElement])

  const shouldRequireLocalApproval = useCallback((toolMeta?: MessageToolMeta) => {
    if (!toolMeta) return false
    if (toolMeta.executionEnvironment !== 'local') return false
    if (autoApproveLocalTools) return false
    return toolMeta.requiresApproval ?? false
  }, [autoApproveLocalTools])

  const normalizeRelativeFilePath = useCallback((filePath: string) => {
    const normalized = filePath.replace(/\\/g, '/')
    const projectRoot = projectPath?.replace(/\\/g, '/')
    if (projectRoot && normalized.startsWith(projectRoot)) {
      const rel = normalized.slice(projectRoot.length).replace(/^\/+/, '')
      return rel
    }
    return normalized.replace(/^\/+/, '')
  }, [projectPath])

  const enrichToolOutputWithDiagnostics = useCallback(async (
    toolName: string,
    input: Record<string, unknown>,
    output: unknown
  ) => {
    if (!projectPath || !isFileMutatingTool(toolName)) return output

    const summary = await collectMutatingToolDiagnosticsSummary({
      projectPath,
      toolName,
      toolInput: input,
    })

    return attachToolDiagnosticsToOutput(output, summary)
  }, [projectPath])

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
    if (!resolvedProjectId) {
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
          projectId: resolvedProjectId,
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
          releaseFileLock({ projectId: resolvedProjectId, filePath, userId: convexUserId })
        )
      )
    }
  }, [
    acquireFileLock,
    convexUserId,
    formatLockConflictError,
    normalizeRelativeFilePath,
    resolvedProjectId,
    releaseFileLock,
  ])

  // Check if a tool is allowed in the current context
  const isToolAllowedInContext = useCallback((toolName: string) => {
    if (toolName === 'todowrite') {
      return true
    }

    return isLocalToolAllowedForAgent({
      agentId: normalizedAgentId,
      toolName,
      hasProjectContext,
    })
  }, [hasProjectContext, normalizedAgentId])

  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: ToolCallPayload }) => {
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const toolMeta = toolsByNameRef.current[toolCall.toolName]
    if (!toolMeta || toolMeta.executionEnvironment !== 'local') {
      const addToolOutput = addToolOutputRef.current
      if (addToolOutput) {
        void addToolOutput({
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: 'Tool is not available for local execution.',
        })
      }
      return
    }

    // Context-based gating: allow todowrite globally, gate other local tools by context/profile.
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

    if (toolCall.toolName === 'todowrite') {
      const tasks = parseTodowriteTasksPayload(toolInput)
      if (tasks === null) {
        void addToolOutput({
          state: 'output-error',
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          errorText: 'todowrite failed: provide tasks, todos, or valid tasks_json.',
        })
        return
      }

      if (cancelledToolCallsRef.current.has(toolCall.toolCallId)) {
        return
      }

      void addToolOutput({
        tool: toolCall.toolName,
        toolCallId: toolCall.toolCallId,
        output: JSON.stringify({
          success: true,
          taskCount: tasks.length,
          tasks,
        }),
      })
      return
    }

    try {
      const toolFilePaths = getMutatingToolFilePaths(toolCall.toolName, toolInput)
      const run = () =>
        localRuntime.requestToolExecution(transportConversationId, {
          toolName: toolCall.toolName,
          input: toolInput,
          toolCallId: toolCall.toolCallId,
          projectPath: projectPath ?? undefined,
        })

      const result =
        toolFilePaths.length > 0 && isFileMutatingTool(toolCall.toolName)
          ? await withFileLocks(toolFilePaths, run)
          : await run()

      if (cancelledToolCallsRef.current.has(toolCall.toolCallId)) {
        return
      }

      if (result.success) {
        const enrichedOutput = await enrichToolOutputWithDiagnostics(
          toolCall.toolName,
          toolInput,
          result.output
        )
        if (cancelledToolCallsRef.current.has(toolCall.toolCallId)) {
          return
        }
        void addToolOutput({
          tool: toolCall.toolName,
          toolCallId: toolCall.toolCallId,
          output: enrichedOutput,
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
    transportConversationId,
    enrichToolOutputWithDiagnostics,
    isToolAllowedInContext,
    localRuntime,
    projectPath,
    shouldRequireLocalApproval,
    withFileLocks,
  ])

  // Chat hook with auth transport
  const {
    status,
    error,
    sendMessage,
    stop,
    setMessages,
    addToolOutput,
    addToolApprovalResponse,
    dedupedMessages: uniqueMessages,
    retryHint,
    billingError,
    setBillingError,
    setConversationId: setTransportConversationId,
  } = useCozeaChat({
    transportArgs: {
      accessToken,
      organizationId: currentOrganization?.organizationId,
      model,
      selectedProvider:
        selectedModelData?.chefSlug ??
        inferProviderFromModelId(model) ??
        undefined,
      conversationId: transportConversationId,
      agentId: normalizedAgentId,
      surface,
      variantId: normalizedVariantId,
      enableTools: true,
      enableWebSearch: true,
      extraBody: {
        projectContext: projectContextPayload,
      },
      providerAuthHeader,
    },
    chatOptions: {
      onToolCall: handleToolCall,
    },
  })

  addToolOutputRef.current = addToolOutput
  addToolApprovalResponseRef.current = addToolApprovalResponse

  useEffect(() => {
    const previousConversationId = previousStoredConversationIdRef.current
    const didSwitchConversation =
      previousConversationId !== null &&
      previousConversationId !== currentConversationId

    if (didSwitchConversation) {
      // Prevent late stream/tool updates from the previous conversation
      // from leaking into the newly selected thread.
      stop()
      void localRuntime.cancelRun(previousConversationId)
      conversationInitializedRef.current = null
      setMessages([])
    }

    if (previousConversationId && currentConversationId === null) {
      setEphemeralConversationId(crypto.randomUUID())
    }
    previousStoredConversationIdRef.current = currentConversationId
  }, [currentConversationId, localRuntime, setMessages, stop])

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

  // Load stored messages when conversation changes
  useEffect(() => {
    if (!storedConversation) return
    if (!currentConversationId) return
    if (storedConversation._id !== currentConversationId) return
    if (conversationInitializedRef.current === currentConversationId) return
    if (resolvedProjectId && storedConversation.projectId !== resolvedProjectId) return

    // Convert stored messages to UIMessage format
    const uiMessages: UIMessage[] = storedConversation.messages.map((msg) => {
      const persistedParts = Array.isArray(msg.toolInvocations)
        ? (msg.toolInvocations as UIMessage['parts'])
        : null

      return {
        id: msg.id,
        role: msg.role,
        parts:
          persistedParts && persistedParts.length > 0
            ? persistedParts
            : [{ type: 'text' as const, text: msg.content }],
        createdAt: new Date(msg.createdAt),
      }
    })

    const dedupedMessages = uiMessages.filter((message, index, all) => {
      if (!message.id) return true
      return all.findIndex((m) => m.id === message.id) === index
    })

    setMessages(dedupedMessages)
    conversationInitializedRef.current = currentConversationId

    // Update chat title
    if (storedConversation.title) {
      useAssistantPanelStore.getState().setChatTitle(storedConversation.title)
    }
  }, [storedConversation, currentConversationId, resolvedProjectId, setMessages])

  // Clear project-scoped conversations when leaving or switching projects.
  useEffect(() => {
    if (lastProjectScopeRef.current === null) {
      lastProjectScopeRef.current = projectScopeKey
      return
    }

    if (lastProjectScopeRef.current !== projectScopeKey) {
      setCurrentConversationId(null)
      setMessages([])
      useAssistantPanelStore.getState().setChatTitle("New Chat")
      lastProjectScopeRef.current = projectScopeKey
    }
  }, [projectScopeKey, setCurrentConversationId, setMessages])

  // If a conversation doesn't belong to the current project, drop it.
  useEffect(() => {
    if (!resolvedProjectId) return
    if (!currentConversationId || !storedConversation) return
    if (storedConversation.projectId === resolvedProjectId) return

    setCurrentConversationId(null)
    setMessages([])
    useAssistantPanelStore.getState().setChatTitle("New Chat")
  }, [resolvedProjectId, currentConversationId, storedConversation, setCurrentConversationId, setMessages])

  // If project context exists but we cannot resolve a project id, ensure stale conversations are dropped.
  useEffect(() => {
    if (!projectSlug || resolvedProjectId) return
    if (!currentConversationId) return

    setCurrentConversationId(null)
    setMessages([])
    useAssistantPanelStore.getState().setChatTitle("New Chat")
  }, [projectSlug, resolvedProjectId, currentConversationId, setCurrentConversationId, setMessages])

  // Reset initialization ref when conversation changes to null
  useEffect(() => {
    if (currentConversationId === null) {
      conversationInitializedRef.current = null
    }
  }, [currentConversationId])

  // Save messages to Convex when they change (debounced)
  useEffect(() => {
    if (!resolvedProjectId) return
    if (!currentConversationId) return
    // Prevent old-thread snapshots from being saved into a newly selected conversation
    // while that conversation is still loading.
    if (conversationInitializedRef.current !== currentConversationId) return
    if (uniqueMessages.length === 0) return
    if (isSavingRef.current) return
    if (status === 'streaming' || status === 'submitted') return

    const saveMessages = async () => {
      isSavingRef.current = true
      try {
        // Convert UIMessages to storage format
        const storedMessages = uniqueMessages.map((msg) => {
          const content = getMessageText(msg)

          return {
            id: msg.id,
            role: msg.role as 'user' | 'assistant' | 'system',
            content,
            createdAt: getMessageCreatedAt(msg),
            toolInvocations: msg.parts,
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
  }, [uniqueMessages, currentConversationId, resolvedProjectId, status, saveConversationMessages])

  const genericErrorMessage = useMemo(() => {
    if (!error || billingError) return null
    const retryHintMessage = getRetryHintMessage(retryHint)
    if (retryHintMessage) return retryHintMessage
    const message = (error as { message?: string }).message
    if (typeof message === 'string' && message.trim()) return message
    const errorStr = error as unknown
    if (typeof errorStr === 'string' && errorStr.trim()) return errorStr
    return 'Something went wrong'
  }, [error, billingError, retryHint])

  const serviceErrorMessage = modelsError || toolsError
  const surfaceErrorMessage = serviceErrorMessage || genericErrorMessage
  const providerConnectionMessage =
    !hasSelectableModel && providerStatusLoaded && providerAuthAvailable
      ? 'Connect an AI provider'
      : null
  const providerAuthMessage =
    hasSelectableModel && !providerAuthResolved
      ? 'Preparing provider authentication...'
      : null
  const surfaceBannerMessage = surfaceErrorMessage || providerConnectionMessage || providerAuthMessage

  const genericErrorRef = useRef<string | null>(null)
  useEffect(() => {
    if (!surfaceBannerMessage) {
      genericErrorRef.current = null
      setDismissedError(null)
      return
    }
    if (surfaceBannerMessage !== genericErrorRef.current) {
      genericErrorRef.current = surfaceBannerMessage
      setDismissedError(null)
    }
  }, [surfaceBannerMessage])

  const showGenericError = Boolean(
    surfaceBannerMessage && dismissedError !== surfaceBannerMessage
  )
  const showProviderSettingsCta = surfaceBannerMessage === providerConnectionMessage

  // Compute accumulated token usage from all messages
  // This follows the official AI SDK pattern of reading custom data-* parts from the stream
  const accumulatedUsage = useMemo(() => {
    let inputTokens = 0
    let outputTokens = 0
    let reasoningTokens = 0
    let cachedInputTokens = 0
    let usageSpendCents = 0
    const runCosts = new Map<string, number>()

    for (const message of uniqueMessages) {
      for (const part of message.parts) {
        if (part.type === 'data-usage') {
          const data = (part as { data?: UsageData }).data
          if (data) {
            inputTokens += data.promptTokens ?? 0
            outputTokens += data.completionTokens ?? 0
            reasoningTokens += data.reasoningTokens ?? 0
            cachedInputTokens += data.cachedInputTokens ?? 0
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

    const totalTokens = inputTokens + outputTokens
    const totalCostUsd =
      runCosts.size > 0
        ? Array.from(runCosts.values()).reduce((sum, value) => sum + value, 0)
        : usageSpendCents / 100

    return {
      usedTokens: totalTokens,
      totalCostUsd,
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
  }, [uniqueMessages])

  const replyPermissionRequest = useCallback(async (
    requestId: string,
    reply: 'once' | 'always' | 'reject',
    message?: string
  ) => {
    if (!accessToken) return

    try {
      await fetchWithAbort(`${AI_BASE_URL}/permissions/reply`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          requestId,
          reply,
          ...(message ? { message } : {}),
        }),
      }, { timeoutMs: 15000 })
    } catch (err) {
      console.warn('Failed to reply to permission request:', err)
    }
  }, [accessToken])

  const runLocalTool = useCallback(async (toolName: string, toolCallId: string, input: unknown) => {
    // Context-based gating (todowrite is allowed without project context).
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

    if (toolName === 'todowrite') {
      const tasks = parseTodowriteTasksPayload(toolInput)
      if (tasks === null) {
        void addToolOutput({
          state: 'output-error',
          tool: toolName,
          toolCallId,
          errorText: 'todowrite failed: provide tasks, todos, or valid tasks_json.',
        })
        return
      }

      if (cancelledToolCallsRef.current.has(toolCallId)) {
        return
      }

      void addToolOutput({
        tool: toolName,
        toolCallId,
        output: JSON.stringify({
          success: true,
          taskCount: tasks.length,
          tasks,
        }),
      })
      return
    }

    const toolFilePaths = getMutatingToolFilePaths(toolName, toolInput)
    const run = () =>
      localRuntime.requestToolExecution(transportConversationId, {
        toolName,
        input: toolInput,
        toolCallId,
        projectPath: projectPath ?? undefined,
      })
    const result =
      toolFilePaths.length > 0 && isFileMutatingTool(toolName)
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
      if (cancelledToolCallsRef.current.has(toolCallId)) {
        return
      }
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
    transportConversationId,
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
        void replyPermissionRequest(approvalId, 'once')
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
  }, [addToolOutput, replyPermissionRequest, runLocalTool])

  const handleDeniedTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    approvalId?: string
  ) => {
    const toolMeta = toolsByNameRef.current[toolName]
    const isLocal = !toolMeta || toolMeta.executionEnvironment === 'local'

    if (approvalId && addToolApprovalResponseRef.current && !isLocal) {
      await addToolApprovalResponseRef.current({ id: approvalId, approved: false })
      void replyPermissionRequest(approvalId, 'reject')
      return
    }

    void addToolOutput({
      state: 'output-error',
      tool: toolName,
      toolCallId,
      errorText: 'User denied tool execution',
    })
  }, [addToolOutput, replyPermissionRequest])

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
      setPendingPromptContext(null)
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

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!hasSelectableModel) return;
    if (!providerAuthResolved) return;
    if (!input.trim() && pendingAttachments.length === 0 && !pendingPromptContext) return;

    // Clear any previous billing error when trying again
    setBillingError(null)

    // Create conversation on first message if we don't have one
    if (!currentConversationId && resolvedProjectId && convexUserId) {
      try {
        const newConversationId = await createConversation({
          projectId: resolvedProjectId,
          userId: convexUserId,
          title: input.slice(0, 50) + (input.length > 50 ? '...' : '') || 'New Conversation',
        })
        setTransportConversationId(newConversationId)
        setCurrentConversationId(newConversationId)
        conversationInitializedRef.current = newConversationId
      } catch (err) {
        console.warn('Failed to create conversation:', err)
      }
    }

    // Build message with optional attachments
    const trimmedInput = input.trim()
    const textWithContext = pendingPromptContext
      ? (trimmedInput
        ? `${pendingPromptContext.raw}\n\nUser request: ${trimmedInput}`
        : pendingPromptContext.raw)
      : trimmedInput

    const messageOptions: { text: string; experimental_attachments?: Array<{ url: string; contentType: string }> } = {
      text: textWithContext || 'Analyze this screenshot',
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
    setPendingPromptContext(null)
    clearPendingAttachments()

    // Send message (don't await - let it stream in the background)
    void sendMessage(messageOptions)
  };

  const handleStop = (e: React.MouseEvent) => {
    e.preventDefault()
    cancelPendingToolOutputs()
    void localRuntime.cancelRun(transportConversationId)
    stop()
  }

  const resizeComposerTextarea = useCallback((target: HTMLTextAreaElement) => {
    const rect = target.getBoundingClientRect()
    if (rect.width < 40 || rect.height === 0) {
      return
    }

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

  useEffect(() => {
    if (!composerTextareaRef.current) return

    const textarea = composerTextareaRef.current

    if (assistantPanelMode === 'closed') {
      textarea.style.height = 'auto'
      textarea.style.overflowY = 'hidden'
      return
    }

    const resizeNow = () => {
      if (!composerTextareaRef.current) return
      resizeComposerTextarea(composerTextareaRef.current)
    }

    const immediateFrame = requestAnimationFrame(resizeNow)
    const delayedFrame = requestAnimationFrame(() => {
      requestAnimationFrame(resizeNow)
    })
    const delayedTimeout = window.setTimeout(resizeNow, 340)

    return () => {
      window.cancelAnimationFrame(immediateFrame)
      window.cancelAnimationFrame(delayedFrame)
      window.clearTimeout(delayedTimeout)
    }
  }, [assistantPanelMode, assistantPanelWidth, resizeComposerTextarea])

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit();
    }
  };

  const hasDraftInput = input.trim().length > 0 || pendingAttachments.length > 0 || pendingPromptContext !== null
  const submitDisabled = !isLoading && (!hasSelectableModel || !providerAuthResolved || !hasDraftInput)

  return (
    <div className={cn('flex flex-col h-full overflow-hidden', className)}>
      {/* Messages Area */}
        <div className="flex-1 min-h-0 relative">
          {/* Top fade */}
        <div className="assistant-scroll-fade-top absolute top-0 left-0 right-0 h-8 z-10 pointer-events-none" />
          {/* Bottom fade */}
        <div className="assistant-scroll-fade-bottom absolute bottom-0 left-0 right-0 h-8 z-10 pointer-events-none" />
        <Conversation className="h-full">
          <ConversationContent
            className={cn(
              uniqueMessages.length === 0
                ? "h-full p-0"
                : "w-full max-w-2xl mx-auto px-3 pt-4 pb-24"
            )}
          >
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
                  showTodowriteTools
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
          "px-3 pb-3 shrink-0 mt-auto w-full max-w-2xl mx-auto",
          uniqueMessages.length === 0 ? "pt-1" : "pt-2"
        )}
        style={{ backgroundColor: 'var(--assistant-surface, var(--background))' }}
      >
        <div className="bg-secondary rounded-2xl overflow-hidden">
          {billingError ? (
            <BillingError
              error={billingError as any}
              className="border-0 border-b rounded-none p-3"
            />
          ) : showGenericError && surfaceBannerMessage && (
            <div className="flex items-center gap-2 bg-destructive/10 text-destructive border-b border-destructive/30 px-3 py-2">
              <p className="text-xs leading-5 flex-1 min-w-0">
                {surfaceBannerMessage}
              </p>
              {showProviderSettingsCta ? (
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-7 shrink-0 border-destructive/40 bg-transparent px-2 text-xs text-destructive hover:bg-destructive/10 hover:text-destructive"
                  onClick={() => openSettingsDrawer('/settings/ai')}
                >
                  AI Settings
                </Button>
              ) : (
                <button
                  type="button"
                  className="mt-0.5 text-destructive/70 hover:text-destructive"
                  onClick={() => setDismissedError(surfaceBannerMessage)}
                  aria-label="Dismiss error"
                >
                  <IconX className="size-4" />
                </button>
              )}
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

          {pendingPromptContext ? (
            <div className="px-3 pt-3">
              <div className="flex items-start">
                {pendingPromptContext.preview.kind === 'inspector' ? (
                  <div className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-teal-200 px-2.5 py-1 text-[11px] text-foreground dark:bg-teal-900">
                    <MousePointer2 className="h-3 w-3 shrink-0 text-teal-700/80 dark:text-teal-200/90" />
                    <span className="min-w-0 truncate">
                      {pendingPromptContext.preview.pillText || 'Inspected element'}
                    </span>
                    <button
                      type="button"
                      className="pointer-events-none ml-0 grid h-4 w-0 shrink-0 place-items-center overflow-hidden rounded opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:ml-1.5 group-hover:w-4 group-hover:opacity-100 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                      onClick={() => setPendingPromptContext(null)}
                      aria-label="Remove context"
                    >
                      <IconX className="size-3" />
                    </button>
                  </div>
                ) : pendingPromptContext.preview.kind === 'terminal' ? (
                  <div className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-sky-200 px-2.5 py-1 text-[11px] text-foreground dark:bg-sky-900">
                    <Terminal className="h-3 w-3 shrink-0 text-sky-700/80 dark:text-sky-200/90" />
                    <span className="min-w-0 truncate">
                      {pendingPromptContext.preview.pillText || 'Terminal output'}
                    </span>
                    <button
                      type="button"
                      className="pointer-events-none ml-0 grid h-4 w-0 shrink-0 place-items-center overflow-hidden rounded opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:ml-1.5 group-hover:w-4 group-hover:opacity-100 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                      onClick={() => setPendingPromptContext(null)}
                      aria-label="Remove context"
                    >
                      <IconX className="size-3" />
                    </button>
                  </div>
                ) : pendingPromptContext.preview.kind === 'problem' ? (
                  <div className="group inline-flex min-w-0 max-w-full items-center gap-1.5 rounded-full bg-amber-200 px-2.5 py-1 text-[11px] text-foreground dark:bg-amber-900">
                    <AlertTriangle className="h-3 w-3 shrink-0 text-amber-700/80 dark:text-amber-200/90" />
                    <span className="min-w-0 truncate">
                      {pendingPromptContext.preview.pillText || 'Problem'}
                    </span>
                    <button
                      type="button"
                      className="pointer-events-none ml-0 grid h-4 w-0 shrink-0 place-items-center overflow-hidden rounded opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:ml-1.5 group-hover:w-4 group-hover:opacity-100 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                      onClick={() => setPendingPromptContext(null)}
                      aria-label="Remove context"
                    >
                      <IconX className="size-3" />
                    </button>
                  </div>
                ) : (
                  <div className="group min-w-0 flex flex-1 items-start gap-2 rounded-lg border border-border/60 bg-background/35 px-2.5 py-2">
                    <div className="min-w-0 flex-1">
                      <div className="text-[11px] font-medium text-foreground">
                        {pendingPromptContext.preview.title}
                      </div>
                      <p className="mt-0.5 text-[10px] text-muted-foreground">
                        {pendingPromptContext.preview.subtitle}
                      </p>
                      {pendingPromptContext.preview.snippet ? (
                        <p className="mt-1 truncate text-[10px] text-muted-foreground">
                          {pendingPromptContext.preview.snippet}
                        </p>
                      ) : null}
                    </div>
                    <button
                      type="button"
                      className="pointer-events-none ml-0 grid h-4 w-0 shrink-0 place-items-center overflow-hidden rounded opacity-0 transition-all duration-150 group-hover:pointer-events-auto group-hover:ml-1.5 group-hover:w-4 group-hover:opacity-100 hover:bg-foreground/10 text-muted-foreground hover:text-foreground"
                      onClick={() => setPendingPromptContext(null)}
                      aria-label="Remove context"
                    >
                      <IconX className="size-3" />
                    </button>
                  </div>
                )}
              </div>
            </div>
          ) : null}

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
              )}
            </div>

            <div>
              <Button
                type="submit"
                disabled={submitDisabled}
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
        <div className="flex items-center gap-1 pt-2">
          <div
            className={cn(
              "grid overflow-hidden transition-all duration-200 ease-out",
              hasMultipleAgentProfiles
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
                    <span>{selectedAgentProfile?.label ?? normalizedAgentId}</span>
                    <IconChevronDown className="size-3" />
                  </Button>
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  align="start"
                  className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
                >
                  <DropdownMenuGroup className="space-y-1">
                    {availableAgents.map((agentId) => (
                      <DropdownMenuItem
                        key={agentId}
                        className="rounded-[calc(1rem-6px)] text-xs"
                        onClick={() => setSelectedAgentId(agentId)}
                      >
                        {normalizedAgentId === agentId ? (
                          <IconCheck className="size-3 opacity-70" />
                        ) : (
                          <div className="size-3" />
                        )}
                        {AGENT_PROFILES[agentId].label}
                      </DropdownMenuItem>
                    ))}
                  </DropdownMenuGroup>
                </DropdownMenuContent>
              </DropdownMenu>
            </div>
          </div>

          {hasSelectableModel && (
            <>
              <div
                className={cn(
                  "grid overflow-hidden transition-all duration-200 ease-out",
                  displaySupportedVariants.length > 1
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
                        <span>{VARIANT_DEFINITIONS[displayVariantId]?.label ?? displayVariantId}</span>
                        <IconChevronDown className="size-3" />
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent
                      align="start"
                      className="max-w-xs rounded-2xl p-1.5 bg-popover border-border"
                    >
                      <DropdownMenuGroup className="space-y-1">
                        {displaySupportedVariants.map((variant) => (
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
                  displaySupportedVariants.length <= 1
                    ? "grid-cols-[1fr] opacity-100 translate-y-0"
                    : "grid-cols-[0fr] opacity-0 -translate-y-1 pointer-events-none"
                )}
              >
                <div className="min-w-0 h-6 px-2 flex items-center rounded-full border border-transparent text-muted-foreground text-xs">
                  <Brain className="size-3 mr-1" />
                  <span>{VARIANT_DEFINITIONS[displayVariantId]?.label ?? displayVariantId}</span>
                </div>
              </div>
            </>
          )}

          <div className="flex-1" />

          {/* Context window usage display - right aligned */}
          {hasSelectableModel && (
            <div className="flex items-center gap-2">
              {accumulatedUsage.totalCostUsd > 0 && (
                <span className="text-xs text-muted-foreground tabular-nums">
                  ${accumulatedUsage.totalCostUsd.toFixed(4)}
                </span>
              )}
              <Context
                maxTokens={selectedModelData?.limit?.context ?? getContextWindowSize(model)}
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
          )}
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
