import { useEffect, useRef, useState, useMemo, useCallback } from 'react'
import { useChat } from '@ai-sdk/react'
import { useMutation } from 'convex/react'
import {
  DefaultChatTransport,
  lastAssistantMessageIsCompleteWithToolCalls,
  lastAssistantMessageIsCompleteWithApprovalResponses,
} from 'ai'
import { cn } from '@/lib/utils'
import { useAuth } from '@/contexts/AuthContext'
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
import { AI_API_URL, AI_BASE_URL } from '@/lib/ai/apiEndpoints'
import { buildEncodedProviderAuthHeader, inferProviderFromModelId } from '@/lib/ai/providerAuth'
import { DEFAULT_MODELS } from '@/lib/ai/defaultModels'
import { validateWebOnlyBuildContract } from '@/lib/plan'
import {
  attachToolDiagnosticsToOutput,
  collectToolDiagnosticsSummary,
  summarizeLintDiagnostics,
  type PipelineDiagnostic,
} from '@/lib/diagnostics/toolDiagnosticsPipeline'
import type { ToolCallPayload } from '@/lib/ai/toolTypes'

// Builder-specific tools that should always be executed locally
// These are defined inline on the server but not in Convex's tools table
const BUILDER_LOCAL_TOOLS = new Set([
  'todowrite',
  'build_complete',
  'write',
  'read',
  'list',
  'bash',
  'get_terminal_output',
  'install_dependencies',
  'verify_build',
  'start_dev_server',
  'edit',
  'multiedit',
])

const FALLBACK_MODEL_BY_PROVIDER: Record<'anthropic' | 'openai' | 'google', string> = {
  anthropic: 'claude-sonnet-4-5',
  openai: 'gpt-5.2-codex',
  google: 'gemini-3-pro',
}

function resolveFallbackModel(aiProvider?: string): string {
  if (aiProvider === 'anthropic' || aiProvider === 'openai' || aiProvider === 'google') {
    return FALLBACK_MODEL_BY_PROVIDER[aiProvider]
  }
  return DEFAULT_MODELS[0]?.id ?? 'claude-sonnet-4-5'
}

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
  provider?: 'anthropic' | 'openai' | 'google'
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
  stopRequestCount?: number
  onTasksUpdate: (tasks: BuildTask[]) => void
  onFileCreated: (file: { path: string; content: string }) => void
  onComplete: () => void
  onError: (error: string) => void
  onBillingError?: (error: BillingErrorData | null) => void
  className?: string
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value)

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

type TerminalExecutionStatus = 'running' | 'completed' | 'failed' | 'timed_out' | 'cancelled'

function getTerminalExecutionState(args: {
  running: boolean
  exitCode: number | null
  timedOut: boolean
  cancelled: boolean
}): { success: boolean; status: TerminalExecutionStatus; error?: string } {
  if (args.running) {
    return { success: true, status: 'running' }
  }
  if (args.cancelled) {
    return {
      success: false,
      status: 'cancelled',
      error: 'Command was cancelled by user.',
    }
  }
  if (args.timedOut) {
    return {
      success: false,
      status: 'timed_out',
      error: 'Command timed out before completion.',
    }
  }
  if (typeof args.exitCode === 'number' && args.exitCode !== 0) {
    return {
      success: false,
      status: 'failed',
      error: `Command exited with code ${args.exitCode}.`,
    }
  }
  return { success: true, status: 'completed' }
}

type ChatHookResult = ReturnType<typeof useChat>

