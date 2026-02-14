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
  IconHistory,
  IconPaperclip,
  IconPlus,
  IconSquare,
  IconX,
} from '@tabler/icons-react'
import { Brain } from 'lucide-react'
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
  CONNECTED_PROVIDER_DISPLAY_NAME,
  CONNECTED_PROVIDER_ORDER,
  isConnectedProvider,
  useConnectedProviders,
  type ConnectedProvider,
} from '@/hooks/useConnectedProviders'
import { useCollaborationActivityStore } from '@/stores/useCollaborationActivityStore'
import { ScreenshotAttachments } from '@/components/assistant/ScreenshotAttachment'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { validateInputAgainstSchema } from '@/components/assistant/toolSchemaValidation'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'
import { attachToolDiagnosticsToOutput, collectToolDiagnosticsSummary } from '@/lib/diagnostics/toolDiagnosticsPipeline'
import { MessageBubble, type MessageToolMeta } from '@/components/assistant/MessageBubble'
import { getContextWindowSize } from '@/components/assistant/ContextDisplay'
import { DEFAULT_MODELS, type ModelOption } from '@/lib/ai/defaultModels'
import { AI_API_URL, AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import { buildEncodedProviderAuthHeader, inferProviderFromModelId } from '@/lib/ai/providerAuth'
import type { ToolCallPayload, ToolMetaShape, ToolsApiResponse } from '@/lib/ai/toolTypes'

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
  errorText?: string
  approval?: { id?: string }
}

interface UsageData {
  promptTokens?: number
  completionTokens?: number
  totalTokens?: number
  reasoningTokens?: number
  cachedInputTokens?: number
}

// Tool categories for diagnostics + file locking.
const WRITE_TOOLS = new Set([
  'write', 'edit',
  'multiedit', 'bash', 'get_terminal_output', 'apply_patch',
  'install_dependencies', 'verify_build', 'start_dev_server',
])

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

type ChatHookResult = ReturnType<typeof useChat>

