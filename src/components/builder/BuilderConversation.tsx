import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useCozeaChat } from '@/hooks/useCozeaChat'
import { useMutation } from 'convex/react'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
import { useAiExecutionScope } from '@/hooks/useAiExecutionScope'
import { LocalAgentRuntime } from '@/agents/localRuntime'
import { api } from '../../../convex/_generated/api'
import type { Id } from '../../../convex/_generated/dataModel'
import type { BuildTask } from './BuildTaskList'
import { MessageBubble, type MessageToolMeta } from '@/components/assistant/MessageBubble'
import { validateInputAgainstSchema } from '@/components/assistant/toolSchemaValidation'

// AI Elements components
import {
  Conversation,
  ConversationContent,
  ConversationScrollButton,
} from '@/components/ai-elements/conversation'
import { Loader } from '@/components/ai-elements/loader'
import { parseBillingError, type BillingErrorData } from '@/components/assistant/BillingError'
import { parseJsonArrayLoose } from '@/lib/ai/parseJsonLoose'
import { normalizeToolInput } from '@/lib/ai/normalizeToolInput'
import { AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import { getRetryHintSurfaceError, type AiSurfaceErrorData } from '@/lib/ai/surfaceErrors'
import {
  inferProviderFromModelId,
  isManagedProvider,
} from '@/lib/ai/providerAuth'
import { useProviderAuthResolution } from '@/hooks/useProviderAuthResolution'
import { loadGlobalModelSettings } from '@/lib/modelSettingsStorage'
import { getModelCatalog } from '@/lib/ai/modelCatalogClient'
import { resolveModelIdFromCatalog } from '@/lib/ai/modelIdResolution'
import { validateWebOnlyBuildContract } from '@/lib/plan'
import {
  attachToolDiagnosticsToOutput,
  collectMutatingToolDiagnosticsSummary,
  summarizeLintDiagnostics,
  type PipelineDiagnostic,
} from '@/lib/diagnostics/toolDiagnosticsPipeline'
import { isFileMutatingTool } from '@/lib/diagnostics/mutatingTools'
import type { ToolCallPayload } from '@/lib/ai/toolTypes'
import { useCollaborationActivityStore } from '@/stores/useCollaborationActivityStore'
import type { DevServerStatus } from '@/hooks/useDevServerManager'

// Fallback for workflow tools if metadata is briefly stale during startup.
const BUILDER_WORKFLOW_FALLBACK_TOOLS = new Set([
  'todowrite',
  'build_complete',
  'preview_start',
  'preview_browser',
])

// Project type from Convex
interface Project {
  _id: Id<'projects'>
  name: string
  slug: string
  targetPlatform?: string
  buildContract?: {
    previewMode?: string
    frameworkClass?: string
    toolchain?: Record<string, unknown>
    commands?: Record<string, unknown>
    constraints?: Record<string, unknown>
    fallbackPolicy?: Record<string, unknown>
    successCriteria?: Record<string, unknown>
    telemetryHints?: Record<string, unknown>
  }
  template?: string
  stack?: {
    backend?: string
    hosting?: string
    aiProvider?: string
  }
  visuals?: {
    uiLibrary?: string
    primaryColor?: string
    secondaryColor?: string
    accentColor?: string
  }
  generatedPlan?: {
    pages?: Array<{
      id?: string
      name: string
      route: string
      type?: string
      purpose?: string
    }>
    entities?: Array<{
      id?: string
      name: string
      fields?: string[]
    }>
  }
  promptSettings?: {
    model: string
    agentId: 'plan' | 'build' | 'assistant_general' | 'assistant_project' | 'explore' | 'review'
    surface: 'wizard' | 'builder' | 'assistant_panel' | 'assistant_project'
    variantId?: 'none' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh' | 'max'
    toolsEnabled?: boolean
    webSearchEnabled?: boolean
    providerOptions?: Record<string, unknown>
  }
}

interface ToolMeta extends MessageToolMeta {
  name: string
  displayName: string
  description: string
  inputSchema: Record<string, unknown>
  requiresApproval: boolean
  riskLevel: 'safe' | 'moderate' | 'dangerous'
  executionEnvironment: 'local' | 'server' | 'provider'
  provider?: 'openai' | 'google'
  toolType?: 'function' | 'provider' | 'dynamic'
  providerToolId?: string
  providerToolArgs?: Record<string, unknown>
  supportsDeferredResults?: boolean
}

interface ToolPart {
  type: string
  toolCallId?: string
  toolName?: string
  state?: string
  input?: Record<string, unknown>
  output?: unknown
  errorText?: string
  approval?: { id?: string }
}

interface BuilderTasksDataPart {
  type: 'data-builder-tasks'
  data?: {
    tasks?: unknown
    toolCallId?: string
    source?: string
  }
}

interface BuilderTerminalOutputState {
  id: string
  command: string
  stdout: string
  stderr: string
  startedAt: number
  endedAt: number | null
  exitCode: number | null
  timedOut: boolean
  cancelled: boolean
}

interface BuilderConversationProps {
  project: Project
  localPath: string
  previewUrl: string | null
  previewStatus: DevServerStatus
  latestDomSnapshot?: string | null
  stopRequestCount?: number
  onTasksUpdate: (tasks: BuildTask[]) => void
  onFileCreated: (file: { path: string; content: string }) => void
  onPreviewStartRequest?: (reason?: string) => void
  onComplete: () => void
  onError: (error: string) => void
  onBillingError?: (error: BillingErrorData | null) => void
  onSurfaceError?: (error: AiSurfaceErrorData | null) => void
  className?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

function normalizeBuildTaskStatus(value: unknown): BuildTask['status'] | null {
  if (typeof value !== 'string') return null

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[.\s-]+/g, '_')
    .replace(/^_+|_+$/g, '')

  if (normalized === 'pending' || normalized === 'todo' || normalized === 'not_started') {
    return 'pending'
  }
  if (
    normalized === 'in_progress' ||
    normalized === 'inprogress' ||
    normalized === 'active' ||
    normalized === 'working' ||
    normalized === 'current'
  ) {
    return 'in_progress'
  }
  if (
    normalized === 'completed' ||
    normalized === 'complete' ||
    normalized === 'done' ||
    normalized === 'finished'
  ) {
    return 'completed'
  }
  return null
}

function normalizeBuildTaskList(value: unknown): BuildTask[] | null {
  if (!Array.isArray(value)) return null

  const tasks: BuildTask[] = []
  for (const entry of value) {
    if (!isRecord(entry)) continue

    const contentCandidate =
      entry.content ?? entry.title ?? entry.task ?? entry.text ?? entry.name
    const content =
      typeof contentCandidate === 'string'
        ? contentCandidate.trim()
        : ''
    const status = normalizeBuildTaskStatus(entry.status)
    if (!content || !status) continue

    const activeFormCandidate =
      entry.activeForm ??
      entry.active_form ??
      entry.inProgressText ??
      entry.in_progress_text ??
      entry.progressLabel
    const activeForm =
      typeof activeFormCandidate === 'string' && activeFormCandidate.trim().length > 0
        ? activeFormCandidate.trim()
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

function parseTodowriteTaskArrayValue(value: unknown): BuildTask[] | null {
  const directTasks = normalizeBuildTaskList(value)
  if (directTasks !== null) return directTasks

  const parsedStringArray = parseJsonArrayLoose(value)
  if (parsedStringArray !== null) {
    return normalizeBuildTaskList(parsedStringArray)
  }

  return null
}

function parseTodowriteTasksPayload(input: Record<string, unknown>): BuildTask[] | null {
  for (const key of ['tasks', 'todos', 'steps', 'items', 'taskList', 'task_list']) {
    const parsedTasks = parseTodowriteTaskArrayValue(input[key])
    if (parsedTasks !== null) return parsedTasks
  }

  const fromTasksJson = parseTodowriteTaskArrayValue(input.tasks_json)
  if (fromTasksJson !== null) return fromTasksJson

  const fromTasksJsonCamel = parseTodowriteTaskArrayValue(input.tasksJson)
  if (fromTasksJsonCamel !== null) return fromTasksJsonCamel

  return null
}

function parseTodowriteTasksAny(value: unknown, depth = 0): BuildTask[] | null {
  if (depth > 2) return null

  const directTasks = parseTodowriteTaskArrayValue(value)
  if (directTasks !== null) return directTasks

  if (typeof value === 'string') {
    const trimmed = value.trim()
    if (!trimmed) return null
    try {
      return parseTodowriteTasksAny(JSON.parse(trimmed), depth + 1)
    } catch {
      return null
    }
  }

  if (!isRecord(value)) return null

  const directPayload = parseTodowriteTasksPayload(value)
  if (directPayload !== null) return directPayload

  for (const key of ['input', 'payload', 'args', 'arguments', 'data', 'value', 'result']) {
    const nestedTasks = parseTodowriteTasksAny(value[key], depth + 1)
    if (nestedTasks !== null) return nestedTasks
  }

  return null
}

const MAX_TERMINAL_OUTPUT_LENGTH = 60_000
const TERMINAL_TRUNCATION_MESSAGE = '\n...output truncated...\n'
const NATIVE_BUILD_COMMAND_PATTERNS: RegExp[] = [
  /\belectron\b/i,
  /\belectron-builder\b/i,
  /\breact-native\b/i,
  /\bexpo\b/i,
  /\bxcodebuild\b/i,
  /\bfastlane\b/i,
  /\bandroid\b/i,
  /\bgradle\b/i,
  /\bflutter\b/i,
  /\bswift\b/i,
]

function detectUnsupportedNativeBuildCommand(command: string): string | null {
  const normalized = command.trim()
  if (!normalized) return null

  for (const pattern of NATIVE_BUILD_COMMAND_PATTERNS) {
    if (pattern.test(normalized)) {
      return 'Current builder supports web projects only. Native desktop/mobile commands are not supported in this release.'
    }
  }

  return null
}

const truncateTerminalOutput = (output: string) => {
  if (output.length <= MAX_TERMINAL_OUTPUT_LENGTH) return output
  const tailLength = Math.max(0, MAX_TERMINAL_OUTPUT_LENGTH - TERMINAL_TRUNCATION_MESSAGE.length)
  return `${TERMINAL_TRUNCATION_MESSAGE}${output.slice(-tailLength)}`
}

const appendTerminalOutput = (current: string, chunk: string) =>
  truncateTerminalOutput(current + chunk)

function normalizePreviewBrowserAction(value: unknown): string {
  if (typeof value !== 'string' || value.trim().length === 0) {
    return 'snapshot'
  }

  const normalized = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '_')

  if (normalized === 'take_screenshot') return 'screenshot'
  if (normalized === 'press_key') return 'press'
  return normalized
}

function countsAsPreviewValidation(action: string): boolean {
  return action !== 'screenshot'
}

type ChatHookResult = ReturnType<typeof useCozeaChat>

export function BuilderConversation({
  project,
  localPath,
  previewUrl,
  previewStatus,
  latestDomSnapshot,
  stopRequestCount = 0,
  onTasksUpdate,
  onFileCreated,
  onPreviewStartRequest,
  onComplete,
  onError,
  onBillingError,
  onSurfaceError,
  className,
}: BuilderConversationProps) {
  const { accessToken, convexUserId } = useAuth()
  const { organizationId, workspaceScoped } = useAiExecutionScope({
    requireProjectAccess: true,
  })

  const acquireFileLock = useMutation(api.projectFileLocks.acquireLock)
  const releaseFileLock = useMutation(api.projectFileLocks.releaseLock)

  // State
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [toolsLoaded, setToolsLoaded] = useState(false)
  const [providerAuthRevision, setProviderAuthRevision] = useState(0)
  const [_billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const [conversationId] = useState(() => crypto.randomUUID())
  const hasSentInitialMessageRef = useRef(false)
  const completedRef = useRef(false)
  const previewMutationVersionRef = useRef(0)
  const previewValidatedVersionRef = useRef<number | null>(null)
  const lastPreviewUrlRef = useRef<string | null>(previewUrl)
  // Track active terminal sessions for live terminal rendering
  const [terminalSessions, setTerminalSessions] = useState<Map<string, string>>(new Map())
  const terminalListenerCleanupRef = useRef<Map<string, () => void>>(new Map())
  const terminalOutputByIdRef = useRef<Map<string, BuilderTerminalOutputState>>(new Map())
  const terminalSessionsRef = useRef<Map<string, string>>(new Map())

  const addToolOutputRef = useRef<ChatHookResult['addToolOutput'] | null>(null)
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})
  const lastTasksSignatureRef = useRef<string | null>(null)
  const latestTasksRef = useRef<BuildTask[]>([])
  const lastGeminiTodowriteLogSignatureRef = useRef<string | null>(null)
  const cancelledToolCallsRef = useRef<Set<string>>(new Set())
  const lastStopRequestCountRef = useRef(stopRequestCount)

  useEffect(() => {
    const listenerCleanupMap = terminalListenerCleanupRef.current
    const outputMap = terminalOutputByIdRef.current
    return () => {
      for (const cleanup of listenerCleanupMap.values()) {
        cleanup()
      }
      listenerCleanupMap.clear()
      outputMap.clear()
    }
  }, [])

  useEffect(() => {
    terminalSessionsRef.current = terminalSessions
  }, [terminalSessions])

  useEffect(() => {
    if (!window.electronAPI?.providerAuth?.onStatusChanged) return
    const unsubscribe = window.electronAPI.providerAuth.onStatusChanged(() => {
      setProviderAuthRevision((current) => current + 1)
    })
    return unsubscribe
  }, [])

  const markPreviewDirty = useCallback(() => {
    previewMutationVersionRef.current += 1
    previewValidatedVersionRef.current = null
  }, [])

  const markPreviewValidated = useCallback(() => {
    previewValidatedVersionRef.current = previewMutationVersionRef.current
  }, [])

  const getPreviewCompletionBlocker = useCallback((): string | null => {
    if (!previewUrl || previewStatus !== 'ready') {
      if (previewStatus === 'starting') {
        return 'Preview is still starting. Wait for it to load, then use preview_browser({ action: "snapshot" }) before calling build_complete.'
      }
      if (previewStatus === 'error' || previewStatus === 'unhealthy') {
        return 'Preview is not healthy yet. Fix the app so the live preview loads, then use preview_browser({ action: "snapshot" }) before calling build_complete.'
      }
      return 'Before calling build_complete, call preview_start, wait until the preview is ready, and use preview_browser({ action: "snapshot" }) to inspect the final UI.'
    }

    if (previewValidatedVersionRef.current !== previewMutationVersionRef.current) {
      return 'Before calling build_complete, run preview_browser on the latest preview state. Start with preview_browser({ action: "snapshot" }) and use the returned refs for any click/type checks you need.'
    }

    return null
  }, [previewStatus, previewUrl])

  useEffect(() => {
    if (previewStatus !== 'ready') {
      previewValidatedVersionRef.current = null
    }
  }, [previewStatus])

  useEffect(() => {
    if (previewUrl === lastPreviewUrlRef.current) return
    lastPreviewUrlRef.current = previewUrl
    previewValidatedVersionRef.current = null
  }, [previewUrl])

  const localRuntime = useMemo(() => new LocalAgentRuntime(), [])
  const preflightDiagnostic = useMemo(() => {
    const expected = {
      targetPlatform: 'web',
      buildContract: {
        previewMode: 'web',
        frameworkClass: 'web-framework',
      },
    }

    if (project.targetPlatform !== 'web') {
      return {
        code: 'BUILD_PRECHECK_TARGET_PLATFORM_MISMATCH',
        message: 'Current builder supports web projects only.',
        detail: undefined,
        expected,
        actual: {
          targetPlatform: project.targetPlatform,
          buildContract: project.buildContract ?? null,
        },
      }
    }

    const contractValidation = validateWebOnlyBuildContract(project.buildContract)
    if (!contractValidation.valid) {
      return {
        code: 'BUILD_PRECHECK_CONTRACT_INVALID',
        message: 'Current builder supports web projects only.',
        detail: contractValidation.error,
        expected,
        actual: {
          targetPlatform: project.targetPlatform,
          buildContract: project.buildContract ?? null,
        },
      }
    }

    return null
  }, [project.buildContract, project.targetPlatform])
  const preflightFailedRef = useRef(false)
  const promptSettings = project.promptSettings
  const initialGlobalModelSettings = useMemo(() => loadGlobalModelSettings(), [])
  const [catalogFallbackModel, setCatalogFallbackModel] = useState<string>('')
  const [resolvedRequestedModel, setResolvedRequestedModel] = useState<string>('')
  const [modelResolutionAttempted, setModelResolutionAttempted] = useState(false)
  const requestedModel =
    typeof promptSettings?.model === 'string' && promptSettings.model.trim().length > 0
      ? promptSettings.model
      : (initialGlobalModelSettings.model ?? '')
  const model = resolvedRequestedModel || requestedModel || catalogFallbackModel
  const hasModel = model.trim().length > 0
  const isGeminiModel = useMemo(() => {
    const normalizedModel = model.trim().toLowerCase()
    return inferProviderFromModelId(model) === 'google' || normalizedModel.includes('gemini')
  }, [model])
  console.log('[Builder] Project promptSettings:', promptSettings)
  console.log('[Builder] Using model:', model)
  // Builder execution is pinned to the project prompt settings.
  const enableTools = promptSettings?.toolsEnabled ?? true
  const enableWebSearch = promptSettings?.webSearchEnabled ?? true
  const variantId = promptSettings?.variantId
  const providerOptions = promptSettings?.providerOptions
  const {
    header: providerAuthHeader,
    resolved: providerAuthResolved,
  } = useProviderAuthResolution({
    organizationId,
    modelId: model,
    refreshKey: providerAuthRevision,
  })

  const headers = useMemo((): Record<string, string> => {
    if (!accessToken) return {}
    return { Authorization: `Bearer ${accessToken}` }
  }, [accessToken])

  const logGeminiTodowrite = useCallback((phase: string, payload: Record<string, unknown>) => {
    if (!isGeminiModel) return

    let signature: string
    try {
      signature = `${phase}:${JSON.stringify(payload)}`
    } catch {
      signature = `${phase}:unserializable`
    }

    if (lastGeminiTodowriteLogSignatureRef.current === signature) {
      return
    }
    lastGeminiTodowriteLogSignatureRef.current = signature

    console.debug('[Builder][Gemini][todowrite]', {
      model,
      phase,
      ...payload,
    })
  }, [isGeminiModel, model])

  useEffect(() => {
    let cancelled = false

    if (!accessToken || !organizationId) {
      setCatalogFallbackModel('')
      setResolvedRequestedModel('')
      setModelResolutionAttempted(false)
      return
    }

    setModelResolutionAttempted(false)
    getModelCatalog({
      organizationId,
      accessToken,
    })
      .then((data) => {
        if (cancelled) return
        const resolvedModelId = resolveModelIdFromCatalog(requestedModel, data.models)
        setResolvedRequestedModel(resolvedModelId ?? '')
        if (requestedModel) {
          setCatalogFallbackModel('')
          setModelResolutionAttempted(true)
          return
        }
        const fallback =
          data.models.find((candidate) => isManagedProvider(candidate.provider) && candidate.id.trim().length > 0)?.id
          ?? data.models.find((candidate) => candidate.id.trim().length > 0)?.id
          ?? ''
        setCatalogFallbackModel(fallback)
        setModelResolutionAttempted(true)
      })
      .catch((error) => {
        if (cancelled) return
        setCatalogFallbackModel('')
        setResolvedRequestedModel('')
        setModelResolutionAttempted(true)
        console.warn('Failed to resolve builder model from catalog:', error)
      })

    return () => {
      cancelled = true
    }
  }, [accessToken, organizationId, requestedModel])

  // Sync tools
  useEffect(() => {
    toolsByNameRef.current = Object.fromEntries(
      availableTools.map((tool) => [tool.name, tool])
    )
  }, [availableTools])

  // Fetch tools
  useEffect(() => {
    if (!accessToken || !organizationId || !hasModel) {
      setAvailableTools([])
      setToolsLoaded(false)
      return
    }

    setToolsLoaded(false)
    const controller = new AbortController()
    const query = new URLSearchParams({
      organizationId,
      model,
      agentId: 'build',
      surface: 'builder',
      hasProjectContext: localPath ? '1' : '0',
    })

    fetch(`${AI_BASE_URL}/tools?${query.toString()}`, {
      headers,
      signal: controller.signal,
    })
      .then(async (res) => {
        if (!res.ok) throw new Error('Failed to load tools')
        return res.json()
      })
      .then((data) => {
        if (!data?.tools) return
        setAvailableTools(data.tools as ToolMeta[])
      })
      .catch((err) => {
        if ((err as { name?: string }).name === 'AbortError') return
        console.warn('Failed to fetch tools:', err)
      })
      .finally(() => {
        if (controller.signal.aborted) return
        setToolsLoaded(true)
      })

    return () => controller.abort()
  }, [accessToken, organizationId, hasModel, headers, localPath, model])

  // Build initial prompt with full plan context
  const initialPrompt = useMemo(() => {
    const planContext = {
      name: project.name,
      template: project.template || 'custom',
      stack: project.stack || { backend: 'supabase', hosting: 'vercel', aiProvider: 'openai' },
      visuals: project.visuals || { uiLibrary: 'shadcn', primaryColor: '#6366f1' },
      pages: project.generatedPlan?.pages || [],
      entities: project.generatedPlan?.entities || [],
    }

    return `Build this project based on the approved plan:

Project: ${planContext.name}
Template: ${planContext.template}
Stack: ${JSON.stringify(planContext.stack, null, 2)}
Visuals: ${JSON.stringify(planContext.visuals, null, 2)}

Pages to create:
${JSON.stringify(planContext.pages, null, 2)}

Entities/Data models:
${JSON.stringify(planContext.entities, null, 2)}

IMPORTANT WORKFLOW - You MUST follow this pattern to update progress:
1. First call todowrite to define your task list with all tasks set to status: "pending"
2. Before starting each task, call todowrite with that task's status changed to "in_progress"
3. After completing each task, call todowrite with that task's status changed to "completed"
4. Repeat steps 2-3 for each task until all tasks are "completed"

This updates the progress UI so the user can track your work in real-time. The user sees your progress through the todowrite tool calls, so call it frequently!

Use todowrite with the "tasks" field. Only switch to "tasks_json" if the tool/schema explicitly rejects "tasks" and asks for a JSON string. Do not use "todos".

When the project should render something visible in the browser, call preview_start and continue building. Do this early once a basic shell, route, or page can render. Do not wait until the end.

Before build_complete, you MUST use preview_browser on the live preview after your latest code changes. Start with preview_browser({ action: "snapshot" }) to inspect the current UI and get fresh refs. If you need another route first, use preview_browser({ action: "snapshot", path: "/target-route" }).

Now begin by defining your task list with todowrite, then start working through them one by one, updating statuses as you go.`
  }, [project])

  const projectContextPayload = useMemo(() => ({
    name: project.name,
    slug: project.slug,
    runtime: 'local' as const,
    localPath: localPath || undefined,
    currentPage: null,
    inspectedElement: null,
  }), [project.name, project.slug, localPath])


  const shouldRequireLocalApproval = useCallback((toolMeta?: MessageToolMeta) => {
    if (!toolMeta) return false
    if (toolMeta.executionEnvironment !== 'local') return false
    // Builder profile always auto-executes local tools.
    return false
  }, [])

  const normalizeProjectPath = useCallback((filePath?: string) => {
    if (!filePath) return localPath
    if (localPath && filePath.startsWith(localPath)) {
      return filePath
    }
    if (!localPath) return filePath
    return `${localPath}/${filePath}`.replace(/\/+/g, '/')
  }, [localPath])

  const normalizeRelativeFilePath = useCallback((filePath: string) => {
    return filePath.replace(/\\/g, '/').replace(/^\/+/, '')
  }, [])

  const enrichToolOutputWithDiagnostics = useCallback(async (
    toolName: string,
    toolInput: Record<string, unknown> | null,
    output: unknown
  ) => {
    if (!localPath) return output

    if (!toolInput || !isFileMutatingTool(toolName)) return output

    const summary = await collectMutatingToolDiagnosticsSummary({
      projectPath: localPath,
      toolName,
      toolInput,
    })

    return attachToolDiagnosticsToOutput(output, summary)
  }, [localPath])

  const getFinalDiagnosticsSummary = useCallback(async () => {
    if (!localPath || !window.electronAPI?.diagnostics) return null

    const snapshot = await window.electronAPI.diagnostics.getSnapshot({ projectPath: localPath })
    if (!snapshot.success) return null

    const diagnostics = Array.isArray(snapshot.diagnostics)
      ? snapshot.diagnostics as PipelineDiagnostic[]
      : []

    return summarizeLintDiagnostics({
      projectPath: localPath,
      diagnostics,
      maxItems: 8,
    })
  }, [localPath])

  const commitTaskUpdate = useCallback((tasks: BuildTask[]) => {
    let signature: string | null = null
    try {
      signature = JSON.stringify(tasks)
    } catch {
      signature = null
    }

    latestTasksRef.current = tasks

    if (signature && signature === lastTasksSignatureRef.current) {
      return false
    }

    lastTasksSignatureRef.current = signature
    onTasksUpdate(tasks)
    return true
  }, [onTasksUpdate])

  const finalizeIfTasksCompleted = useCallback(async (tasks: BuildTask[]) => {
    const allCompleted = tasks.length > 0 && tasks.every((task) => task.status === 'completed')
    if (!allCompleted) {
      return null
    }

    return {
      finalDiagnostics: await getFinalDiagnosticsSummary(),
      previewCompletionBlocker: getPreviewCompletionBlocker(),
    }
  }, [getFinalDiagnosticsSummary, getPreviewCompletionBlocker])

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
    project._id,
    releaseFileLock,
  ])

  const runLocalTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    input: unknown
  ) => {
    if (cancelledToolCallsRef.current.has(toolCallId)) return

    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const normalizedInput = normalizeToolInput(toolName, input)
    const toolInput = isRecord(normalizedInput) ? normalizedInput : null

    const toolMeta = toolsByNameRef.current[toolName]
    const isBuilderWorkflowTool = BUILDER_WORKFLOW_FALLBACK_TOOLS.has(toolName)
    if (!isBuilderWorkflowTool && toolMeta?.executionEnvironment && toolMeta.executionEnvironment !== 'local') {
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
        if (toolName === 'todowrite') {
          logGeminiTodowrite('validation_failed', {
            toolCallId,
            input,
            normalizedInput,
            validationError: validation.error,
          })
        }
        void addToolOutput({
          state: 'output-error',
          tool: toolName,
          toolCallId,
          errorText: validation.error,
        })
        return
      }
    }

    try {
      if (toolName === 'todowrite') {
        const tasks = parseTodowriteTasksAny(normalizedInput)
        logGeminiTodowrite('run_local_tool', {
          toolCallId,
          input,
          normalizedInput,
          parsedTasks: tasks,
        })
        if (tasks === null) {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: 'todowrite failed: provide tasks, or use valid tasks_json only if the provider requires a JSON string.',
          })
          return
        }

        commitTaskUpdate(tasks)
        const completionState = await finalizeIfTasksCompleted(tasks)

        const outputPayload = {
          success: true,
          taskCount: tasks.length,
          tasks,
          ...(completionState?.finalDiagnostics ? { diagnostics: completionState.finalDiagnostics } : {}),
          ...(completionState
            ? { readyForBuildComplete: !completionState.previewCompletionBlocker }
            : {}),
          ...(completionState?.previewCompletionBlocker
            ? { nextStep: completionState.previewCompletionBlocker }
            : {}),
        }

        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: JSON.stringify(outputPayload),
        })
        return
      }

      if (toolName === 'build_complete') {
        const currentTasks = latestTasksRef.current
        if (currentTasks.length === 0) {
          logGeminiTodowrite('build_complete_blocked_missing_tasks', {
            toolCallId,
            input,
          })
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: 'Before calling build_complete, call todowrite with your task list in the tasks field and update progress as you work.',
          })
          return
        }

        const incompleteTasks = currentTasks.filter((task) => task.status !== 'completed')
        if (incompleteTasks.length > 0) {
          logGeminiTodowrite('build_complete_blocked_incomplete_tasks', {
            toolCallId,
            input,
            currentTasks,
            incompleteCount: incompleteTasks.length,
          })
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: `Before calling build_complete, update todowrite so all tasks are completed. ${incompleteTasks.length} task(s) are still pending or in progress.`,
          })
          return
        }

        const previewCompletionBlocker = getPreviewCompletionBlocker()
        if (previewCompletionBlocker) {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: previewCompletionBlocker,
          })
          return
        }

        const summary = toolInput && typeof toolInput.summary === 'string' ? toolInput.summary : undefined
        console.log('[Builder] build_complete called with summary:', summary)
        const finalDiagnostics = await getFinalDiagnosticsSummary()
        if (!completedRef.current) {
          completedRef.current = true
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({
              success: true,
              message: 'Build marked as complete',
              ...(finalDiagnostics ? { diagnostics: finalDiagnostics } : {}),
            }),
          })
          setTimeout(() => onComplete(), 500)
        } else {
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({
              success: true,
              message: 'Build was already completed',
              ...(finalDiagnostics ? { diagnostics: finalDiagnostics } : {}),
            }),
          })
        }
        return
      }

      if (toolName === 'preview_start') {
        const reason =
          toolInput && typeof toolInput.reason === 'string' && toolInput.reason.trim().length > 0
            ? toolInput.reason.trim()
            : undefined

        markPreviewDirty()
        onPreviewStartRequest?.(reason)
        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: JSON.stringify({
            success: true,
            started: true,
            message: 'Preview start requested',
            ...(reason ? { reason } : {}),
          }),
        })
        return
      }

      if (toolName === 'preview_browser') {
        const action = normalizePreviewBrowserAction(toolInput?.action)
        if (!previewUrl || previewStatus !== 'ready') {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: getPreviewCompletionBlocker() ?? 'Preview is not ready yet.',
          })
          return
        }

        const runtimeResult = await localRuntime.requestToolExecution(conversationId, {
          toolName,
          input: {
            ...(toolInput ?? {}),
            currentUrl: previewUrl,
          },
          projectPath: localPath,
          toolCallId,
        })

        if (cancelledToolCallsRef.current.has(toolCallId)) return
        if (!runtimeResult.success) {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: runtimeResult.error || 'Preview inspection failed',
          })
          return
        }

        if (countsAsPreviewValidation(action)) {
          markPreviewValidated()
        }

        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: runtimeResult.output,
        })
        return
      }

      if (toolName === 'write') {
        if (!toolInput || typeof toolInput.filePath !== 'string' || typeof toolInput.content !== 'string') {
          throw new Error('write requires filePath and content')
        }
        const filePath = toolInput.filePath
        const content = toolInput.content
        await withFileLocks([toolInput.filePath], async () => {
          const result = await window.electronAPI.project.writeFile({
            projectPath: localPath,
            filePath,
            content,
          })

          if (!result.success) {
            throw new Error(result.error || 'Failed to create file')
          }

          onFileCreated({ path: filePath, content })
          markPreviewDirty()
          const enrichedOutput = await enrichToolOutputWithDiagnostics(
            toolName,
            toolInput,
            { success: true, path: filePath }
          )
          if (cancelledToolCallsRef.current.has(toolCallId)) return
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify(enrichedOutput),
          })
        })
        return
      }

      if (toolName === 'read') {
        if (!toolInput || typeof toolInput.filePath !== 'string') {
          throw new Error('read requires filePath')
        }
        const result = await window.electronAPI.project.readFile({
          projectPath: localPath,
          filePath: toolInput.filePath,
        })
        if (result.success) {
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: result.content || '',
          })
        } else {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: result.error || 'File not found',
          })
        }
        return
      }

      if (toolName === 'list') {
        const targetPath = normalizeProjectPath(
          typeof toolInput?.path === 'string' ? toolInput.path : ''
        )
        const entries = await window.electronAPI.fs.readDir(targetPath || localPath)
        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: JSON.stringify(entries || []),
        })
        return
      }

      if (toolName === 'edit') {
        if (
          !toolInput ||
          typeof toolInput.filePath !== 'string' ||
          typeof toolInput.oldString !== 'string' ||
          typeof toolInput.newString !== 'string'
        ) {
          throw new Error('edit requires filePath, oldString, and newString')
        }
        const filePath = toolInput.filePath
        const oldString = toolInput.oldString
        const newString = toolInput.newString
        await withFileLocks([toolInput.filePath], async () => {
          const result = await window.electronAPI.project.readFile({
            projectPath: localPath,
            filePath,
          })
          if (!result.success || result.content === undefined) {
            throw new Error(result.error || 'File not found')
          }
          const content = result.content
          const occurrences = content.split(oldString).length - 1
          if (occurrences === 0) {
            throw new Error('Old string not found in file')
          }
          if (occurrences > 1) {
            throw new Error('Old string must match exactly one occurrence')
          }
          const updated = content.replace(oldString, newString)
          const writeResult = await window.electronAPI.project.writeFile({
            projectPath: localPath,
            filePath,
            content: updated,
          })
          if (!writeResult.success) {
            throw new Error(writeResult.error || 'Failed to write file')
          }
          markPreviewDirty()
          const enrichedOutput = await enrichToolOutputWithDiagnostics(
            toolName,
            toolInput,
            { filePath, replacements: 1 }
          )
          if (cancelledToolCallsRef.current.has(toolCallId)) return
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify(enrichedOutput),
          })
        })
        return
      }

      if (toolName === 'multiedit') {
        interface EditInput {
          filePath: string
          oldString: string
          newString: string
          replaceAll?: boolean
        }
        const defaultFilePath =
          typeof toolInput?.filePath === 'string' && toolInput.filePath.trim().length > 0
            ? toolInput.filePath
            : null
        const edits = Array.isArray(toolInput?.edits)
          ? toolInput.edits
          : Array.isArray(toolInput?.replacements)
            ? toolInput.replacements
            : []
        const normalizedEdits: EditInput[] = []
        for (const edit of edits) {
          if (!isRecord(edit)) continue
          const resolvedFilePath =
            typeof edit.filePath === 'string' && edit.filePath.trim().length > 0
              ? edit.filePath
              : defaultFilePath
          const oldString = edit.oldString
          const newString = edit.newString
          if (
            typeof resolvedFilePath !== 'string' ||
            typeof oldString !== 'string' ||
            typeof newString !== 'string'
          ) {
            continue
          }
          normalizedEdits.push({
            filePath: resolvedFilePath,
            oldString,
            newString,
            replaceAll: typeof edit.replaceAll === 'boolean' ? edit.replaceAll : undefined,
          })
        }

        if (normalizedEdits.length === 0) {
          throw new Error('multiedit requires filePath and at least one valid edit operation')
        }

        const paths = normalizedEdits.map((edit) => edit.filePath)
        await withFileLocks(paths, async () => {
          const results: Array<{ filePath: string; replacements: number }> = []
          for (const edit of normalizedEdits) {
            const readResult = await window.electronAPI.project.readFile({
              projectPath: localPath,
              filePath: edit.filePath,
            })
            if (!readResult.success || readResult.content === undefined) {
              throw new Error(readResult.error || `File not found: ${edit.filePath}`)
            }
            const content = readResult.content
            if (edit.oldString.length === 0) {
              throw new Error(`oldString must be non-empty for file: ${edit.filePath}`)
            }
            const occurrences = content.split(edit.oldString).length - 1
            if (occurrences === 0) {
              throw new Error(`Old string not found in file: ${edit.filePath}`)
            }
            if (!edit.replaceAll && occurrences > 1) {
              throw new Error(`Old string must match exactly one occurrence in file: ${edit.filePath}`)
            }
            const updated = edit.replaceAll
              ? content.split(edit.oldString).join(edit.newString)
              : content.replace(edit.oldString, edit.newString)
            const replacementCount = edit.replaceAll ? occurrences : 1
            const writeResult = await window.electronAPI.project.writeFile({
              projectPath: localPath,
              filePath: edit.filePath,
              content: updated,
            })
            if (!writeResult.success) {
              throw new Error(writeResult.error || `Failed to write file: ${edit.filePath}`)
            }
            results.push({ filePath: edit.filePath, replacements: replacementCount })
          }
          markPreviewDirty()
          const enrichedOutput = await enrichToolOutputWithDiagnostics(
            toolName,
            toolInput,
            { results }
          )
          if (cancelledToolCallsRef.current.has(toolCallId)) return
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify(enrichedOutput),
          })
        })
        return
      }

      if (toolName === 'bash') {
        const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : ''
        const description = toolInput && typeof toolInput.description === 'string' ? toolInput.description : ''
        if (!command) {
          throw new Error('bash requires command')
        }
        if (!description.trim()) {
          throw new Error('bash requires description')
        }
        const unsupportedNativeMessage = detectUnsupportedNativeBuildCommand(command)
        if (unsupportedNativeMessage) {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: unsupportedNativeMessage,
          })
          return
        }
      }

      if (!toolInput) {
        void addToolOutput({
          state: 'output-error',
          tool: toolName,
          toolCallId,
          errorText: 'Tool input must be an object.',
        })
        return
      }

      const runtimeResult = await localRuntime.requestToolExecution(conversationId, {
        toolName,
        input: toolInput,
        projectPath: localPath,
        toolCallId,
      })

      if (cancelledToolCallsRef.current.has(toolCallId)) return
      if (runtimeResult.success) {
        if (toolName === 'bash') {
          markPreviewDirty()
        }
        const enrichedOutput = await enrichToolOutputWithDiagnostics(
          toolName,
          toolInput,
          runtimeResult.output
        )
        if (cancelledToolCallsRef.current.has(toolCallId)) return
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
          errorText: runtimeResult.error || 'Tool failed',
        })
      }
    } catch (err) {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: err instanceof Error ? err.message : 'Tool failed',
      })
    }
  }, [
    commitTaskUpdate,
    conversationId,
    enrichToolOutputWithDiagnostics,
    finalizeIfTasksCompleted,
    logGeminiTodowrite,
    localPath,
    localRuntime,
    markPreviewDirty,
    markPreviewValidated,
    normalizeProjectPath,
    onComplete,
    onFileCreated,
    onPreviewStartRequest,
    onTasksUpdate,
    getFinalDiagnosticsSummary,
    getPreviewCompletionBlocker,
    previewStatus,
    previewUrl,
    withFileLocks,
  ])

  const handleApprovedTool = useCallback(async (
    toolName: string,
    toolCallId: string,
    input: unknown
  ) => {
    await runLocalTool(toolName, toolCallId, input)
  }, [runLocalTool])

  const handleDeniedTool = useCallback(async (
    toolName: string,
    toolCallId: string
  ) => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return
    void addToolOutput({
      state: 'output-error',
      tool: toolName,
      toolCallId,
      errorText: 'User denied tool execution',
    })
  }, [])

  // Handle tool calls with assistant-style local execution rules.
  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: ToolCallPayload }) => {
    if (toolCall?.toolName === 'todowrite') {
      const normalizedInput = normalizeToolInput('todowrite', toolCall.input)
      const parsedTasks = parseTodowriteTasksAny(normalizedInput)
      logGeminiTodowrite('tool_call_received', {
        toolCallId: toolCall.toolCallId,
        input: toolCall.input,
        normalizedInput,
        parsedTasks,
        dynamic: toolCall.dynamic === true,
        providerExecuted: toolCall.providerExecuted === true,
      })
      if (parsedTasks !== null) {
        commitTaskUpdate(parsedTasks)
        void finalizeIfTasksCompleted(parsedTasks)
      }
    }
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const { toolName, input, toolCallId } = toolCall
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const currentTasks = latestTasksRef.current
    const requiresInitialTodowrite =
      toolName !== 'todowrite' &&
      toolName !== 'build_complete' &&
      currentTasks.length === 0
    if (requiresInitialTodowrite) {
      logGeminiTodowrite('blocked_until_initial_todowrite', {
        toolCallId,
        toolName,
        input,
      })
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: 'Before using other tools, call todowrite with your full task list in the tasks field and mark the first task as in_progress.',
      })
      return
    }

    const toolMeta = toolsByNameRef.current[toolName]
    const isBuilderWorkflowTool = BUILDER_WORKFLOW_FALLBACK_TOOLS.has(toolName)
    const isLocalTool = isBuilderWorkflowTool || toolMeta?.executionEnvironment === 'local'

    if (!isLocalTool) {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: toolMeta
          ? 'Tool is not available in the builder local runtime.'
          : `Unknown tool: ${toolName}`,
      })
      return
    }

    if (!isBuilderWorkflowTool && shouldRequireLocalApproval(toolMeta)) {
      void addToolOutput({
        state: 'output-error',
        tool: toolName,
        toolCallId,
        errorText: 'Tool execution requires approval and is not supported in this builder flow.',
      })
      return
    }

    await runLocalTool(toolName, toolCallId, input)
  }, [
    commitTaskUpdate,
    finalizeIfTasksCompleted,
    logGeminiTodowrite,
    runLocalTool,
    shouldRequireLocalApproval,
  ])

  // useChat hook
  const {
    status,
    error,
    sendMessage,
    stop,
    addToolOutput,
    dedupedMessages,
    retryHint: hookRetryHint,
    autoRetryState,
  } = useCozeaChat({
    transportArgs: {
      accessToken,
      organizationId,
      model,
      conversationId,
      agentId: 'build',
      surface: 'builder',
      variantId,
      enableTools,
      enableWebSearch,
      extraBody: {
        projectContext: projectContextPayload,
        latestDomSnapshot,
        ...(providerOptions ? { providerOptions } : {}),
      },
      providerAuthHeader,
    },
    autoRetry: {
      enabled: true,
      maxAttempts: 2,
      initialDelayMs: 2000,
      maxDelayMs: 30000,
      backoffFactor: 2,
    },
    chatOptions: {
      onToolCall: handleToolCall,
    },
    onBillingError: (err) => {
      onBillingError?.(err)
      onError(err.title || 'Billing Error')
    },
  })

  const retrySurfaceError = useMemo(() => getRetryHintSurfaceError(hookRetryHint), [hookRetryHint])

  useEffect(() => {
    onSurfaceError?.(retrySurfaceError)
  }, [onSurfaceError, retrySurfaceError])

  addToolOutputRef.current = addToolOutput

  const cancelPendingToolOutputs = useCallback((reasonText: string) => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const pendingToolCalls = new Map<string, { toolName: string; toolCallId: string }>()

    for (const message of dedupedMessages) {
      if (message.role !== 'assistant') continue
      if (!Array.isArray(message.parts)) continue

      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) continue

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
        errorText: reasonText,
      })
    }
  }, [dedupedMessages])

  const cancelActiveTerminalSessions = useCallback(async () => {
    const activeEntries = Array.from(terminalSessionsRef.current.entries())
    if (activeEntries.length === 0) return

    for (const [toolCallId, terminalId] of activeEntries) {
      cancelledToolCallsRef.current.add(toolCallId)
      const session = terminalOutputByIdRef.current.get(terminalId)
      if (session) {
        session.endedAt = Date.now()
        session.exitCode = -1
        session.cancelled = true
        session.stdout = appendTerminalOutput(session.stdout, '\n[Process cancelled by user]')
      }
      terminalListenerCleanupRef.current.get(toolCallId)?.()
    }

    await Promise.allSettled(
      activeEntries.map(([, terminalId]) => window.electronAPI.terminal.kill({ terminalId }))
    )

    setTerminalSessions(new Map())
  }, [])

  useEffect(() => {
    if (!modelResolutionAttempted) return
    if (hasModel) return
    if (preflightFailedRef.current) return
    preflightFailedRef.current = true
    completedRef.current = true
    onError('Build preflight failed: no AI models are available for this workspace.')
  }, [hasModel, modelResolutionAttempted, onError])

  useEffect(() => {
    if (stopRequestCount === lastStopRequestCountRef.current) return
    lastStopRequestCountRef.current = stopRequestCount

    cancelPendingToolOutputs('Cancelled by user.')
    void cancelActiveTerminalSessions()
    void localRuntime.cancelRun(conversationId)
    stop()
  }, [cancelActiveTerminalSessions, cancelPendingToolOutputs, conversationId, localRuntime, stop, stopRequestCount])

  // Send initial message on mount
  useEffect(() => {
    if (preflightDiagnostic) return
    if (!hasModel) return
    if (!providerAuthResolved) return
    if (!toolsLoaded) return
    if (!hasSentInitialMessageRef.current && accessToken && organizationId && project._id) {
      hasSentInitialMessageRef.current = true
      void sendMessage({ text: initialPrompt })
    }
  }, [
    accessToken,
    organizationId,
    initialPrompt,
    hasModel,
    preflightDiagnostic,
    project._id,
    providerAuthResolved,
    toolsLoaded,
    sendMessage,
  ])

  useEffect(() => {
    if (!preflightDiagnostic || preflightFailedRef.current) return
    preflightFailedRef.current = true
    completedRef.current = true
    console.error('[Builder] Build preflight failed', preflightDiagnostic)
    onError(
      `Build preflight failed (${preflightDiagnostic.code}): ${preflightDiagnostic.message}` +
      (preflightDiagnostic.detail ? ` ${preflightDiagnostic.detail}` : '')
    )
  }, [onError, preflightDiagnostic])

  // Track error state and defer propagation while shared auto-retry is scheduled.
  useEffect(() => {
    if (!error) return

    const billingErr = parseBillingError(error, {
      workspaceScoped,
    })
    if (billingErr) {
      setBillingError(billingErr)
      onBillingError?.(billingErr)
      onError(billingErr.title || 'Billing Error')
      return
    }

    if (autoRetryState.scheduled) {
      return
    }

    if (retrySurfaceError) {
      onError(retrySurfaceError.message)
      return
    }

    const message = error instanceof Error
      ? error.message
      : typeof error === 'string'
        ? error
        : 'Build failed'

    if (hookRetryHint?.code === 'duplicate_response_item_id' && autoRetryState.exhausted) {
      onError('Build paused: provider rejected duplicated response item IDs. Please retry once to continue.')
      return
    }

    if (autoRetryState.exhausted && hookRetryHint?.retryable) {
      onError(`${message} (automatic retries exhausted)`)
      return
    }

    onError(message)
  }, [
    autoRetryState.exhausted,
    autoRetryState.scheduled,
    error,
    hookRetryHint,
    onBillingError,
    onError,
    onSurfaceError,
    retrySurfaceError,
    workspaceScoped,
  ])

  // Fallback: extract todowrite updates directly from streamed messages
  useEffect(() => {
    let latestTasks: BuildTask[] | null = null

    for (let i = dedupedMessages.length - 1; i >= 0; i -= 1) {
      const message = dedupedMessages[i]
      if (message.role !== 'assistant') continue
      for (let partIndex = message.parts.length - 1; partIndex >= 0; partIndex -= 1) {
        const part = message.parts[partIndex]
        if (part.type === 'data-builder-tasks') {
          const data = (part as BuilderTasksDataPart).data
          const streamedTasks = parseTodowriteTasksAny(data?.tasks ?? data)
          if (streamedTasks !== null) {
            latestTasks = streamedTasks
            break
          }
        }

        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
          continue
        }
        const toolPart = part as ToolPart
        const toolName = part.type === 'dynamic-tool'
          ? toolPart.toolName
          : part.type.replace(/^tool-/, '')
        if (toolName !== 'todowrite') continue

        logGeminiTodowrite('streamed_tool_part', {
          messageId: message.id,
          partType: part.type,
          state: toolPart.state ?? 'input-streaming',
          input: toolPart.input,
          output: toolPart.output,
        })

        const inputTasks = parseTodowriteTasksAny(toolPart.input)
        if (inputTasks !== null) {
          latestTasks = inputTasks
          break
        }

        if (typeof toolPart.output === 'string') {
          try {
            const parsed = JSON.parse(toolPart.output)
            const parsedTasks = parseTodowriteTasksAny(parsed)
            if (parsedTasks !== null) {
              latestTasks = parsedTasks
              break
            }
          } catch {
            // ignore parse errors
          }
        } else {
          const outputTasks = parseTodowriteTasksAny(toolPart.output)
          if (outputTasks !== null) {
            latestTasks = outputTasks
            break
          }
        }
      }
      if (latestTasks) break
    }

    if (latestTasks) {
      commitTaskUpdate(latestTasks)
      const allCompleted = latestTasks.length > 0 && latestTasks.every((task) => task.status === 'completed')
      console.log('[Builder] Task completion check:', {
        taskCount: latestTasks.length,
        allCompleted,
        completedRefCurrent: completedRef.current,
        statuses: latestTasks.map((task) => task.status),
      })
      void finalizeIfTasksCompleted(latestTasks)
    }
  }, [commitTaskUpdate, dedupedMessages, finalizeIfTasksCompleted, logGeminiTodowrite])

  const toolsByName = useMemo(() => {
    const map = new Map<string, MessageToolMeta>()
    for (const tool of availableTools) {
      map.set(tool.name, {
        displayName: tool.displayName,
        toolType: tool.toolType ?? 'function',
        requiresApproval: tool.requiresApproval,
        executionEnvironment: tool.executionEnvironment,
      })
    }
    return map
  }, [availableTools])

  const hasPendingToolCalls = useMemo(() => {
    for (const message of dedupedMessages) {
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
  }, [dedupedMessages])

  const isLoading = status === 'streaming' || status === 'submitted' || hasPendingToolCalls
  const setAgentWorking = useCollaborationActivityStore(
    (state) => state.actions.setAgentWorking
  )

  useEffect(() => {
    setAgentWorking(isLoading)
    return () => {
      setAgentWorking(false)
    }
  }, [isLoading, setAgentWorking])

  // Filter out the initial plan prompt message (first user message with plan context)
  const visibleMessages = useMemo(() => {
    return dedupedMessages.filter((message, index) => {
      // Hide the first user message (the auto-sent plan prompt)
      if (message.role === 'user' && index === 0) {
        return false
      }
      return true
    })
  }, [dedupedMessages])

  return (
    <div className={cn('flex flex-col overflow-hidden w-full', className)}>
      <div className="flex-1 min-h-0 relative w-full">
        {/* Top fade */}
        <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />
        <Conversation className="h-full">
          <ConversationContent className="w-full max-w-2xl mx-auto px-3 pt-4 pb-24">
            {visibleMessages.map((message) => (
              <MessageBubble
                key={message.id}
                message={message}
                toolsByName={toolsByName}
                status={status}
                shouldRequireLocalApproval={shouldRequireLocalApproval}
                onApproveTool={handleApprovedTool}
                onDenyTool={handleDeniedTool}
                terminalSessions={terminalSessions}
                projectPath={localPath}
              />
            ))}
            {isLoading && (
              <div className="flex items-center gap-2 text-muted-foreground py-2">
                <Loader className="h-4 w-4" />
                <span className="text-sm">Building</span>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton className="bottom-24" />
        </Conversation>
      </div>
    </div>
  )
}