export function BuilderConversation({
  project,
  localPath,
  stopRequestCount = 0,
  onTasksUpdate,
  onFileCreated,
  onComplete,
  onError,
  onBillingError,
  className,
}: BuilderConversationProps) {
  const { accessToken, currentOrganization, convexUserId } = useAuth()

  const acquireFileLock = useMutation(api.projectFileLocks.acquireLock)
  const releaseFileLock = useMutation(api.projectFileLocks.releaseLock)

  // State
  const [availableTools, setAvailableTools] = useState<ToolMeta[]>([])
  const [providerAuthHeader, setProviderAuthHeader] = useState<string | null>(null)
  const [providerAuthResolved, setProviderAuthResolved] = useState(false)
  const [_billingError, setBillingError] = useState<BillingErrorData | null>(null)
  const [conversationId] = useState(() => crypto.randomUUID())
  const hasSentInitialMessageRef = useRef(false)
  const completedRef = useRef(false)
  // Track active terminal sessions for live terminal rendering
  const [terminalSessions, setTerminalSessions] = useState<Map<string, string>>(new Map())
  const terminalListenerCleanupRef = useRef<Map<string, () => void>>(new Map())
  const terminalOutputByIdRef = useRef<Map<string, BuilderTerminalOutputState>>(new Map())
  const terminalSessionsRef = useRef<Map<string, string>>(new Map())

  const addToolOutputRef = useRef<ChatHookResult['addToolOutput'] | null>(null)
  const toolsByNameRef = useRef<Record<string, ToolMeta>>({})
  const lastTasksSignatureRef = useRef<string | null>(null)
  const cancelledToolCallsRef = useRef<Set<string>>(new Set())
  const userStoppedRef = useRef(false)
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

  // Auto-continuation refs (defined early for use in error handling)
  const latestTasksRef = useRef<BuildTask[]>([])
  const continuationSentRef = useRef(false)
  const continuationCountRef = useRef(0)
  const MAX_CONTINUATIONS = 50 // Safety limit to prevent infinite loops

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
  const fallbackModel = resolveFallbackModel(project.stack?.aiProvider)
  const requestedModel =
    typeof promptSettings?.model === 'string' && promptSettings.model.trim().length > 0
      ? promptSettings.model
      : fallbackModel
  const model = requestedModel
  console.log('[Builder] Project promptSettings:', promptSettings)
  console.log('[Builder] Using model:', model)
  // Builder execution is pinned to the project prompt settings.
  const enableTools = promptSettings?.toolsEnabled ?? true
  const enableWebSearch = promptSettings?.webSearchEnabled ?? true
  const variantId = promptSettings?.variantId ?? 'medium'
  const providerOptions = promptSettings?.providerOptions

  const headers = useMemo((): Record<string, string> => {
    if (!accessToken) return {}
    return { Authorization: `Bearer ${accessToken}` }
  }, [accessToken])

  useEffect(() => {
    let cancelled = false
    const organizationId = currentOrganization?.organizationId
    if (!organizationId) {
      setProviderAuthHeader(null)
      setProviderAuthResolved(false)
      return
    }

    const provider = inferProviderFromModelId(model)
    if (!provider) {
      setProviderAuthHeader(null)
      setProviderAuthResolved(true)
      return
    }

    setProviderAuthResolved(false)
    void (async () => {
      const maxAttempts = 4
      for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
        const result = await buildEncodedProviderAuthHeader({
          provider,
          modelId: model,
          organizationId,
        })
        if (cancelled) return
        if (result.header) {
          setProviderAuthHeader(result.header)
          setProviderAuthResolved(true)
          return
        }

        setProviderAuthHeader(null)
        if (attempt < maxAttempts - 1) {
          await new Promise((resolve) => setTimeout(resolve, 250 * (attempt + 1)))
        }
      }

      if (cancelled) return
      setProviderAuthResolved(true)
    })()

    return () => {
      cancelled = true
    }
  }, [model, currentOrganization?.organizationId])

  // Sync tools
  useEffect(() => {
    toolsByNameRef.current = Object.fromEntries(
      availableTools.map((tool) => [tool.name, tool])
    )
  }, [availableTools])

  // Fetch tools
  useEffect(() => {
    if (!accessToken || !currentOrganization?.organizationId) return
    const controller = new AbortController()
    const query = new URLSearchParams({
      organizationId: currentOrganization.organizationId,
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

    return () => controller.abort()
  }, [accessToken, currentOrganization?.organizationId, headers, localPath, model])

  // Request config ref
  const requestConfigRef = useRef({
    accessToken,
    organizationId: currentOrganization?.organizationId || null,
    projectId: project._id,
    conversationId,
    providerAuthHeader,
  })

  useEffect(() => {
    requestConfigRef.current = {
      accessToken,
      organizationId: currentOrganization?.organizationId || null,
      projectId: project._id,
      conversationId,
      providerAuthHeader,
    }
  }, [accessToken, currentOrganization?.organizationId, project._id, conversationId, providerAuthHeader])

  // Build initial prompt with full plan context
  const initialPrompt = useMemo(() => {
    const planContext = {
      name: project.name,
      template: project.template || 'custom',
      stack: project.stack || { backend: 'supabase', hosting: 'vercel', aiProvider: 'anthropic' },
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

Note: If the tool schema expects tasks_json, it MUST be a strict JSON array string with double quotes, not a JS object literal.

Now begin by defining your task list with todowrite, then start working through them one by one, updating statuses as you go.`
  }, [project])

  // Chat transport
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
        model,
        organizationId: requestConfigRef.current.organizationId,
        projectContext: {
          name: project.name,
          slug: project.slug,
          localPath: localPath || undefined,
          currentPage: null,
          inspectedElement: null,
        },
        conversationId: requestConfigRef.current.conversationId,
        agentId: 'build',
        surface: 'builder',
        variantId,
        enableTools,
        enableWebSearch,
        ...(providerOptions ? { providerOptions } : {}),
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
  }, [model, enableTools, enableWebSearch, variantId, providerOptions, project.name, project.slug, localPath])

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

  const getToolFilePaths = useCallback((toolName: string, input: Record<string, unknown> | null): string[] => {
    if (!input) return []
    if (toolName === 'write' || toolName === 'edit') {
      const filePath = input.filePath
      return typeof filePath === 'string' && filePath.trim().length > 0 ? [filePath] : []
    }
    if (toolName === 'multiedit') {
      const replacements = Array.isArray(input.replacements) ? input.replacements : []
      return replacements
        .filter(isRecord)
        .map((replacement) => replacement.filePath)
        .filter((filePath): filePath is string => typeof filePath === 'string' && filePath.trim().length > 0)
    }
    return []
  }, [])

  const enrichToolOutputWithDiagnostics = useCallback(async (
    toolName: string,
    toolInput: Record<string, unknown> | null,
    output: unknown
  ) => {
    if (!localPath) return output

    const filePaths = getToolFilePaths(toolName, toolInput)
    if (filePaths.length === 0) return output

    const summary = await collectToolDiagnosticsSummary({
      projectPath: localPath,
      filePaths,
    })

    return attachToolDiagnosticsToOutput(output, summary)
  }, [getToolFilePaths, localPath])

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
    if (toolMeta?.executionEnvironment && toolMeta.executionEnvironment !== 'local') {
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

    try {
      if (toolName === 'todowrite') {
        // Handle both formats: direct tasks array (Anthropic/OpenAI) or tasks_json string (Google/Gemini)
        let tasks: BuildTask[] | null = null

        if (!toolInput) {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: 'todowrite failed: input must be an object.',
          })
          return
        }

        if (Array.isArray(toolInput.tasks)) {
          tasks = toolInput.tasks as BuildTask[]
        } else if (typeof toolInput.tasks_json === 'string') {
          const parsed = parseJsonArrayLoose(toolInput.tasks_json)
          if (parsed) {
            tasks = parsed as BuildTask[]
          } else {
            void addToolOutput({
              state: 'output-error',
              tool: toolName,
              toolCallId,
              errorText: 'todowrite failed: tasks_json must be a valid JSON array string. Re-read the tool schema and retry with strict JSON.',
            })
            return
          }
        } else {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: 'todowrite failed: missing tasks or tasks_json input.',
          })
          return
        }

        let signature: string | null = null
        try {
          signature = JSON.stringify(tasks)
        } catch {
          signature = null
        }

        if (signature && signature === lastTasksSignatureRef.current) {
          // Avoid re-applying identical task lists (prevents render churn / loops).
        } else {
          lastTasksSignatureRef.current = signature
          onTasksUpdate(tasks)
        }

        const allCompleted = tasks.length > 0 && tasks.every(t => t.status === 'completed')
        let finalDiagnostics = null
        if (allCompleted && !completedRef.current) {
          finalDiagnostics = await getFinalDiagnosticsSummary()
          completedRef.current = true
          setTimeout(() => onComplete(), 500)
        }

        const outputPayload = {
          success: true,
          taskCount: tasks.length,
          tasks,
          ...(finalDiagnostics ? { diagnostics: finalDiagnostics } : {}),
        }

        void addToolOutput({
          tool: toolName,
          toolCallId,
          output: JSON.stringify(outputPayload),
        })
        return
      }

      if (toolName === 'build_complete') {
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
          const enrichedOutput = await enrichToolOutputWithDiagnostics(
            toolName,
            toolInput,
            { success: true, path: filePath }
          )
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
          const enrichedOutput = await enrichToolOutputWithDiagnostics(
            toolName,
            toolInput,
            { filePath, replacements: 1 }
          )
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify(enrichedOutput),
          })
        })
        return
      }

      if (toolName === 'multiedit') {
        interface ReplacementInput {
          filePath: string
          oldString: string
          newString: string
        }
        const replacements = Array.isArray(toolInput?.replacements)
          ? toolInput?.replacements.filter(isRecord).map((replacement) => ({
              filePath: replacement.filePath,
              oldString: replacement.oldString,
              newString: replacement.newString,
            })).filter((replacement) =>
              typeof replacement.filePath === 'string' &&
              typeof replacement.oldString === 'string' &&
              typeof replacement.newString === 'string'
            ) as ReplacementInput[]
          : []

        const paths = replacements.map((r) => r.filePath)
        await withFileLocks(paths, async () => {
          const results: Array<{ filePath: string; replacements: number }> = []
          for (const replacement of replacements) {
            const readResult = await window.electronAPI.project.readFile({
              projectPath: localPath,
              filePath: replacement.filePath,
            })
            if (!readResult.success || readResult.content === undefined) {
              throw new Error(readResult.error || `File not found: ${replacement.filePath}`)
            }
            const content = readResult.content
            const occurrences = content.split(replacement.oldString).length - 1
            if (occurrences === 0) {
              throw new Error(`Old string not found in file: ${replacement.filePath}`)
            }
            if (occurrences > 1) {
              throw new Error(`Old string must match exactly one occurrence in file: ${replacement.filePath}`)
            }
            const updated = content.replace(replacement.oldString, replacement.newString)
            const writeResult = await window.electronAPI.project.writeFile({
              projectPath: localPath,
              filePath: replacement.filePath,
              content: updated,
            })
            if (!writeResult.success) {
              throw new Error(writeResult.error || `Failed to write file: ${replacement.filePath}`)
            }
            results.push({ filePath: replacement.filePath, replacements: 1 })
          }
          const enrichedOutput = await enrichToolOutputWithDiagnostics(
            toolName,
            toolInput,
            { results }
          )
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify(enrichedOutput),
          })
        })
        return
      }

      if (toolName === 'get_terminal_output') {
        const terminalId = toolInput && typeof toolInput.id === 'string' ? toolInput.id.trim() : ''
        if (!terminalId) {
          throw new Error('get_terminal_output requires id')
        }

        const session = terminalOutputByIdRef.current.get(terminalId)
        if (session) {
          const running = session.endedAt === null
          const executionState = getTerminalExecutionState({
            running,
            exitCode: session.exitCode,
            timedOut: session.timedOut,
            cancelled: session.cancelled,
          })
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: JSON.stringify({
              id: session.id,
              command: session.command,
              stdout: session.stdout,
              stderr: session.stderr,
              exitCode: session.exitCode,
              running,
              startedAt: session.startedAt,
              endedAt: session.endedAt,
              timedOut: session.timedOut,
              cancelled: session.cancelled,
              success: executionState.success,
              status: executionState.status,
              ...(executionState.error ? { error: executionState.error } : {}),
            }),
          })
          return
        }

        const runtimeResult = await localRuntime.requestToolExecution(conversationId, {
          toolName,
          input: toolInput ?? { id: terminalId },
          toolCallId,
        })

        if (runtimeResult.success) {
          if (cancelledToolCallsRef.current.has(toolCallId)) return
          void addToolOutput({
            tool: toolName,
            toolCallId,
            output: runtimeResult.output,
          })
        } else {
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: runtimeResult.error || 'Tool failed',
          })
        }
        return
      }

      if (toolName === 'bash' && localPath) {
        const command = toolInput && typeof toolInput.command === 'string' ? toolInput.command : ''
        if (!command) {
          throw new Error('bash requires command')
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
        const isBackground = Boolean(toolInput?.isBackground)
        const timeout = typeof toolInput?.timeout === 'number' ? toolInput.timeout : 120000 // 2 min default

        try {
          // Create a PTY terminal session for interactive command execution
          const createResult = await window.electronAPI.terminal.create({
            projectPath: localPath,
            cwd: localPath,
            cols: 120,
            rows: 30,
          })

          if (!createResult.terminalId) {
            throw new Error('Failed to create terminal session')
          }

          const terminalId = createResult.terminalId
          let output = ''
          let exitCode: number | null = null
          let completed = false
          let unsubOutput: (() => void) | null = null
          let unsubExit: (() => void) | null = null
          let listenersReleased = false

          const releaseListeners = () => {
            if (listenersReleased) return
            listenersReleased = true
            if (unsubOutput) {
              unsubOutput()
              unsubOutput = null
            }
            if (unsubExit) {
              unsubExit()
              unsubExit = null
            }
            terminalListenerCleanupRef.current.delete(toolCallId)
          }

          terminalListenerCleanupRef.current.set(toolCallId, releaseListeners)
          terminalOutputByIdRef.current.set(terminalId, {
            id: terminalId,
            command,
            stdout: '',
            stderr: '',
            startedAt: Date.now(),
            endedAt: null,
            exitCode: null,
            timedOut: false,
            cancelled: false,
          })

          // Track this terminal session for live UI rendering
          setTerminalSessions(prev => {
            const next = new Map(prev)
            next.set(toolCallId, terminalId)
            return next
          })

          // Set up output listener
          const outputHandler = (event: { terminalId: string; data: string }) => {
            if (event.terminalId === terminalId) {
              output = appendTerminalOutput(output, event.data)
              const session = terminalOutputByIdRef.current.get(terminalId)
              if (session) {
                session.stdout = appendTerminalOutput(session.stdout, event.data)
              }
            }
          }

          // Set up exit listener
          const exitPromise = new Promise<{ exitCode: number | null }>((resolve) => {
            const exitHandler = (event: { terminalId: string; exitCode: number | null }) => {
              if (event.terminalId === terminalId) {
                completed = true
                const session = terminalOutputByIdRef.current.get(terminalId)
                if (session) {
                  session.exitCode = event.exitCode ?? null
                  session.endedAt = Date.now()
                }
                // Remove from active sessions when terminal exits
                setTerminalSessions(prev => {
                  const next = new Map(prev)
                  next.delete(toolCallId)
                  return next
                })
                releaseListeners()
                resolve({ exitCode: event.exitCode })
              }
            }
            unsubExit = window.electronAPI.terminal.onExit(exitHandler)
          })

          unsubOutput = window.electronAPI.terminal.onOutput(outputHandler)

          // Send the command to the terminal
          setTimeout(() => {
            window.electronAPI.terminal.input({
              terminalId,
              data: command + '\r',
            })
          }, 100)

          if (isBackground) {
            // For background processes, return immediately with terminal ID
            if (cancelledToolCallsRef.current.has(toolCallId)) return
            void addToolOutput({
              tool: toolName,
              toolCallId,
              output: JSON.stringify({
                id: terminalId,
                command,
                isBackground: true,
                running: true,
                success: true,
                status: 'running',
                message: 'Background process started. Use get_terminal_output to check status.',
              }),
            })
          } else {
            // For foreground processes, wait for completion or timeout
            const timeoutPromise = timeout > 0
              ? new Promise<{ exitCode: number | null }>((resolve) => {
                  setTimeout(() => {
                    if (!completed) {
                      resolve({ exitCode: -1 })
                    }
                  }, timeout)
                })
              : new Promise<never>(() => {}) // Never resolves if no timeout

            const result = await Promise.race([exitPromise, timeoutPromise])
            exitCode = result.exitCode

            // If timed out, kill the process
            if (!completed && timeout > 0) {
              const session = terminalOutputByIdRef.current.get(terminalId)
              if (session) {
                session.timedOut = true
                session.exitCode = -1
                session.endedAt = Date.now()
              }
              try {
                await window.electronAPI.terminal.kill({ terminalId })
              } catch {
                // Ignore kill errors
              }
              // Remove from active sessions on timeout
              setTerminalSessions(prev => {
                const next = new Map(prev)
                next.delete(toolCallId)
                return next
              })
              output = appendTerminalOutput(
                output,
                '\n[Process timed out after ' + (timeout / 1000) + ' seconds]'
              )
            }

            releaseListeners()

            if (cancelledToolCallsRef.current.has(toolCallId)) return
            const timedOut = !completed && timeout > 0
            const executionState = getTerminalExecutionState({
              running: false,
              exitCode,
              timedOut,
              cancelled: false,
            })
            void addToolOutput({
              tool: toolName,
              toolCallId,
              output: JSON.stringify({
                id: terminalId,
                command,
                stdout: output,
                stderr: '',
                exitCode,
                timedOut,
                cancelled: false,
                success: executionState.success,
                status: executionState.status,
                ...(executionState.error ? { error: executionState.error } : {}),
              }),
            })
          }
        } catch (err) {
          // Remove from active sessions on error
          terminalListenerCleanupRef.current.get(toolCallId)?.()
          setTerminalSessions(prev => {
            const next = new Map(prev)
            next.delete(toolCallId)
            return next
          })
          if (cancelledToolCallsRef.current.has(toolCallId)) return
          void addToolOutput({
            state: 'output-error',
            tool: toolName,
            toolCallId,
            errorText: err instanceof Error ? err.message : 'Failed to run command',
          })
        }
        return
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
        toolCallId,
      })

      if (cancelledToolCallsRef.current.has(toolCallId)) return
      if (runtimeResult.success) {
        const enrichedOutput = await enrichToolOutputWithDiagnostics(
          toolName,
          toolInput,
          runtimeResult.output
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
    conversationId,
    enrichToolOutputWithDiagnostics,
    localPath,
    localRuntime,
    normalizeProjectPath,
    onComplete,
    onFileCreated,
    onTasksUpdate,
    getFinalDiagnosticsSummary,
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

  // Handle tool calls - intercept todowrite and file operations
  const handleToolCall = useCallback(async ({ toolCall }: { toolCall: ToolCallPayload }) => {
    if (toolCall?.dynamic) return
    if (toolCall?.providerExecuted) return

    const { toolName, input, toolCallId } = toolCall
    const toolMeta = toolsByNameRef.current[toolName]

    // Check if this is a builder-local tool (may not be in toolsByName)
    const isBuilderLocalTool = BUILDER_LOCAL_TOOLS.has(toolName)
    const isLocalTool = isBuilderLocalTool || toolMeta?.executionEnvironment === 'local'

    if (isLocalTool && !isBuilderLocalTool && shouldRequireLocalApproval(toolMeta)) {
      return
    }

    if (isLocalTool) {
      await runLocalTool(toolName, toolCallId, input)
    }
  }, [runLocalTool, shouldRequireLocalApproval])

  // Track if auto-continue is handling errors (don't propagate to parent during recovery)
  const isRecoveringRef = useRef(false)
  const lastErrorRef = useRef<string | null>(null)

  // Check if we should allow auto-continue to handle the error
  const shouldAllowRecovery = useCallback(() => {
    const tasks = latestTasksRef.current
    const hasIncompleteTasks = tasks.length > 0 && tasks.some((t: BuildTask) => t.status !== 'completed')
    const canContinue = continuationCountRef.current < MAX_CONTINUATIONS
    return hasIncompleteTasks && canContinue && !completedRef.current
  }, [])

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
      console.error('Builder chat error:', err)

      const billingErr = parseBillingError(err)
      if (billingErr) {
        // Billing errors are always fatal
        setBillingError(billingErr)
        onBillingError?.(billingErr)
        onError(billingErr.title || 'Billing Error')
        return
      }

      const message = err instanceof Error
        ? err.message
        : typeof err === 'string'
          ? err
          : 'Build failed'
      lastErrorRef.current = message

      // Check if we should let auto-continue recover from this error
      if (shouldAllowRecovery()) {
        console.log('[Builder] Error occurred but allowing recovery via auto-continue:', message)
        isRecoveringRef.current = true
        // Don't propagate error yet - auto-continue will try to recover
        return
      }

      onError(message)
    },
  })

  addToolOutputRef.current = addToolOutput

  const cancelPendingToolOutputs = useCallback((reasonText: string) => {
    const addToolOutput = addToolOutputRef.current
    if (!addToolOutput) return

    const pendingToolCalls = new Map<string, { toolName: string; toolCallId: string }>()

    for (const message of messages) {
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
  }, [messages])

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
    if (stopRequestCount === lastStopRequestCountRef.current) return
    lastStopRequestCountRef.current = stopRequestCount
    userStoppedRef.current = true

    cancelPendingToolOutputs('Cancelled by user.')
    void cancelActiveTerminalSessions()
    void localRuntime.cancelRun(conversationId)
    stop()
  }, [cancelActiveTerminalSessions, cancelPendingToolOutputs, conversationId, localRuntime, stop, stopRequestCount])

  // Send initial message on mount
  useEffect(() => {
    if (preflightDiagnostic) return
    if (!providerAuthResolved) return
    if (!hasSentInitialMessageRef.current && accessToken && currentOrganization?.organizationId && project._id) {
      hasSentInitialMessageRef.current = true
      void sendMessage({ text: initialPrompt })
    }
  }, [
    accessToken,
    currentOrganization?.organizationId,
    initialPrompt,
    preflightDiagnostic,
    project._id,
    providerAuthResolved,
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

  // Track error state - only propagate if recovery isn't possible
  useEffect(() => {
    if (error) {
      const billingErr = parseBillingError(error)
      if (billingErr) {
        setBillingError(billingErr)
        onBillingError?.(billingErr)
        onError(billingErr.title || 'Billing Error')
        return
      }

      // Check if we should let auto-continue recover from this error
      if (shouldAllowRecovery()) {
        console.log('[Builder] Error state detected but allowing recovery')
        isRecoveringRef.current = true
        return
      }

      const message = error instanceof Error
        ? error.message
        : typeof error === 'string'
          ? error
          : 'Build failed'
      onError(message)
    }
  }, [error, onError, onBillingError, shouldAllowRecovery])

  // Clear recovery state when streaming starts (continuation is working)
  useEffect(() => {
    if (status === 'streaming' && isRecoveringRef.current) {
      console.log('[Builder] Recovery successful, clearing error state')
      isRecoveringRef.current = false
      lastErrorRef.current = null
    }
  }, [status])

  // Fallback: extract todowrite updates directly from streamed messages
  useEffect(() => {
    let latestTasks: BuildTask[] | null = null

    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) {
          continue
        }
        const toolPart = part as ToolPart
        const toolName = part.type === 'dynamic-tool'
          ? toolPart.toolName
          : part.type.replace(/^tool-/, '')
        if (toolName !== 'todowrite') continue

        // Handle both formats: direct tasks array (Anthropic/OpenAI) or tasks_json string (Google/Gemini)
        if (toolPart.input?.tasks) {
          latestTasks = toolPart.input.tasks as BuildTask[]
          break
        }
        if (toolPart.input?.tasks_json) {
          const parsed = parseJsonArrayLoose(toolPart.input.tasks_json)
          if (parsed) {
            latestTasks = parsed as BuildTask[]
            break
          }
        }

        if (typeof toolPart.output === 'string') {
          try {
            const parsed = JSON.parse(toolPart.output)
            if (parsed?.tasks) {
              latestTasks = parsed.tasks as BuildTask[]
              break
            }
          } catch {
            // ignore parse errors
          }
        } else if (isRecord(toolPart.output) && Array.isArray(toolPart.output.tasks)) {
          latestTasks = toolPart.output.tasks as BuildTask[]
          break
        }
      }
      if (latestTasks) break
    }

    if (latestTasks) {
      let signature: string | null = null
      try {
        signature = JSON.stringify(latestTasks)
      } catch {
        signature = null
      }

      if (!signature || signature !== lastTasksSignatureRef.current) {
        lastTasksSignatureRef.current = signature
        onTasksUpdate(latestTasks)
      }
      const allCompleted = latestTasks.length > 0 && latestTasks.every(t => t.status === 'completed')
      console.log('[Builder] Task completion check:', {
        taskCount: latestTasks.length,
        allCompleted,
        completedRefCurrent: completedRef.current,
        statuses: latestTasks.map(t => t.status),
      })
      if (allCompleted && !completedRef.current) {
        console.log('[Builder] All tasks completed, calling onComplete()')
        completedRef.current = true
        setTimeout(() => onComplete(), 500)
      }
    }
  }, [messages, onTasksUpdate, onComplete])

  // Track latest tasks for continuation logic
  useEffect(() => {
    // Extract latest tasks from messages (same logic as above effect)
    for (let i = messages.length - 1; i >= 0; i -= 1) {
      const message = messages[i]
      if (message.role !== 'assistant') continue
      for (const part of message.parts) {
        if (part.type !== 'dynamic-tool' && !part.type.startsWith('tool-')) continue
        const toolPart = part as ToolPart
        const toolName = part.type === 'dynamic-tool' ? toolPart.toolName : part.type.replace(/^tool-/, '')
        if (toolName !== 'todowrite') continue
        // Handle both formats: direct tasks array (Anthropic/OpenAI) or tasks_json string (Google/Gemini)
        if (toolPart.input?.tasks) {
          latestTasksRef.current = toolPart.input.tasks as BuildTask[]
          return
        }
        if (toolPart.input?.tasks_json) {
          const parsed = parseJsonArrayLoose(toolPart.input.tasks_json)
          if (parsed) {
            latestTasksRef.current = parsed as BuildTask[]
            return
          }
        }
      }
    }
  }, [messages])

  // Auto-continue when model stops without completing all tasks (fixes Gemini stopping early)
  useEffect(() => {
    if (userStoppedRef.current) {
      continuationSentRef.current = false
      return
    }
    if (preflightDiagnostic) {
      continuationSentRef.current = false
      return
    }

    // Only check when not loading and not completed
    if (status === 'streaming' || status === 'submitted' || completedRef.current) {
      continuationSentRef.current = false
      return
    }

    // Check if there are incomplete tasks
    const tasks = latestTasksRef.current
    const hasIncompleteTasks = tasks.length > 0 && tasks.some((t: BuildTask) => t.status !== 'completed')

    // Safety check - don't continue forever
    if (continuationCountRef.current >= MAX_CONTINUATIONS) {
      console.log('[Builder] Max continuations reached, stopping auto-continue')
      return
    }

    if (!continuationSentRef.current && messages.length > 0 && hasIncompleteTasks) {
      const lastMessage = messages[messages.length - 1]
      if (lastMessage?.role === 'assistant') {
        // Check if message only has reasoning/metadata (no actual output)
        const hasOnlyReasoning = lastMessage.parts.length > 0 &&
          lastMessage.parts.every(p =>
            p.type === 'reasoning' ||
            p.type === 'step-start' ||
            p.type === 'data-usage' ||
            (p.type === 'text' && !(p as { type: 'text'; text: string }).text?.trim())
          )

        // Always continue if there are incomplete tasks and model stopped
        // This handles both: MALFORMED_FUNCTION_CALL (only reasoning) and normal stops after tool calls
        console.log('[Builder] Model stopped with incomplete tasks, forcing continuation', {
          hasOnlyReasoning,
          taskCount: tasks.length,
          incompleteTasks: tasks.filter((t: BuildTask) => t.status !== 'completed').length,
          continuationCount: continuationCountRef.current
        })

        continuationSentRef.current = true
        continuationCountRef.current += 1

        const prompt = hasOnlyReasoning
          ? 'You stopped mid-thought. Continue and use tools to complete the current task.'
          : 'Continue with the next task. Use tools to create files and update todowrite.'

        setTimeout(() => {
          void sendMessage({ text: prompt })
        }, 500)
      }
    }
  }, [messages, preflightDiagnostic, sendMessage, status])

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

  const isLoading = status === 'streaming' || status === 'submitted'

  // Filter out the initial plan prompt message (first user message with plan context)
  const visibleMessages = useMemo(() => {
    return messages.filter((message, index) => {
      // Hide the first user message (the auto-sent plan prompt)
      if (message.role === 'user' && index === 0) {
        return false
      }
      return true
    })
  }, [messages])

  return (
    <div className={cn('flex flex-col overflow-hidden w-full', className)}>
      <div className="flex-1 min-h-0 relative w-full">
        {/* Top fade */}
        <div className="absolute top-0 left-0 right-0 h-8 bg-gradient-to-b from-background to-transparent z-10 pointer-events-none" />
        {/* Bottom fade */}
        <div className="absolute bottom-0 left-0 right-0 h-8 bg-gradient-to-t from-background to-transparent z-10 pointer-events-none" />
        <Conversation className="h-full">
          <ConversationContent className="w-full max-w-none px-4 pt-4 pb-24">
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
                <span className="text-sm">Building...</span>
              </div>
            )}
          </ConversationContent>
          <ConversationScrollButton />
        </Conversation>
      </div>
    </div>
  )
}