// Model catalog comes from shared defaults and server model metadata.
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
  const { connectedProviders, providerAuthAvailable, providerStatusLoaded } = useConnectedProviders()

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
  const initialGlobalModelSettings = useMemo(() => loadGlobalModelSettings(), [])

  // Input State
  const [input, setInput] = useState("")
  const [availableModels, setAvailableModels] = useState<ModelOption[]>(defaultModels)
  const [model, setModel] = useState<string>(
    initialGlobalModelSettings.model ?? defaultModels[0]?.id ?? ''
  )
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [providerAuthHeader, setProviderAuthHeader] = useState<string | null>(null)
  const [modelSelectorOpen, setModelSelectorOpen] = useState(false)
  const [selectedAgentId, setSelectedAgentId] = useState<AgentId>(
    DEFAULT_AGENT_BY_SURFACE.assistant_panel
  )
  const [variantId, setVariantId] = useState<StoredModelSettings['variantId']>(
    initialGlobalModelSettings.variantId ?? 'medium'
  )
  const [modelSettings, setModelSettings] = useState<Record<string, StoredModelSettings>>(
    () => loadModelSettings()
  )
  const [modelCapabilities, setModelCapabilities] = useState<Record<string, RuntimeModelCapabilities>>({})
  const [modelsError, setModelsError] = useState<string | null>(null)
  const [toolsError, setToolsError] = useState<string | null>(null)
  const [billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const [dismissedError, setDismissedError] = useState<string | null>(null)
  const [conversationId] = useState(() => crypto.randomUUID())
  const fileInputRef = useRef<HTMLInputElement>(null)
  const composerTextareaRef = useRef<HTMLTextAreaElement>(null)
  const addToolOutputRef = useRef<ChatHookResult['addToolOutput'] | null>(null)
  const addToolApprovalResponseRef = useRef<ChatHookResult['addToolApprovalResponse'] | null>(null)
  const cancelledToolCallsRef = useRef<Set<string>>(new Set())
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})
  const conversationInitializedRef = useRef<string | null>(null)
  const isSavingRef = useRef(false)
  const lastProjectSlugRef = useRef<string | null>(null)

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
  const surface = hasProjectContext ? 'assistant_project' : 'assistant_panel'
  const availableAgents = useMemo(
    () => getAvailableAgentsForSurface(surface, hasProjectContext),
    [surface, hasProjectContext]
  )

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

  useEffect(() => {
    let cancelled = false
    const organizationId = currentOrganization?.organizationId
    if (!organizationId) {
      setProviderAuthHeader(null)
      return
    }

    const selectedProvider = selectedModelData?.chefSlug
    const provider = (selectedProvider && isConnectedProvider(selectedProvider))
      ? selectedProvider
      : inferProviderFromModelId(model)
    if (!provider) {
      setProviderAuthHeader(null)
      return
    }

    void (async () => {
      const result = await buildEncodedProviderAuthHeader({
        provider,
        modelId: model,
        organizationId,
      })
      if (cancelled) return
      setProviderAuthHeader(result.header || null)
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
        return (await res.json()) as ModelApiResponse
      })
      .then((data) => {
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
        // Store capabilities by model ID
        const caps: Record<string, RuntimeModelCapabilities> = {}
        for (const m of data.models) {
          if (m.capabilities) {
            caps[m.id] = m.capabilities
          }
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

    fetch(`${AI_BASE_URL}/tools?${query.toString()}`, {
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
      localPath: projectPath ?? undefined,
      // Current page context (invisible to user, sent to AI)
      currentPage: currentPage ?? undefined,
      // Last inspected element context (invisible to user, sent to AI)
      inspectedElement: inspectedElement ?? undefined,
    }
  }, [projectPath, projectName, projectSlug, normalizedProjectSlug, currentPage, inspectedElement])

  const requestConfigRef = useRef({
    accessToken,
    organizationId: currentOrganization?.organizationId || null,
    model,
    conversationId,
    agentId: normalizedAgentId,
    surface,
    variantId: normalizedVariantId,
    projectContext: projectContextPayload,
    providerAuthHeader,
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: currentOrganization?.organizationId || null,
      model,
      conversationId,
      agentId: normalizedAgentId,
      surface,
      variantId: normalizedVariantId,
      projectContext: projectContextPayload,
      providerAuthHeader,
    }
  }, [
    accessToken,
    currentOrganization?.organizationId,
    model,
    conversationId,
    normalizedAgentId,
    surface,
    normalizedVariantId,
    projectContextPayload,
    providerAuthHeader,
  ])

  const chatTransport = useMemo(() => {
    return new DefaultChatTransport({
      api: AI_API_URL,
      headers: (): Record<string, string> => {
        const token = requestConfigRef.current.accessToken
        const providerHeader = requestConfigRef.current.providerAuthHeader
        const headers: Record<string, string> = {}
        if (token) {
          headers.Authorization = `Bearer ${token}`
        }
        if (providerHeader) {
          headers['x-cozea-provider-auth'] = providerHeader
        }
        return headers
      },
      body: () => ({
        model: requestConfigRef.current.model,
        organizationId: requestConfigRef.current.organizationId,
        conversationId: requestConfigRef.current.conversationId,
        agentId: requestConfigRef.current.agentId,
        surface: requestConfigRef.current.surface,
        variantId: requestConfigRef.current.variantId,
        // Always enable tools and web search - context-based gating happens client-side
        enableTools: true,
        enableWebSearch: true,
        // Project context for AI awareness
        projectContext: requestConfigRef.current.projectContext,
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

  const getToolFilePaths = useCallback((toolName: string, input: Record<string, unknown> | null | undefined): string[] => {
    if (!input) return []

    if (toolName === 'write' || toolName === 'edit' || toolName === 'read') {
      const filePath = input.filePath
      return typeof filePath === 'string' && filePath.trim() ? [filePath] : []
    }

    if (toolName === 'multiedit') {
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
      return
    }

    // Context-based gating: block all local tools when not in project context.
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

    const lastIndexById = new Map<string, number>()
    for (let index = 0; index < messages.length; index += 1) {
      const messageId = messages[index]?.id
      if (!messageId) continue
      lastIndexById.set(messageId, index)
    }

    return messages.filter((message, index) => {
      if (!message.id) return true
      return lastIndexById.get(message.id) === index
    })
  }, [messages])

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
    if (conversationInitializedRef.current === currentConversationId) return
    if (project && storedConversation.projectId !== project._id) return

    // Convert stored messages to UIMessage format
    const uiMessages: UIMessage[] = storedConversation.messages.map((msg) => ({
      id: msg.id,
      role: msg.role,
      parts: [{ type: 'text' as const, text: msg.content }],
      createdAt: new Date(msg.createdAt),
    }))

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
  }, [storedConversation, currentConversationId, project, setMessages])

  // Clear project-scoped conversations when leaving or switching projects.
  useEffect(() => {
    const nextSlug = projectSlug ?? null
    if (lastProjectSlugRef.current === null) {
      lastProjectSlugRef.current = nextSlug
      return
    }

    if (lastProjectSlugRef.current !== nextSlug) {
      setCurrentConversationId(null)
      setMessages([])
      useAssistantPanelStore.getState().setChatTitle("New Chat")
      lastProjectSlugRef.current = nextSlug
    }
  }, [projectSlug, setCurrentConversationId, setMessages])

  // If a conversation doesn't belong to the current project, drop it.
  useEffect(() => {
    if (!projectSlug) return
    if (!project) return
    if (!currentConversationId || !storedConversation) return
    if (storedConversation.projectId === project._id) return

    setCurrentConversationId(null)
    setMessages([])
    useAssistantPanelStore.getState().setChatTitle("New Chat")
  }, [projectSlug, project, currentConversationId, storedConversation, setCurrentConversationId, setMessages])

  // If project slug exists but project is missing, ensure we don't reuse old conversations.
  useEffect(() => {
    if (!projectSlug) return
    if (project !== null) return
    if (!currentConversationId) return

    setCurrentConversationId(null)
    setMessages([])
    useAssistantPanelStore.getState().setChatTitle("New Chat")
  }, [projectSlug, project, currentConversationId, setCurrentConversationId, setMessages])

  // Reset initialization ref when conversation changes to null
  useEffect(() => {
    if (currentConversationId === null) {
      conversationInitializedRef.current = null
    }
  }, [currentConversationId])

  // Save messages to Convex when they change (debounced)
  useEffect(() => {
    if (!projectSlug) return
    if (!currentConversationId) return
    if (uniqueMessages.length === 0) return
    if (isSavingRef.current) return
    if (status === 'streaming' || status === 'submitted') return

    const saveMessages = async () => {
      isSavingRef.current = true
      try {
        // Convert UIMessages to storage format
        const storedMessages = uniqueMessages.map((msg) => {
          const textParts = msg.parts.filter((p) => p.type === 'text')
          const content = textParts.map((p) => (p as { text: string }).text).join('')

          return {
            id: msg.id,
            role: msg.role as 'user' | 'assistant' | 'system',
            content,
            createdAt: getMessageCreatedAt(msg),
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
  }, [uniqueMessages, currentConversationId, projectSlug, status, saveConversationMessages])

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

    for (const message of uniqueMessages) {
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
      await fetch(`${AI_BASE_URL}/permissions/reply`, {
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
      })
    } catch (err) {
      console.warn('Failed to reply to permission request:', err)
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
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [uniqueMessages])

  const handleSubmit = async (e?: React.FormEvent) => {
    e?.preventDefault();
    if (!hasSelectableModel) return;
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
            </div>

            <div>
              <Button
                type="submit"
                disabled={(!hasSelectableModel || (!input.trim() && pendingAttachments.length === 0)) && !isLoading}
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
        {!hasSelectableModel && providerStatusLoaded && providerAuthAvailable && (
          <p className="px-1 pt-2 text-xs text-amber-600">
            Connect an AI provider in Workspace AI settings to use the assistant.
          </p>
        )}

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
